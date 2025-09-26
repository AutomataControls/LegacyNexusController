const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const databaseManager = require('./databaseManager');

class BoardController {
  constructor() {
    this.boards = {
      megabas: false,
      relay16: false,
      relay8: false,
      input16: false
    };
    
    this.boardStates = {
      megabas: {
        triacs: [],
        analogOutputs: [],
        inputs: []
      },
      input16: {
        inputs: []
      },
      relay16: {
        relays: []
      },
      relay8: {
        relays: []
      }
    };
    
    // Load saved states from database
    this.loadSavedStates();
    
    // Detect boards on initialization
    this.detectBoards();
    
    // Poll board states every 5 seconds
    setInterval(() => this.updateBoardStates(), 5000);
    
    // Save controller metrics to database every 30 seconds
    setInterval(() => this.saveControllerMetrics(), 30000);
  }

  async loadSavedStates() {
    try {
      const savedStates = databaseManager.getBoardStates();
      
      for (const state of savedStates) {
        if (state.mode === 'manual') {
          // Apply saved manual states to boards
          if (state.board_type === 'megabas') {
            if (state.output_type === 'triac') {
              const triacIndex = state.output_id - 1;
              if (this.boardStates.megabas.triacs[triacIndex]) {
                this.boardStates.megabas.triacs[triacIndex].mode = 'manual';
                this.boardStates.megabas.triacs[triacIndex].state = state.state === 'true' || state.state === '1';
              }
            } else if (state.output_type === 'analog') {
              const aoIndex = state.output_id - 1;
              if (this.boardStates.megabas.analogOutputs[aoIndex]) {
                this.boardStates.megabas.analogOutputs[aoIndex].mode = 'manual';
                this.boardStates.megabas.analogOutputs[aoIndex].value = state.value || 0;
              }
            }
          } else if (state.board_type === 'relay16') {
            const relayIndex = state.output_id - 1;
            if (this.boardStates.relay16.relays[relayIndex]) {
              this.boardStates.relay16.relays[relayIndex].mode = 'manual';
              this.boardStates.relay16.relays[relayIndex].state = state.state === 'true' || state.state === '1';
            }
          } else if (state.board_type === 'relay8') {
            const relayIndex = state.output_id - 1;
            if (this.boardStates.relay8.relays[relayIndex]) {
              this.boardStates.relay8.relays[relayIndex].mode = 'manual';
              this.boardStates.relay8.relays[relayIndex].state = state.state === 'true' || state.state === '1';
            }
          }
        }
      }
      
      console.log('Loaded saved board states from database');
    } catch (err) {
      console.error('Error loading saved states:', err);
    }
  }

  async applySavedManualStates() {
    try {
      const savedStates = databaseManager.getBoardStates();
      
      for (const state of savedStates) {
        if (state.mode === 'manual') {
          // Apply saved manual states to actual hardware
          if (state.board_type === 'megabas') {
            if (state.output_type === 'triac') {
              const triacState = state.state === 'true' || state.state === '1';
              await execAsync(`megabas 0 trwr ${state.output_id} ${triacState ? 1 : 0}`);
              const triacIndex = state.output_id - 1;
              if (this.boardStates.megabas.triacs[triacIndex]) {
                this.boardStates.megabas.triacs[triacIndex].mode = 'manual';
                this.boardStates.megabas.triacs[triacIndex].state = triacState;
              }
            } else if (state.output_type === 'analog' && state.value !== null) {
              await execAsync(`megabas 0 aowr ${state.output_id} ${state.value}`);
              const aoIndex = state.output_id - 1;
              if (this.boardStates.megabas.analogOutputs[aoIndex]) {
                this.boardStates.megabas.analogOutputs[aoIndex].mode = 'manual';
                this.boardStates.megabas.analogOutputs[aoIndex].value = state.value;
              }
            }
          } else if (state.board_type === 'relay16') {
            const relayState = state.state === 'true' || state.state === '1';
            await execAsync(`16relind 0 write ${state.output_id} ${relayState ? 1 : 0}`);
            const relayIndex = state.output_id - 1;
            if (this.boardStates.relay16.relays[relayIndex]) {
              this.boardStates.relay16.relays[relayIndex].mode = 'manual';
              this.boardStates.relay16.relays[relayIndex].state = relayState;
            }
          } else if (state.board_type === 'relay8') {
            const relayState = state.state === 'true' || state.state === '1';
            await execAsync(`8relind 0 rwr ${state.output_id} ${relayState ? 1 : 0}`);
            const relayIndex = state.output_id - 1;
            if (this.boardStates.relay8.relays[relayIndex]) {
              this.boardStates.relay8.relays[relayIndex].mode = 'manual';
              this.boardStates.relay8.relays[relayIndex].state = relayState;
            }
          }
        }
      }
      
      console.log('Applied saved manual states to hardware');
    } catch (err) {
      console.error('Error applying saved manual states:', err);
    }
  }

