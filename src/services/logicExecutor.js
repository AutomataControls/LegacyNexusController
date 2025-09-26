const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const vm = require('vm');
const sqlite3 = require('sqlite3').verbose();
const databaseManager = require('./databaseManager');

// Board command paths
const BOARD_COMMANDS = {
  megabas: '/usr/local/bin/megabas',
  '16univin': '/usr/local/bin/16univin',
  '16relind': '/usr/local/bin/16relind',
  '8relind': '/usr/local/bin/8relind'
};

// Input/Output mapping from parsed logic
class LogicExecutor {
  constructor() {
    this.activeLogic = null;
    this.boardConfigs = [];
    this.executionInterval = null;
    this.lastInputs = {};
    this.lastOutputs = {};
    this.stateStorage = {};
    this.logicFunction = null;
  }

  async loadBoardConfigs() {
    try {
      // First try to load from database
      const db = require('./databaseManager');
      const dbConfig = db.getBoardConfiguration();

      if (dbConfig && dbConfig.length > 0) {
        this.boardConfigs = dbConfig;
        console.log('[LogicExecutor] Loaded board configurations from database');

        // Also write to JSON file for consistency
        const configPath = path.join(__dirname, '../../data/board_configs.json');
        await fs.writeFile(configPath, JSON.stringify(dbConfig, null, 2));
        return;
      }

      // Fallback to JSON file if database is empty
      const configPath = path.join(__dirname, '../../data/board_configs.json');
      const configData = await fs.readFile(configPath, 'utf8');
      this.boardConfigs = JSON.parse(configData);
      console.log('[LogicExecutor] Loaded board configurations from JSON file');
    } catch (error) {
      console.log('[LogicExecutor] No board configs found, using defaults');
      this.boardConfigs = [];
    }
  }

  async loadLogicFile(logicFilePath) {
    try {
      const logicContent = await fs.readFile(logicFilePath, 'utf8');
      
      // Parse the logic file to extract the main control function
      const sandbox = {
        module: { exports: {} },
        console: console,
        Date: Date,
        Math: Math,
        parseFloat: parseFloat,
        parseInt: parseInt,
        Array: Array,
        Object: Object
      };

      // Execute the logic file in sandbox
      vm.createContext(sandbox);
      vm.runInContext(logicContent, sandbox);

      // Extract the exported function - check all control types
      const controlFunctions = [
        'airHandlerControl',
        'coolingTowerControl',
        'processCoolingTowerControl',
        'chillerControl',
        'boilerControl',
        'pumpControl',
        'fancoilControl',
        'vavControl',
        'leadlagControl',
        'doasControl',
        'muaControl',
        'greenhouseControl'
      ];

      // Check for each control function type
      let found = false;
      for (const funcName of controlFunctions) {
        if (sandbox.module.exports[funcName]) {
          this.logicFunction = sandbox.module.exports[funcName];
          this.activeLogic = funcName.replace('Control', '').replace('process', '');
          console.log(`[LogicExecutor] Loaded ${funcName} control logic`);
          found = true;
          break;
        }
      }

      if (!found) {
        // Look for any other exported function as fallback
        const functionNames = Object.keys(sandbox.module.exports);
        if (functionNames.length > 0) {
          this.logicFunction = sandbox.module.exports[functionNames[0]];
          this.activeLogic = functionNames[0];
          console.log(`[LogicExecutor] Loaded ${functionNames[0]} control logic`);
        }
      }

      return true;
    } catch (error) {
      console.error('[LogicExecutor] Error loading logic file:', error);
      return false;
    }
  }

