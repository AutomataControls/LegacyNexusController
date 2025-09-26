/**
 * Local Controller Service
 * Runs equipment logic locally when BMS server is unavailable
 * Controls Sequent Microsystems boards directly via Python
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class LocalController extends EventEmitter {
  constructor(databaseManager) {
    super();
    this.db = databaseManager;
    this.bmsMonitor = null;
    this.pollingInterval = null;
    this.isRunning = false;
    this.equipmentStates = {};
    this.pollingRate = 30000; // 30 seconds default
  }

  setBmsMonitor(monitor) {
    this.bmsMonitor = monitor;
    
    // Listen for failover events
    monitor.on('failover', (data) => {
      if (data.mode === 'local' && data.fileExists) {
        console.log('BMS failover detected - starting local control');
        this.start();
      } else if (data.mode === 'remote') {
        console.log('BMS reconnected - stopping local control');
        this.stop();
      }
    });
  }

  async start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('Starting local controller service');
    
    // Start polling loop
    this.pollingInterval = setInterval(() => {
      this.runControlLoop();
    }, this.pollingRate);
    
    // Run immediately
    this.runControlLoop();
  }

  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    console.log('Stopped local controller service');
  }

  async runControlLoop() {
    try {
      // Check if BMS monitor is initialized
      if (!this.bmsMonitor) {
        console.log('BMS monitor not initialized, skipping control loop');
        return;
      }

      // Get list of equipment with local logic files
      const equipment = this.bmsMonitor.getAvailableEquipment();

      for (const eq of equipment) {
        await this.runEquipmentLogic(eq.id);
      }
    } catch (error) {
      console.error('Error in control loop:', error);
    }
  }

  async runEquipmentLogic(equipmentId) {
    try {
      // Check if equipment is enabled in database
      const config = await this.getEquipmentConfig(equipmentId);
      if (!config || !config.enabled) {
        console.log(`Equipment ${equipmentId} is disabled, skipping`);
        return;
      }
      
      // Get latest sensor readings from database
      const metrics = await this.getLatestMetrics(equipmentId);
      
      // Get equipment settings (setpoints, schedules, etc.)
      const settings = await this.getEquipmentSettings(equipmentId);
      
      // Prepare inputs for logic file
      const inputs = {
        metrics,
        settings: { ...settings, equipmentId },
        currentTemp: metrics.space || metrics.supply || 72,
        stateStorage: this.equipmentStates[equipmentId] || {}
      };
      
      // Execute logic and get commands
      const commands = await this.bmsMonitor.executeLocalLogic(equipmentId, inputs);
      
      if (commands) {
        // Store state for next iteration
        this.equipmentStates[equipmentId] = inputs.stateStorage;
        
        // Save results to database
        this.saveLogicResults(equipmentId, commands, metrics);
        
        console.log(`Executed local logic for ${equipmentId}:`, {
          setpoint: commands.temperatureSetpoint,
          heating: commands.heatingValvePosition,
          cooling: commands.coolingValvePosition,
          fan: commands.fanEnabled
        });
      }
    } catch (error) {
      console.error(`Error running logic for ${equipmentId}:`, error);
    }
  }
  
  async saveLogicResults(equipmentId, commands, metrics) {
    try {
      // Create table if not exists
      this.db.metricsDb.exec(`
        CREATE TABLE IF NOT EXISTS logic_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          equipment_id TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          temperature_setpoint REAL,
          current_temp REAL,
          heating_valve REAL,
          cooling_valve REAL,
          oa_damper REAL,
          fan_enabled INTEGER,
          fan_speed TEXT,
          unit_enabled INTEGER,
          space_temp REAL,
          supply_temp REAL,
          outdoor_temp REAL,
          commands_json TEXT
        )
      `);
      
      // Insert results
      const stmt = this.db.metricsDb.prepare(`
        INSERT INTO logic_results (
          equipment_id, temperature_setpoint, current_temp,
          heating_valve, cooling_valve, oa_damper,
          fan_enabled, fan_speed, unit_enabled,
          space_temp, supply_temp, outdoor_temp,
          commands_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        equipmentId,
        commands.temperatureSetpoint || 72,
        metrics.space || metrics.supply || 72,
        commands.heatingValvePosition || 0,
        commands.coolingValvePosition || 0,
        commands.outdoorDamperPosition || 0,
        commands.fanEnabled ? 1 : 0,
        commands.fanSpeed || 'auto',
        commands.unitEnable !== false ? 1 : 0,
        metrics.space || null,
        metrics.supply || null,
        metrics.outdoor || null,
        JSON.stringify(commands)
      );
      
      // Keep only last 1000 records per equipment
      const cleanupStmt = this.db.metricsDb.prepare(`
        DELETE FROM logic_results 
        WHERE equipment_id = ? 
        AND id NOT IN (
          SELECT id FROM logic_results 
          WHERE equipment_id = ? 
          ORDER BY timestamp DESC 
          LIMIT 1000
        )
      `);
      cleanupStmt.run(equipmentId, equipmentId);
      
    } catch (error) {
      console.error('Error saving logic results:', error);
    }
  }
  
  async getEquipmentConfig(equipmentId) {
    try {
      const stmt = this.db.metricsDb.prepare(`
        SELECT * FROM equipment_config WHERE equipment_id = ?
      `);
      const config = stmt.get(equipmentId);
      return config ? {
        ...config,
        enabled: config.enabled === 1
      } : null;
    } catch (error) {
      // Try JSON fallback
      const configPath = path.join(__dirname, '../../config/equipment', `${equipmentId}.json`);
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      return null;
    }
  }

  async getLatestMetrics(equipmentId) {
    try {
      // Get latest readings from Node-RED data in database
      const stmt = this.db.metricsDb.prepare(`
        SELECT * FROM nodered_readings 
        WHERE equipment_id = ? OR equipment_id IS NULL
        ORDER BY timestamp DESC 
        LIMIT 1
      `);
      
      const row = stmt.get(equipmentId) || stmt.get(null);
      
      if (row) {
        // Parse JSON fields if stored as strings
        const metrics = {
          space: row.space,
          supply: row.supply,
          return: row.return_temp,
          outdoor: row.outdoor,
          mixed: row.mixed,
          setpoint: row.setpoint,
          humidity: row.humidity,
          co2: row.co2,
          fanAmps: row.fan_amps || row.amps,
          occupied: row.occupied,
          timestamp: row.timestamp
        };
        
        // Add any additional fields from the row
        Object.keys(row).forEach(key => {
          if (!metrics[key]) {
            metrics[key] = row[key];
          }
        });
        
        return metrics;
      }
      
      // Return default metrics if no data
      return {
        space: 72,
        supply: 55,
        outdoor: 65,
        setpoint: 72,
        fanAmps: 0
      };
    } catch (error) {
      console.error('Error getting metrics:', error);
      return {};
    }
  }

  async getEquipmentSettings(equipmentId) {
    try {
      // Get equipment-specific settings from database or config
      const configPath = path.join(__dirname, '../../config', 'equipment', `${equipmentId}.json`);
      
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      
      // Return default settings
      return {
        enabled: true,
        temperatureSetpoint: 72,
        occupancySchedule: {
          start: '05:30',
          end: '20:30'
        }
      };
    } catch (error) {
      console.error('Error getting equipment settings:', error);
      return {};
    }
  }

  async getStatus() {
    return {
      running: this.isRunning,
      pollingRate: this.pollingRate,
      equipmentCount: Object.keys(this.equipmentStates).length,
      lastRun: new Date().toISOString()
    };
  }
}

// Export singleton instance
module.exports = LocalController;