  async detectBoards() {
    console.log('Detecting connected boards...');
    
    // Check for MegaBAS
    try {
      const { stdout } = await execAsync('megabas -list');
      this.boards.megabas = stdout.includes('board(s) detected') && !stdout.includes('0 board');
      if (this.boards.megabas) {
        console.log('✓ MegaBAS board detected');
        // Initialize MegaBAS states
        for (let i = 1; i <= 4; i++) {
          this.boardStates.megabas.triacs.push({ id: i, state: false, mode: 'auto' });
          this.boardStates.megabas.analogOutputs.push({ id: i, value: 0, mode: 'auto' });
        }
        for (let i = 1; i <= 8; i++) {
          this.boardStates.megabas.inputs.push({ id: i, value: 0, type: '0-10V', label: `Input ${i}` });
        }
        
        // Apply saved manual states
        await this.applySavedManualStates();
      }
    } catch (err) {
      console.log('✗ MegaBAS board not found');
    }
    
    // Check for 16-Universal Input
    try {
      const { stdout } = await execAsync('16univin 0 board');
      this.boards.input16 = stdout.includes('16-Universal Inputs');
      if (this.boards.input16) {
        console.log('✓ 16-Universal Input board detected');
        // Initialize 16 input states
        for (let i = 1; i <= 16; i++) {
          this.boardStates.input16.inputs.push({ id: i, value: 0, type: '10k', label: `Input ${i}` });
        }
      }
    } catch (err) {
      console.log('✗ 16-Universal Input board not found');
    }
    
    // Check for 16-Relay
    try {
      const { stdout } = await execAsync('16relind -list');
      this.boards.relay16 = stdout.includes('board(s) detected') && !stdout.includes('0 board');
      if (this.boards.relay16) {
        console.log('✓ 16-Relay board detected');
        // Initialize 16 relay states
        for (let i = 1; i <= 16; i++) {
          this.boardStates.relay16.relays.push({ id: i, state: false, mode: 'auto' });
        }
      }
    } catch (err) {
      console.log('✗ 16-Relay board not found');
    }
    
    // Check for 8-Relay
    try {
      const { stdout } = await execAsync('8relind -list');
      this.boards.relay8 = stdout.includes('board(s) detected') && !stdout.includes('0 board');
      if (this.boards.relay8) {
        console.log('✓ 8-Relay board detected');
        // Initialize 8 relay states
        for (let i = 1; i <= 8; i++) {
          this.boardStates.relay8.relays.push({ id: i, state: false, mode: 'auto' });
        }
      }
    } catch (err) {
      console.log('✗ 8-Relay board not found');
    }
    
    return this.boards;
  }