  async readBoardInputs() {
    const inputs = {};

    try {
      // Read MegaBAS inputs (AI1-AI8 for universal inputs)
      const megabasConfig = this.boardConfigs.find(b => b.boardType === 'megabas');
      if (megabasConfig && megabasConfig.enabled) {
        for (let i = 1; i <= 8; i++) {
          if (megabasConfig.inputs && megabasConfig.inputs[i] && megabasConfig.inputs[i].enabled) {
            const { stdout } = await execPromise(`${BOARD_COMMANDS.megabas} ${megabasConfig.stackAddress} adcrd ${i}`);
            const value = parseFloat(stdout.trim());
            
            // Convert based on input type and conversion type
            const inputConfig = megabasConfig.inputs[i];
            let convertedValue = value;
            
            if (inputConfig.inputType === '0-10V') {
              // 0-10V input
              if (inputConfig.conversionType === 'temperature') {
                // Convert voltage to temperature (example: 0-10V = 0-100°F)
                convertedValue = value * 10;
              } else if (inputConfig.conversionType === 'humidity') {
                // Convert voltage to humidity (0-10V = 0-100%)
                convertedValue = value * 10;
              } else if (inputConfig.conversionType === 'pressure') {
                // Convert voltage to pressure (0-10V = 0-100 PSI)
                convertedValue = value * 10;
              } else if (inputConfig.conversionType === 'amps') {
                // For current sensors - scale properly
                if (inputConfig.scaling) {
                  const maxAmps = parseFloat(inputConfig.scaling.split('-')[1]);
                  convertedValue = (value / 10) * maxAmps;
                } else {
                  convertedValue = value * 5; // Default 0-10V = 0-50A
                }
              } else {
                // Pass voltage through
                convertedValue = value;
              }
            } else if (inputConfig.inputType === '1k') {
              // 1K RTD temperature sensor
              // Convert resistance to temperature using RTD formula
              convertedValue = this.convertRTDToTemp(value);
            } else if (inputConfig.inputType === '10k') {
              // 10K thermistor
              convertedValue = this.convertThermistorToTemp(value);
            }
            
            // Apply baseline offsets for current sensors when towers are off
            // AI3-6 are Tower 2 L1, Tower 2 L3, Tower 3 L1, Tower 3 L3
            if (i >= 3 && i <= 6 && inputConfig.conversionType === 'amps') {
              const baselineOffsets = {
                3: 0.402,  // Tower 2 L1 baseline: 0.402V = 2.0A
                4: 0.773,  // Tower 2 L3 baseline: 0.773V = 3.9A
                5: 0.651,  // Tower 3 L1 baseline: 0.651V = 3.3A
                6: 1.537   // Tower 3 L3 baseline: 1.537V = 7.7A
              };

              // Subtract baseline voltage before converting to amps
              const correctedVoltage = Math.max(0, value - (baselineOffsets[i] || 0));

              // Convert corrected voltage to amps
              if (inputConfig.scaling) {
                const maxAmps = parseFloat(inputConfig.scaling.split('-')[1]);
                convertedValue = (correctedVoltage / 10) * maxAmps;
              } else {
                convertedValue = correctedVoltage * 5; // Default 0-10V = 0-50A
              }

              console.log(`[LogicExecutor] Read AI${i}: ${value.toFixed(3)}V - ${baselineOffsets[i].toFixed(3)}V offset = ${correctedVoltage.toFixed(3)}V -> ${convertedValue.toFixed(2)}A`);
            } else {
              console.log(`[LogicExecutor] Read AI${i}: ${value.toFixed(3)}V -> ${convertedValue.toFixed(2)} ${inputConfig.conversionType === 'amps' ? 'A' : ''}`);
            }

            inputs[`AI${i}`] = convertedValue;
          }
        }
      }

      // Read 16-Universal Input board
      const input16Config = this.boardConfigs.find(b => b.boardType === '16univin');
      if (input16Config && input16Config.enabled) {
        for (let i = 1; i <= 16; i++) {
          // Skip CH11 - we use weather database for outdoor temp
          if (i === 11) continue;

          if (input16Config.inputs && input16Config.inputs[i] && input16Config.inputs[i].enabled) {
            const inputConfig = input16Config.inputs[i];
            let value, convertedValue;

            // Read based on configured input type
            if (inputConfig.inputType === '1k') {
              // Read 1K RTD resistance
              const { stdout } = await execPromise(`${BOARD_COMMANDS['16univin']} ${input16Config.stackAddress} 1kinrd ${i}`);
              value = parseFloat(stdout.trim());
              convertedValue = this.convertRTDToTemp(value);
            } else if (inputConfig.inputType === '10k') {
              // Read 10K thermistor resistance
              const { stdout } = await execPromise(`${BOARD_COMMANDS['16univin']} ${input16Config.stackAddress} 10kinrd ${i}`);
              value = parseFloat(stdout.trim());
              convertedValue = this.convertThermistorToTemp(value);
            } else {
              // Default to 0-10V reading
              const { stdout } = await execPromise(`${BOARD_COMMANDS['16univin']} ${input16Config.stackAddress} uinrd ${i}`);
              value = parseFloat(stdout.trim());

              if (inputConfig.inputType === '0-10V') {
                if (inputConfig.conversionType === 'temperature') {
                  convertedValue = value * 10;
                } else if (inputConfig.conversionType === 'amps' && inputConfig.scaling) {
                  // Convert voltage to amps based on scaling (e.g., "0-50")
                  const maxAmps = parseFloat(inputConfig.scaling.split('-')[1]);
                  convertedValue = (value / 10) * maxAmps;
                } else {
                  convertedValue = value; // Keep as voltage
                }
              } else {
                convertedValue = value;
              }
            }

            inputs[`CH${i}`] = convertedValue;
            // Log with proper units
            let logValue = value;
            let unit = '';
            if (inputConfig.inputType === '10k') {
              logValue = `${value} ohms`;
              unit = '°F';
            } else if (inputConfig.inputType === '0-10V') {
              logValue = `${value.toFixed(3)}V`;
              if (inputConfig.conversionType === 'amps') unit = 'A';
              else if (inputConfig.conversionType === 'temperature') unit = '°F';
            }
            console.log(`[LogicExecutor] Read CH${i}: ${logValue} -> ${convertedValue.toFixed(2)}${unit}`);
          }
        }
      }

      // Add outdoor temperature from weather database
      inputs.outdoorTemp = await this.getOutdoorTemperature();

      // Add timestamp
      inputs.timestamp = Date.now();
      this.lastInputs = inputs;

      return inputs;
    } catch (error) {
      console.error('[LogicExecutor] Error reading board inputs:', error);
      return this.lastInputs; // Return last known good values
    }
  }

