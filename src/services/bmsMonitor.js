/**
 * BMS Connection Monitor
 * Handles connection to BMS server at 143.198.162.31
 * Manages failover to local logic file when connection fails
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class BMSMonitor extends EventEmitter {
  constructor() {
    super();
    this.bmsIP = '143.198.162.31';
    this.connected = false;
    this.enabled = false;
    this.lastPing = 'Never';
    this.latency = 0;
    this.usingLocalFile = false;
    this.logicFileStatus = 'none';
    this.pingInterval = null;
    this.failoverThreshold = 3; // Number of failed pings before failover
    this.failedPings = 0;
  }

  async connect() {
    this.enabled = true;
    this.startMonitoring();
    this.emit('connection-change', { enabled: true });
    console.log('BMS monitoring enabled');
  }

  async disconnect() {
    this.enabled = false;
    this.stopMonitoring();
    this.connected = false;
    this.emit('connection-change', { enabled: false });
    console.log('BMS monitoring disabled');
  }

  startMonitoring() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Initial ping
    this.pingBMS();

    // Set up regular pinging every 10 seconds
    this.pingInterval = setInterval(() => {
      this.pingBMS();
    }, 10000);
  }

  stopMonitoring() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  async pingBMS() {
    if (!this.enabled) return;

    try {
      const startTime = Date.now();
      const { stdout } = await execPromise(`ping -c 1 -W 2 ${this.bmsIP}`);
      const endTime = Date.now();
      
      // Parse ping output for latency
      const latencyMatch = stdout.match(/time=([0-9.]+)/);
      if (latencyMatch) {
        this.latency = parseFloat(latencyMatch[1]);
      }
      
      // Connection successful
      this.connected = true;
      this.failedPings = 0;
      this.lastPing = new Date().toLocaleString();
      
      // If we were using local file, switch back to remote
      if (this.usingLocalFile) {
        this.switchToRemote();
      }
      
      this.emit('ping-success', { latency: this.latency });
      
    } catch (error) {
      // Ping failed
      this.failedPings++;
      console.log(`BMS ping failed (${this.failedPings}/${this.failoverThreshold})`);
      
      if (this.failedPings >= this.failoverThreshold) {
        this.connected = false;
        
        // Switch to local file if not already using it
        if (!this.usingLocalFile) {
          this.switchToLocal();
        }
      }
      
      this.emit('ping-fail', { failedPings: this.failedPings });
    }
  }

  switchToLocal() {
    console.log('Switching to local logic files (failover)');
    this.usingLocalFile = true;
    this.logicFileStatus = 'local';
    
    // Check if any local logic files exist
    const logicDir = path.join(__dirname, '../../logic/equipment');
    if (fs.existsSync(logicDir)) {
      const files = fs.readdirSync(logicDir).filter(f => f.endsWith('.js'));
      if (files.length > 0) {
        this.emit('failover', { mode: 'local', fileExists: true, equipmentCount: files.length });
        console.log(`Found ${files.length} equipment logic files`);
      } else {
        console.error('No equipment logic files found!');
        this.emit('failover', { mode: 'local', fileExists: false });
      }
    } else {
      console.error('Logic directory not found!');
      this.emit('failover', { mode: 'local', fileExists: false });
    }
  }

  switchToRemote() {
    console.log('Switching back to remote logic (BMS reconnected)');
    this.usingLocalFile = false;
    this.logicFileStatus = 'remote';
    this.emit('failover', { mode: 'remote' });
    // Node-RED should now fetch from remote
  }

  async executeLocalLogic(equipmentId, inputs) {
    // Execute local logic for specific equipment and control boards
    const logicPath = path.join(__dirname, '../../logic/equipment', `${equipmentId}.js`);
    
    try {
      if (!fs.existsSync(logicPath)) {
        console.error(`No logic file found for equipment: ${equipmentId}`);
        return null;
      }
      
      // Set up require to use local PID controller and logger
      const Module = require('module');
      const originalRequire = Module.prototype.require;
      
      // Temporarily override require to provide local modules
      Module.prototype.require = function(id) {
        if (id.includes('pid-controller')) {
          return require('./pid-controller');
        }
        if (id.includes('location-logger')) {
          return require('./location-logger');
        }
        // Use original require for everything else
        return originalRequire.apply(this, arguments);
      };
      
      // Clear require cache to get fresh logic
      delete require.cache[require.resolve(logicPath)];
      const logic = require(logicPath);
      
      // Restore original require
      Module.prototype.require = originalRequire;
      
      let commands = null;
      
      // Check for different function signatures
      const metricsInput = inputs.metrics || {};
      const settingsInput = inputs.settings || { equipmentId };
      const uiCommands = inputs.settings || {};
      const currentTemp = inputs.currentTemp || metricsInput.space || 72;
      const stateStorage = inputs.stateStorage || {};

      // Check for all control function types
      if (typeof logic.airHandlerControl === 'function') {
        commands = await logic.airHandlerControl(metricsInput, settingsInput, currentTemp, stateStorage);
      } else if (typeof logic.coolingTowerControl === 'function') {
        commands = await logic.coolingTowerControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.processCoolingTowerControl === 'function') {
        commands = await logic.processCoolingTowerControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.chillerControl === 'function') {
        commands = await logic.chillerControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.boilerControl === 'function') {
        commands = await logic.boilerControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.pumpControl === 'function') {
        commands = await logic.pumpControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.fancoilControl === 'function') {
        commands = await logic.fancoilControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.vavControl === 'function') {
        commands = await logic.vavControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.leadlagControl === 'function') {
        commands = await logic.leadlagControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.doasControl === 'function') {
        commands = await logic.doasControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.muaControl === 'function') {
        commands = await logic.muaControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.greenhouseControl === 'function') {
        commands = await logic.greenhouseControl(metricsInput, uiCommands, stateStorage);
      } else if (typeof logic.processEquipment === 'function') {
        // Alternative format
        commands = await logic.processEquipment(inputs);
      } else if (typeof logic.getCommands === 'function') {
        // Simple format
        commands = await logic.getCommands(inputs);
      } else {
        console.error(`No valid control function found in logic file for ${equipmentId}`);
        return null;
      }
      
      // If we got commands, execute them on the boards
      if (commands && this.usingLocalFile) {
        await this.executeBoardCommands(commands);
      }
      
      return commands;
    } catch (error) {
      console.error(`Error executing logic for ${equipmentId}:`, error);
      return null;
    }
  }
  
  async executeBoardCommands(commands) {
    // Execute commands on Sequent Microsystems boards using Python
    if (!commands) return;
    
    try {
      // Load board configuration
      const configPath = path.join(__dirname, '../../config/boards.json');
      let boardConfig = [];
      if (fs.existsSync(configPath)) {
        boardConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      
      // Map commands to board outputs
      // Example: heatingValvePosition -> megabas board 0 0-10V output 1
      // Example: coolingValvePosition -> megabas board 0 0-10V output 2
      // Example: fanEnabled -> megabas board 0 triac 1
      
      for (const board of boardConfig) {
        if (board.type === 'none') continue;
        
        const stackLevel = board.board;
        
        // Build Python command based on board type and commands
        let pythonCmd = '';
        
        if (board.type === 'megabas') {
          // MegaBAS board - 4 triacs, 4 0-10V outputs
          if (commands.fanEnabled !== undefined) {
            const triacState = commands.fanEnabled ? 1 : 0;
            pythonCmd = `python3 -c "import megabas; megabas.set_triac(${stackLevel}, 1, ${triacState})"`;
            await execPromise(pythonCmd);
            console.log(`Set triac 1 on board ${stackLevel} to ${triacState}`);
          }
          
          if (commands.heatingValvePosition !== undefined) {
            // Convert 0-100% to 0-10V
            const voltage = (commands.heatingValvePosition / 100) * 10;
            pythonCmd = `python3 -c "import megabas; megabas.set_u_out(${stackLevel}, 1, ${voltage.toFixed(2)})"`;
            await execPromise(pythonCmd);
            console.log(`Set heating valve (output 1) on board ${stackLevel} to ${voltage.toFixed(2)}V`);
          }
          
          if (commands.coolingValvePosition !== undefined) {
            // Convert 0-100% to 0-10V
            const voltage = (commands.coolingValvePosition / 100) * 10;
            pythonCmd = `python3 -c "import megabas; megabas.set_u_out(${stackLevel}, 2, ${voltage.toFixed(2)})"`;
            await execPromise(pythonCmd);
            console.log(`Set cooling valve (output 2) on board ${stackLevel} to ${voltage.toFixed(2)}V`);
          }
          
          if (commands.outdoorDamperPosition !== undefined) {
            // Convert 0-100% to 0-10V
            const voltage = (commands.outdoorDamperPosition / 100) * 10;
            pythonCmd = `python3 -c "import megabas; megabas.set_u_out(${stackLevel}, 3, ${voltage.toFixed(2)})"`;
            await execPromise(pythonCmd);
            console.log(`Set damper (output 3) on board ${stackLevel} to ${voltage.toFixed(2)}V`);
          }
        } else if (board.type === '16relind') {
          // 16 Relay Industrial board
          if (commands.heatingStage1Command !== undefined) {
            const relayState = commands.heatingStage1Command ? 1 : 0;
            pythonCmd = `python3 -c "import SM16relind as relay; relay.set(${stackLevel}, 1, ${relayState})"`;
            await execPromise(pythonCmd);
            console.log(`Set relay 1 (heat stage 1) on board ${stackLevel} to ${relayState}`);
          }
          
          if (commands.heatingStage2Command !== undefined) {
            const relayState = commands.heatingStage2Command ? 1 : 0;
            pythonCmd = `python3 -c "import SM16relind as relay; relay.set(${stackLevel}, 2, ${relayState})"`;
            await execPromise(pythonCmd);
            console.log(`Set relay 2 (heat stage 2) on board ${stackLevel} to ${relayState}`);
          }
        } else if (board.type === '16uout') {
          // 16 Analog Output board (0-10V)
          // Can map additional analog outputs here
        } else if (board.type === '8relind') {
          // 8 Relay Industrial board
          // Can map relay outputs here
        }
      }
      
      this.emit('commands-executed', { 
        equipmentId: commands.equipmentId, 
        timestamp: new Date().toISOString(),
        commands 
      });
      
    } catch (error) {
      console.error('Error executing board commands:', error);
      this.emit('command-error', { error: error.message });
    }
  }

  async getStatus() {
    // Check if any logic files exist
    const logicDir = path.join(__dirname, '../../logic/equipment');
    let equipmentCount = 0;
    
    if (fs.existsSync(logicDir)) {
      const files = fs.readdirSync(logicDir).filter(f => f.endsWith('.js'));
      equipmentCount = files.length;
    }
    
    if (equipmentCount > 0 && !this.connected) {
      this.logicFileStatus = 'local';
    } else if (this.connected) {
      this.logicFileStatus = 'remote';
    } else {
      this.logicFileStatus = 'none';
    }
    
    return {
      connected: this.connected,
      enabled: this.enabled,
      lastPing: this.lastPing,
      latency: this.latency,
      usingLocalFile: this.usingLocalFile,
      logicFileStatus: this.logicFileStatus,
      bmsIP: this.bmsIP,
      failedPings: this.failedPings,
      equipmentCount: equipmentCount
    };
  }

  // Method for Node-RED to get commands for specific equipment
  async getCommands(equipmentId, inputs) {
    if (!equipmentId) {
      console.error('Equipment ID required for getting commands');
      return null;
    }
    
    if (this.usingLocalFile) {
      // Use local logic file for specific equipment
      return this.executeLocalLogic(equipmentId, inputs);
    } else {
      // Fetch from remote BMS
      try {
        const fetch = require('node-fetch');
        const response = await fetch(`http://${this.bmsIP}/api/logic/commands/${equipmentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs }),
          timeout: 5000
        });
        
        if (response.ok) {
          return await response.json();
        } else {
          throw new Error(`Failed to fetch commands for ${equipmentId} from BMS`);
        }
      } catch (error) {
        console.error(`Error fetching remote commands for ${equipmentId}:`, error);
        // Fallback to local if remote fails
        if (!this.usingLocalFile) {
          this.switchToLocal();
        }
        return this.executeLocalLogic(equipmentId, inputs);
      }
    }
  }
  
  // Get list of available equipment
  getAvailableEquipment() {
    const equipment = [];
    const logicDir = path.join(__dirname, '../../logic/equipment');
    
    if (fs.existsSync(logicDir)) {
      const files = fs.readdirSync(logicDir).filter(f => f.endsWith('.js'));
      for (const file of files) {
        const equipmentId = file.replace('.js', '');
        equipment.push({
          id: equipmentId,
          name: equipmentId.replace(/-/g, ' ').toUpperCase(),
          hasLogic: true
        });
      }
    }
    
    return equipment;
  }
}

// Export singleton instance
module.exports = new BMSMonitor();