  async updateBoardStates() {
    // Update MegaBAS states
    if (this.boards.megabas) {
      try {
        // Read triac states
        const { stdout: triacStates } = await execAsync('megabas 0 trrd');
        const triacBits = parseInt(triacStates) || 0;
        for (let i = 0; i < 4; i++) {
          if (this.boardStates.megabas.triacs[i]) {
            this.boardStates.megabas.triacs[i].state = !!(triacBits & (1 << i));
          }
        }
        
        // Read analog outputs (DAC values)
        for (let i = 1; i <= 4; i++) {
          const { stdout: aoValue } = await execAsync(`megabas 0 dacrd ${i}`);
          const value = parseFloat(aoValue) || 0;
          if (this.boardStates.megabas.analogOutputs[i - 1]) {
            this.boardStates.megabas.analogOutputs[i - 1].value = value;
          }
        }
        
        // Read analog inputs (0-10V)
        for (let i = 1; i <= 8; i++) {
          const { stdout: inputValue } = await execAsync(`megabas 0 adcrd ${i}`);
          const value = parseFloat(inputValue) || 0;
          if (this.boardStates.megabas.inputs[i - 1]) {
            this.boardStates.megabas.inputs[i - 1].value = value;
          }
        }
      } catch (err) {
        console.error('Error updating MegaBAS states:', err.message);
      }
    }
    
    // Update 16-Input states
    if (this.boards.input16) {
      try {
        // First get the board configuration to know which inputs are 1k vs 10k
        const boardConfigs = databaseManager.getBoardConfigs();
        const input16Config = boardConfigs.find(c => c.boardType === '16univin' && c.enabled);
        
        for (let i = 1; i <= 16; i++) {
          let value = 0;
          let inputType = '1k'; // Default to 1k
          
          // Check the configured input type
          if (input16Config && input16Config.inputs && input16Config.inputs[i]) {
            inputType = input16Config.inputs[i].inputType || '1k';
          }
          
          try {
            if (inputType === '1k') {
              // Read as 1k RTD
              const { stdout: inputValue } = await execAsync(`16univin 0 1kinrd ${i}`);
              value = parseFloat(inputValue) || 0;
            } else if (inputType === '10k') {
              // Read as 10k thermistor
              const { stdout: inputValue } = await execAsync(`16univin 0 10kinrd ${i}`);
              value = parseFloat(inputValue) || 0;
            } else {
              // Read as 0-10V
              const { stdout: inputValue } = await execAsync(`16univin 0 uinrd ${i}`);
              value = parseFloat(inputValue) || 0;
              // Debug logging for current sensors
              if (i === 5 || i === 7 || i === 8) {
                console.log(`Reading CH${i} as 0-10V: raw output="${inputValue}", parsed=${value}V`);
              }
            }
          } catch (err) {
            // If specific read fails, try generic voltage read
            const { stdout: inputValue } = await execAsync(`16univin 0 uinrd ${i}`);
            value = parseFloat(inputValue) || 0;
          }
          
          if (this.boardStates.input16.inputs[i - 1]) {
            this.boardStates.input16.inputs[i - 1].value = value;
            this.boardStates.input16.inputs[i - 1].type = inputType;
          }
        }
      } catch (err) {
        console.error('Error updating 16-Input states:', err.message);
      }
    }
    
    // Update 16-Relay states
    if (this.boards.relay16) {
      try {
        const { stdout: relayStates } = await execAsync('16relind 0 read');
        const relayBits = parseInt(relayStates) || 0;
        for (let i = 0; i < 16; i++) {
          if (this.boardStates.relay16.relays[i]) {
            this.boardStates.relay16.relays[i].state = !!(relayBits & (1 << i));
          }
        }
      } catch (err) {
        console.error('Error updating 16-Relay states:', err.message);
      }
    }
    
    // Update 8-Relay states
    if (this.boards.relay8) {
      try {
        const { stdout: relayStates } = await execAsync('8relind 0 rrd');
        const relayBits = parseInt(relayStates) || 0;
        for (let i = 0; i < 8; i++) {
          if (this.boardStates.relay8.relays[i]) {
            this.boardStates.relay8.relays[i].state = !!(relayBits & (1 << i));
          }
        }
      } catch (err) {
        console.error('Error updating 8-Relay states:', err.message);
      }
    }
  }