  async writeBoardOutputs(outputs) {
    try {
      const megabasConfig = this.boardConfigs.find(b => b.boardType === 'megabas');
      const relay16Config = this.boardConfigs.find(b => b.boardType === '16relind');

      // PROPER SEQUENCING FOR COOLING TOWER CONTROL
      // The logic file sets what needs to be on/off, but we need to sequence the operations properly

      // Step 1: Handle SHUTDOWN sequence first (if any towers are being turned OFF)
      for (let i = 1; i <= 3; i++) {
        const currentlyEnabled = this.lastOutputs[`tower${i}VFDEnable`] || false;
        const shouldBeEnabled = outputs[`tower${i}VFDEnable`] || false;

        // Check actual hardware state on first run
        let actuallyEnabled = currentlyEnabled;
        if (!this.hasCheckedHardwareState) {
          try {
            const { stdout } = await execPromise(`megabas 0 trrd`);
            const triacState = parseInt(stdout.trim());
            actuallyEnabled = (triacState & (1 << (i-1))) !== 0;
            console.log(`[LogicExecutor] Tower ${i} actual hardware state: ${actuallyEnabled}`);
          } catch (e) {
            console.log(`[LogicExecutor] Could not read hardware state`);
          }
        }

        console.log(`[LogicExecutor] Tower ${i}: lastOutput=${currentlyEnabled}, actual=${actuallyEnabled}, shouldBe=${shouldBeEnabled}`);

        // FIXED: Always shut down if tower is actually running but shouldn't be
        // This handles cases where logic executor was restarted and lost state
        if (actuallyEnabled && !shouldBeEnabled) {
          // Tower is running but shouldn't be - shut it down
          console.log(`[LogicExecutor] Shutting down Tower ${i} (actual=${actuallyEnabled}, should=${shouldBeEnabled})`);

          // 1. Turn off VFD first
          if (megabasConfig && megabasConfig.enabled) {
            await execPromise(`${BOARD_COMMANDS.megabas} ${megabasConfig.stackAddress} trwr ${i} 0`);
            console.log(`[LogicExecutor] Tower ${i} VFD disabled`);
          }

          // 2. Set speed to 0
          if (megabasConfig && megabasConfig.enabled) {
            await execPromise(`${BOARD_COMMANDS.megabas} ${megabasConfig.stackAddress} dacwr ${i} 0`);
            console.log(`[LogicExecutor] Tower ${i} speed set to 0V`);
          }

          // 3. Wait for VFD to completely stop spinning
          await new Promise(resolve => setTimeout(resolve, 10000));

          // 4. Close isolation valve
          if (relay16Config && relay16Config.enabled) {
            const valveCloseChannels = { 1: 11, 2: 9, 3: 7 };
            const valveOpenChannels = { 1: 12, 2: 10, 3: 8 };

            // Ensure open signal is off
            await execPromise(`${BOARD_COMMANDS['16relind']} ${relay16Config.stackAddress} write ${valveOpenChannels[i]} off`);
            // Send close signal
            await execPromise(`${BOARD_COMMANDS['16relind']} ${relay16Config.stackAddress} write ${valveCloseChannels[i]} on`);
            console.log(`[LogicExecutor] Tower ${i} isolation valve closing`);
          }
        }
      }

      // Step 2: Handle STARTUP sequence (if any towers are being turned ON)
      for (let i = 1; i <= 3; i++) {
        const currentlyEnabled = this.lastOutputs[`tower${i}VFDEnable`] || false;
        const shouldBeEnabled = outputs[`tower${i}VFDEnable`] || false;

        if (!currentlyEnabled && shouldBeEnabled) {
          // Tower is being started - follow startup sequence
          console.log(`[LogicExecutor] Starting Tower ${i}`);

          // 1. Open isolation valve FIRST
          if (relay16Config && relay16Config.enabled) {
            const valveCloseChannels = { 1: 11, 2: 9, 3: 7 };
            const valveOpenChannels = { 1: 12, 2: 10, 3: 8 };

            // Ensure close signal is off
            await execPromise(`${BOARD_COMMANDS['16relind']} ${relay16Config.stackAddress} write ${valveCloseChannels[i]} off`);
            // Send open signal
            await execPromise(`${BOARD_COMMANDS['16relind']} ${relay16Config.stackAddress} write ${valveOpenChannels[i]} on`);
            console.log(`[LogicExecutor] Tower ${i} isolation valve opening`);

            // No delay - valve opens immediately
          }

          // 2. Set VFD speed reference (check for manual override first)
          if (megabasConfig && megabasConfig.enabled) {
            const requestedSpeed = outputs[`tower${i}FanSpeed`] || 2.6;

            // Check if this analog output is in manual mode
            if (!this.isManualMode('megabas', 'analog', i)) {
              await execPromise(`${BOARD_COMMANDS.megabas} ${megabasConfig.stackAddress} dacwr ${i} ${requestedSpeed}`);
              console.log(`[LogicExecutor] Tower ${i} speed set to ${requestedSpeed}V (${(requestedSpeed * 10).toFixed(0)}Hz)`);
            } else {
              console.log(`[LogicExecutor] Tower ${i} speed MANUAL OVERRIDE - skipping logic control`);
            }

            // Small delay to let speed reference stabilize
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          // 3. Enable VFD (check for manual override first)
          if (megabasConfig && megabasConfig.enabled) {
            if (!this.isManualMode('megabas', 'triac', i)) {
              await execPromise(`${BOARD_COMMANDS.megabas} ${megabasConfig.stackAddress} trwr ${i} 1`);
              console.log(`[LogicExecutor] Tower ${i} VFD enabled`);
            } else {
              console.log(`[LogicExecutor] Tower ${i} VFD MANUAL OVERRIDE - skipping logic control`);
            }
          }
        }
      }

      // Step 3: Handle speed changes for running towers (no enable/disable change)
      for (let i = 1; i <= 3; i++) {
        const currentlyEnabled = this.lastOutputs[`tower${i}VFDEnable`] || false;
        const shouldBeEnabled = outputs[`tower${i}VFDEnable`] || false;

        if (currentlyEnabled && shouldBeEnabled) {
          // Tower stays running but speed might change
          const currentSpeed = this.lastOutputs[`tower${i}FanSpeed`] || 0;
          const newSpeed = outputs[`tower${i}FanSpeed`] || 0;

          if (Math.abs(currentSpeed - newSpeed) > 0.1) {
            if (megabasConfig && megabasConfig.enabled) {
              await execPromise(`${BOARD_COMMANDS.megabas} ${megabasConfig.stackAddress} dacwr ${i} ${newSpeed}`);
              console.log(`[LogicExecutor] Tower ${i} speed changed to ${newSpeed}V`);
            }
          }
        }
      }

      // Step 4: Handle bypass valve (AO4) - uses 2-10V range
      if (outputs.bypassValvePosition !== undefined && megabasConfig && megabasConfig.enabled) {
        // Check if bypass valve is in manual mode
        if (!this.isManualMode('megabas', 'analog', 4)) {
          // Ensure voltage stays within 2-10V range for valve control
          const voltage = Math.max(2.0, Math.min(10, outputs.bypassValvePosition));
          await execPromise(`${BOARD_COMMANDS.megabas} ${megabasConfig.stackAddress} dacwr 4 ${voltage}`);
          const percent = ((voltage - 2) / 8 * 100).toFixed(0);
          console.log(`[LogicExecutor] Bypass valve set to ${voltage.toFixed(1)}V (${percent}% open)`);
        } else {
          console.log(`[LogicExecutor] Bypass valve MANUAL OVERRIDE - skipping logic control`);
        }
      }

      // Handle tempering valve if configured (could be on another analog output)
      if (outputs.temperingValvePosition !== undefined) {
        // Note: tempering valve output channel needs to be configured
        // For now, log the intended position
        const voltage = Math.max(2.0, Math.min(10, outputs.temperingValvePosition));
        const percent = ((voltage - 2) / 8 * 100).toFixed(0);
        console.log(`[LogicExecutor] Tempering valve target: ${voltage.toFixed(1)}V (${percent}% open) - channel TBD`);
      }

      // Step 5: Handle tower heaters (freeze protection)
      if (relay16Config && relay16Config.enabled) {
        const heaterMappings = {
          'tower1HeaterEnable': 16,
          'tower2HeaterEnable': 15,
          'tower3HeaterEnable': 14
        };

        for (const [key, channel] of Object.entries(heaterMappings)) {
          if (outputs[key] !== undefined) {
            // Check if this relay is in manual mode
            if (!this.isManualMode('16relind', 'relay', channel)) {
              const state = outputs[key] ? 'on' : 'off';
              await execPromise(`${BOARD_COMMANDS['16relind']} ${relay16Config.stackAddress} write ${channel} ${state}`);
              console.log(`[LogicExecutor] Heater Relay ${channel}: ${state}`);
            } else {
              console.log(`[LogicExecutor] Heater Relay ${channel} MANUAL OVERRIDE - skipping logic control`);
            }
          }
        }
      }

      // Step 6: Handle pump relays (channels 1, 2, 3 on 16-relay board)
      if (relay16Config && relay16Config.enabled) {
        const pumpMappings = {
          'pump1Enable': 1,
          'pump2Enable': 2,
          'pump3Enable': 3
        };

        for (const [key, channel] of Object.entries(pumpMappings)) {
          if (outputs[key] !== undefined) {
            // Check if this relay is in manual mode
            if (!this.isManualMode('16relind', 'relay', channel)) {
              const state = outputs[key] ? 'on' : 'off';
              await execPromise(`${BOARD_COMMANDS['16relind']} ${relay16Config.stackAddress} write ${channel} ${state}`);
              console.log(`[LogicExecutor] Pump Relay ${channel}: ${state}`);
            } else {
              console.log(`[LogicExecutor] Pump Relay ${channel} MANUAL OVERRIDE - skipping logic control`);
            }
          }
        }
      }

      // Mark that we've checked hardware state
      this.hasCheckedHardwareState = true;

      this.lastOutputs = outputs;
      return true;
    } catch (error) {
      console.error('[LogicExecutor] Error writing board outputs:', error);
      return false;
    }
  }

  convertRTDToTemp(resistance) {
    // 1K Platinum RTD conversion (simplified linear approximation)
    // Typical: 1000Ω at 0°C, 1385Ω at 100°C
    const R0 = 1000; // Resistance at 0°C
    const alpha = 0.00385; // Temperature coefficient
    const tempC = (resistance - R0) / (R0 * alpha);
    const tempF = (tempC * 9/5) + 32;
    return tempF;
  }

  convertThermistorToTemp(resistance) {
    // 10K thermistor conversion using Steinhart-Hart equation
    // Simplified for 10K NTC thermistor
    const R0 = 10000; // 10K at 25°C
    const B = 3950; // Beta coefficient
    const T0 = 298.15; // 25°C in Kelvin

    const tempK = 1 / ((1/T0) + (1/B) * Math.log(resistance/R0));
    const tempC = tempK - 273.15;
    const tempF = (tempC * 9/5) + 32;
    return tempF;
  }

  // Check if an output is in manual mode
  isManualMode(boardType, outputType, outputId) {
    try {
      const stmt = databaseManager.metricsDb.prepare(`
        SELECT mode FROM board_manual_states
        WHERE board_type = ? AND output_type = ? AND output_id = ?
      `);
      const result = stmt.get(boardType, outputType, outputId);
      return result && result.mode === 'manual';
    } catch (error) {
      console.error('[LogicExecutor] Error checking manual mode:', error);
      return false;
    }
  }

  async getOutdoorTemperature() {
    return new Promise((resolve) => {
      const weatherDb = new sqlite3.Database(path.join(__dirname, '../../data/weather.db'), sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          console.error('[LogicExecutor] Error opening weather database:', err);
          resolve(72); // Default fallback temperature
          return;
        }

        weatherDb.get(
          'SELECT temperature FROM current_weather ORDER BY timestamp DESC LIMIT 1',
          (err, row) => {
            weatherDb.close();
            if (err || !row) {
              console.log('[LogicExecutor] No weather data available, using default');
              resolve(72);
            } else {
              console.log(`[LogicExecutor] Outdoor temp from weather DB: ${row.temperature}°F`);
              resolve(row.temperature);
            }
          }
        );
      });
    });
  }

  async executeLogicCycle() {
    if (!this.logicFunction) {
      console.log('[LogicExecutor] No logic function loaded');
      return null;
    }

    try {
      // Read current inputs from boards
      const inputs = await this.readBoardInputs();

      // Get user's setpoint from database
      const db = require('./databaseManager');
      try {
        const stmt = db.metricsDb.prepare('SELECT value FROM system_config WHERE key = ?');
        const row = stmt.get('user_setpoint');
        if (row) {
          inputs.userSetpoint = parseFloat(row.value) || 75;
          console.log(`[LogicExecutor] User setpoint: ${inputs.userSetpoint}°F`);
        } else {
          inputs.userSetpoint = 75; // Default
          console.log('[LogicExecutor] No user setpoint found, using default 75°F');
        }
      } catch (err) {
        inputs.userSetpoint = 75;
        console.log('[LogicExecutor] Error reading setpoint from DB, using default 75°F');
      }

      // Execute the control logic
      const outputs = this.logicFunction(inputs, {}, this.stateStorage);

      // Write outputs to boards
      await this.writeBoardOutputs(outputs);
      
      // Log execution
      console.log(`[LogicExecutor] Logic cycle completed at ${new Date().toISOString()}`);
      
      // Store results for monitoring
      const result = {
        timestamp: Date.now(),
        inputs: inputs,
        outputs: outputs,
        activeLogic: this.activeLogic
      };
      
      // Save to results file for UI monitoring
      const resultsPath = path.join(__dirname, '../../data/logic_results.json');
      await fs.writeFile(resultsPath, JSON.stringify(result, null, 2));
      
      return result;
    } catch (error) {
      console.error('[LogicExecutor] Error executing logic cycle:', error);
      return null;
    }
  }

  startExecution(intervalSeconds = 7) {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
    }

    console.log(`[LogicExecutor] Starting execution with ${intervalSeconds}s interval`);
    
    // Execute immediately
    this.executeLogicCycle();
    
    // Then execute periodically
    this.executionInterval = setInterval(() => {
      this.executeLogicCycle();
    }, intervalSeconds * 1000);
  }

  stopExecution() {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
      console.log('[LogicExecutor] Execution stopped');
    }
  }

  async testLogic(inputs = {}) {
    if (!this.logicFunction) {
      return { error: 'No logic function loaded' };
    }

    try {
      // Use provided inputs or read from boards
      const testInputs = Object.keys(inputs).length > 0 ? inputs : await this.readBoardInputs();
      
      // Execute logic in test mode (don't write outputs)
      const outputs = this.logicFunction(testInputs, {}, this.stateStorage);
      
      return {
        success: true,
        inputs: testInputs,
        outputs: outputs,
        activeLogic: this.activeLogic
      };
    } catch (error) {
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }
}

module.exports = LogicExecutor;