  async setRelay(board, relayId, state) {
    try {
      let command;
      let outputType = 'relay';
      
      switch (board) {
        case 'megabas':
          // Triacs are 1-4
          command = `megabas 0 trwr ${relayId} ${state ? 1 : 0}`;
          outputType = 'triac';
          break;
        case 'relay16':
          command = `16relind 0 write ${relayId} ${state ? 1 : 0}`;
          break;
        case 'relay8':
          command = `8relind 0 rwr ${relayId} ${state ? 1 : 0}`;
          break;
        default:
          throw new Error(`Unknown board: ${board}`);
      }
      
      await execAsync(command);
      
      // Update local state
      if (board === 'megabas' && this.boardStates.megabas.triacs[relayId - 1]) {
        this.boardStates.megabas.triacs[relayId - 1].state = state;
        // Save to database if in manual mode
        if (this.boardStates.megabas.triacs[relayId - 1].mode === 'manual') {
          databaseManager.saveBoardState(board, 0, relayId, outputType, state ? '1' : '0', null, 'manual');
        }
      } else if (board === 'relay16' && this.boardStates.relay16.relays[relayId - 1]) {
        this.boardStates.relay16.relays[relayId - 1].state = state;
        // Save to database if in manual mode
        if (this.boardStates.relay16.relays[relayId - 1].mode === 'manual') {
          databaseManager.saveBoardState(board, 0, relayId, outputType, state ? '1' : '0', null, 'manual');
        }
      } else if (board === 'relay8' && this.boardStates.relay8.relays[relayId - 1]) {
        this.boardStates.relay8.relays[relayId - 1].state = state;
        // Save to database if in manual mode
        if (this.boardStates.relay8.relays[relayId - 1].mode === 'manual') {
          databaseManager.saveBoardState(board, 0, relayId, outputType, state ? '1' : '0', null, 'manual');
        }
      }
      
      return { success: true };
    } catch (err) {
      console.error(`Error setting relay: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async setAnalogOutput(outputId, value) {
    try {
      // Ensure value is between 0 and 10
      value = Math.max(0, Math.min(10, value));
      
      const command = `megabas 0 aowr ${outputId} ${value}`;
      await execAsync(command);
      
      // Update local state
      if (this.boardStates.megabas.analogOutputs[outputId - 1]) {
        this.boardStates.megabas.analogOutputs[outputId - 1].value = value;
        // Save to database if in manual mode
        if (this.boardStates.megabas.analogOutputs[outputId - 1].mode === 'manual') {
          databaseManager.saveBoardState('megabas', 0, outputId, 'analog', null, value, 'manual');
        }
      }
      
      return { success: true };
    } catch (err) {
      console.error(`Error setting analog output: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  setMode(board, outputId, mode) {
    let boardType = board;
    let outputType = 'relay';
    
    // Parse board type and output type
    if (board === 'megabas-triac') {
      boardType = 'megabas';
      outputType = 'triac';
    } else if (board === 'megabas-analog') {
      boardType = 'megabas';
      outputType = 'analog';
    }
    
    // Update the mode (manual/auto) for an output
    if (board === 'megabas-triac' && this.boardStates.megabas.triacs[outputId - 1]) {
      this.boardStates.megabas.triacs[outputId - 1].mode = mode;
      const state = this.boardStates.megabas.triacs[outputId - 1].state;
      databaseManager.saveBoardState(boardType, 0, outputId, outputType, state ? '1' : '0', null, mode);
    } else if (board === 'megabas-analog' && this.boardStates.megabas.analogOutputs[outputId - 1]) {
      this.boardStates.megabas.analogOutputs[outputId - 1].mode = mode;
      const value = this.boardStates.megabas.analogOutputs[outputId - 1].value;
      databaseManager.saveBoardState(boardType, 0, outputId, outputType, null, value, mode);
    } else if (board === 'relay16' && this.boardStates.relay16.relays[outputId - 1]) {
      this.boardStates.relay16.relays[outputId - 1].mode = mode;
      const state = this.boardStates.relay16.relays[outputId - 1].state;
      databaseManager.saveBoardState(boardType, 0, outputId, outputType, state ? '1' : '0', null, mode);
    } else if (board === 'relay8' && this.boardStates.relay8.relays[outputId - 1]) {
      this.boardStates.relay8.relays[outputId - 1].mode = mode;
      const state = this.boardStates.relay8.relays[outputId - 1].state;
      databaseManager.saveBoardState(boardType, 0, outputId, outputType, state ? '1' : '0', null, mode);
    }
    
    return { success: true };
  }

  getBoards() {
    return this.boards;
  }

  getBoardStates() {
    return this.boardStates;
  }

  async saveControllerMetrics() {
    try {
      // Get board configuration to map inputs correctly
      const boardConfigs = databaseManager.getBoardConfigs();
      const input16Config = boardConfigs.find(c => c.boardType === '16univin' && c.enabled);
      const megabasConfig = boardConfigs.find(c => c.boardType === 'megabas' && c.enabled);
      
      // Get user setpoint from database
      let userSetpoint = 72; // Default
      try {
        const setpointStmt = databaseManager.metricsDb.prepare('SELECT value FROM system_config WHERE key = ?');
        const setpointRow = setpointStmt.get('user_setpoint');
        if (setpointRow && setpointRow.value) {
          userSetpoint = parseFloat(setpointRow.value);
        }
      } catch (err) {
        console.error('Error getting user setpoint:', err);
      }
      
      // Build metrics object with all sensor values
      const metrics = {
        setpoint: userSetpoint,
        tower_loop_supply_temp: null,
        tower_loop_return_temp: null,
        hp_supply_temp: null,
        hp_return_temp: null,
        outdoor_air_temp: null,
        hx_effectiveness: null,
        tower_1_vfd_current_l1: null,
        tower_1_vfd_current_l3: null,
        tower_2_vfd_current_l1: null,
        tower_2_vfd_current_l3: null,
        tower_3_vfd_current_l1: null,
        tower_3_vfd_current_l3: null,
        pump_1_current: null,
        pump_2_current: null,
        pump_3_current: null,
        vfd_current_7: null,
        vfd_current_8: null,
        triac1: false,
        triac2: false,
        triac3: false,
        triac4: false,
        ao1: 0,
        ao2: 0,
        ao3: 0,
        ao4: 0,
        relay1: false,
        relay2: false,
        relay3: false,
        relay4: false,
        relay5: false,
        relay6: false,
        relay7: false,
        relay8: false,
        relay9: false,
        relay10: false,
        relay11: false,
        relay12: false,
        relay13: false,
        relay14: false,
        relay15: false,
        relay16: false
      };
      
      // Get outdoor temperature from weather database
      try {
        const weather = await databaseManager.getLatestWeather();
        if (weather && weather.temperature) {
          metrics.outdoor_air_temp = weather.temperature;
        }
      } catch (err) {
        console.error('Error getting weather data:', err);
      }
      
      // Map MegaBAS inputs based on configuration
      if (this.boards.megabas && megabasConfig && megabasConfig.inputs) {
        for (let i = 1; i <= 8; i++) {
          const inputConfig = megabasConfig.inputs[i];
          const inputValue = this.boardStates.megabas.inputs[i - 1]?.value || 0;
          
          if (inputConfig && inputConfig.enabled && inputConfig.name) {
            const name = inputConfig.name.toLowerCase();

            // Convert temperature values for 10K NTC sensors
            let convertedValue = inputValue;
            if (inputConfig.inputType === '10K NTC' || name.includes('10k')) {
              // The board already returns resistance value for 10K thermistors
              // Use the standard formula for 10K NTC thermistor
              const resistance = inputValue;
              if (resistance > 900 && resistance < 1200) {
                // If value looks like it's already been through some conversion,
                // use the quadratic approximation for 10K NTC
                const tempF = (Math.sqrt(0.00644 * resistance - 1.6597) - 1.961) / 0.00322;
                convertedValue = Math.max(-40, Math.min(250, tempF));
              } else {
                // Standard 10K NTC conversion
                const R0 = 10000;
                const B = 3950;
                const T0 = 298.15;
                const T = 1 / ((1/T0) + (1/B) * Math.log(resistance/R0));
                const tempC = T - 273.15;
                convertedValue = (tempC * 9/5) + 32;
              }
            } else if (inputConfig.conversionType === 'amps' && inputConfig.scaling) {
              // Current sensor conversion
              const maxAmps = parseFloat(inputConfig.scaling.split('-')[1]);
              if (maxAmps) {
                // MegaBAS returns voltage directly (e.g., 2.1 for 2.1V)
                const voltage = inputValue;
                convertedValue = (voltage / 10) * maxAmps;
                // If current is below 2.2A, consider it noise/off and save as 0
                if (convertedValue < 2.2) {
                  convertedValue = 0;
                }
              }
            }

            // Check for ALL possible sensor types on MegaBAS
            // Temperature sensors (could be on either board)
            if (name.includes('tower') && name.includes('supply')) {
              metrics.tower_loop_supply_temp = convertedValue;
            } else if (name.includes('tower') && name.includes('return')) {
              metrics.tower_loop_return_temp = convertedValue;
            } else if (name.includes('hp') && name.includes('supply')) {
              metrics.hp_supply_temp = convertedValue;
            } else if (name.includes('hp') && name.includes('return')) {
              metrics.hp_return_temp = convertedValue;
            }
            // Current sensors (could be on either board) - use convertedValue
            else if (name.includes('tower 1') && name.includes('l1')) {
              metrics.tower_1_vfd_current_l1 = convertedValue;
            } else if (name.includes('tower 1') && name.includes('l3')) {
              metrics.tower_1_vfd_current_l3 = convertedValue;
            } else if (name.includes('tower 2') && name.includes('l1')) {
              metrics.tower_2_vfd_current_l1 = convertedValue;
            } else if (name.includes('tower 2') && name.includes('l3')) {
              metrics.tower_2_vfd_current_l3 = convertedValue;
            } else if (name.includes('tower 3') && name.includes('l1')) {
              metrics.tower_3_vfd_current_l1 = convertedValue;
            } else if (name.includes('tower 3') && name.includes('l3')) {
              metrics.tower_3_vfd_current_l3 = convertedValue;
            } else if (name.includes('pump 1')) {
              metrics.pump_1_current = convertedValue;
            } else if (name.includes('pump 2')) {
              metrics.pump_2_current = convertedValue;
            } else if (name.includes('pump 3')) {
              metrics.pump_3_current = convertedValue;
            } else if (name.includes('vfd') && name.includes('7')) {
              metrics.vfd_current_7 = convertedValue;
            } else if (name.includes('vfd') && name.includes('8')) {
              metrics.vfd_current_8 = convertedValue;
            }
          }
        }
      }
      
      // Map 16-Input board based on configuration
      if (this.boards.input16 && input16Config && input16Config.inputs) {
        for (let i = 1; i <= 16; i++) {
          const inputConfig = input16Config.inputs[i];
          const inputValue = this.boardStates.input16.inputs[i - 1]?.value || 0;

          if (inputConfig && inputConfig.enabled && inputConfig.name) {
            const name = inputConfig.name.toLowerCase();

            // Convert temperature values for 10K NTC sensors on 16-input board
            let convertedValue = inputValue;
            if (inputConfig.inputType === '10K NTC' || inputConfig.inputType === '10k' || name.includes('10k')) {
              // For 16-input board, the raw value is resistance for 10K NTC
              const resistance = inputValue;

              // Standard 10K NTC thermistor conversion
              const R0 = 10000;  // 10K at 25°C
              const B = 3950;    // Beta coefficient
              const T0 = 298.15; // 25°C in Kelvin

              const T = 1 / ((1/T0) + (1/B) * Math.log(resistance/R0));
              const tempC = T - 273.15;
              convertedValue = (tempC * 9/5) + 32; // Convert to Fahrenheit
            } else if (inputConfig.conversionType === 'amps' && inputConfig.scaling) {
              // Current sensor conversion for 16-input board
              const maxAmps = parseFloat(inputConfig.scaling.split('-')[1]);
              if (maxAmps) {
                // For 16-input board, inputValue is already in volts (0-10V)
                convertedValue = (inputValue / 10) * maxAmps;
                // If current is below 2.2A, consider it noise/off and save as 0
                if (convertedValue < 2.2) {
                  convertedValue = 0;
                }
              }
            }

            // Check for ALL sensor types (could be on either board)
            // Temperature sensors - use converted values
            if (name.includes('tower') && name.includes('supply')) {
              metrics.tower_loop_supply_temp = convertedValue;
            } else if (name.includes('tower') && name.includes('return')) {
              metrics.tower_loop_return_temp = convertedValue;
            } else if (name.includes('hp') && name.includes('supply')) {
              metrics.hp_supply_temp = convertedValue;
            } else if (name.includes('hp') && name.includes('return')) {
              metrics.hp_return_temp = convertedValue;
            }
            // Current sensors - use convertedValue
            else if (name.includes('tower 1') && name.includes('l1')) {
              metrics.tower_1_vfd_current_l1 = convertedValue;
            } else if (name.includes('tower 1') && name.includes('l3')) {
              metrics.tower_1_vfd_current_l3 = convertedValue;
            } else if (name.includes('tower 2') && name.includes('l1')) {
              metrics.tower_2_vfd_current_l1 = convertedValue;
            } else if (name.includes('tower 2') && name.includes('l3')) {
              metrics.tower_2_vfd_current_l3 = convertedValue;
            } else if (name.includes('tower 3') && name.includes('l1')) {
              metrics.tower_3_vfd_current_l1 = convertedValue;
            } else if (name.includes('tower 3') && name.includes('l3')) {
              metrics.tower_3_vfd_current_l3 = convertedValue;
            } else if (name.includes('pump 1')) {
              metrics.pump_1_current = convertedValue;
            } else if (name.includes('pump 2')) {
              metrics.pump_2_current = convertedValue;
            } else if (name.includes('pump 3')) {
              metrics.pump_3_current = convertedValue;
            } else if (name.includes('vfd') && name.includes('7')) {
              metrics.vfd_current_7 = convertedValue;
            } else if (name.includes('vfd') && name.includes('8')) {
              metrics.vfd_current_8 = convertedValue;
            }
          }
        }
      }
      
      // Get triac states from MegaBAS
      if (this.boards.megabas) {
        for (let i = 0; i < 4; i++) {
          const triac = this.boardStates.megabas.triacs[i];
          if (triac) {
            metrics[`triac${i + 1}`] = triac.state;
          }
        }
        
        // Get analog outputs
        for (let i = 0; i < 4; i++) {
          const ao = this.boardStates.megabas.analogOutputs[i];
          if (ao) {
            metrics[`ao${i + 1}`] = ao.value;
          }
        }
      }
      
      // Get relay states from 16-Relay board
      if (this.boards.relay16) {
        for (let i = 0; i < 16; i++) {
          const relay = this.boardStates.relay16.relays[i];
          if (relay) {
            metrics[`relay${i + 1}`] = relay.state;
          }
        }
      }

      // Calculate HX Effectiveness if we have all required temperatures
      if (metrics.tower_loop_supply_temp !== null &&
          metrics.tower_loop_return_temp !== null &&
          metrics.hp_supply_temp !== null) {
        // Effectiveness = (T_tower_out - T_tower_in) / (T_hp_in - T_tower_in)
        const denominator = metrics.hp_supply_temp - metrics.tower_loop_return_temp;
        if (denominator !== 0) {
          const effectiveness = ((metrics.tower_loop_supply_temp - metrics.tower_loop_return_temp) / denominator) * 100;
          // Clamp to reasonable range (0-100%)
          metrics.hx_effectiveness = Math.min(100, Math.max(0, effectiveness));
        }
      }

      // Save to database
      await databaseManager.insertNexusControllerMetrics(metrics);
      console.log('Controller metrics saved to database');
      
    } catch (err) {
      console.error('Error saving controller metrics:', err);
    }
  }
  
  async getCurrentReadings() {
    // Aggregate current readings from all boards
    const readings = {
      inputs: {},
      outputs: {},
      triacs: {},
      alarms: [],
      labels: {}
    };

    // MegaBAS readings
    if (this.boards.megabas) {
      // Analog inputs (Universal inputs 1-8)
      for (let i = 0; i < 8; i++) {
        const input = this.boardStates.megabas.inputs[i];
        if (input) {
          readings.inputs[`AI${i + 1}`] = input.value;
        }
      }

      // Analog outputs
      for (let i = 0; i < 4; i++) {
        const output = this.boardStates.megabas.analogOutputs[i];
        if (output) {
          readings.outputs[`AO${i + 1}`] = Math.round(output.value * 10); // Convert to percentage
        }
      }

      // Triacs
      for (let i = 0; i < 4; i++) {
        const triac = this.boardStates.megabas.triacs[i];
        if (triac) {
          readings.triacs[`T${i + 1}`] = triac.state;
        }
      }
    }

    // 16-Universal Input readings
    if (this.boards.input16) {
      for (let i = 0; i < 16; i++) {
        const input = this.boardStates.input16.inputs[i];
        if (input) {
          readings.inputs[`CH${i + 1}`] = input.value;
        }
      }
    }

    // DISABLED: Hardcoded alarm generation was creating bogus alarms
    // Alarms should be generated by alarmMonitor.js based on configured thresholds
    // Not all inputs are temperature sensors, so applying temperature thresholds to all is wrong
    /*
    Object.entries(readings.inputs).forEach(([key, value]) => {
      if (value > 85) {
        readings.alarms.push({
          name: `${key} High Temperature`,
          value: value,
          threshold: 85,
          unit: '°F',
          status: 'critical',
          type: 'critical',
          message: 'Temperature exceeds safe operating range',
          timestamp: new Date().toISOString()
        });
      } else if (value < 32) {
        readings.alarms.push({
          name: `${key} Low Temperature`,
          value: value,
          threshold: 32,
          unit: '°F',
          status: 'warning',
          type: 'warning',
          message: 'Temperature below freezing point',
          timestamp: new Date().toISOString()
        });
      }
    });
    */

    return readings;
  }
}

module.exports = new BoardController();