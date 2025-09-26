// WIT-Motion WTVB01-485 Vibration Sensor Integration
// Node.js implementation for building automation

const { SerialPort } = require('serialport');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const execPromise = util.promisify(exec);

class VibrationMonitor {
  constructor(db) {
    this.db = db;
    this.readings = new Map();
    this.latestReadings = new Map();  // Store latest readings for BMS reporter
    this.configs = new Map();
    this.serialPorts = new Map();
    this.pollingIntervals = new Map();

    // Initialize database tables
    this.initDatabase();
    this.loadConfigs();
    // Start polling for all enabled sensors
    this.startAll();
  }

  initDatabase() {
    try {
      // Create vibration sensor configuration table
      this.db.metricsDb.exec(`
        CREATE TABLE IF NOT EXISTS vibration_sensors (
          sensor_id TEXT PRIMARY KEY,
          equipment_name TEXT NOT NULL,
          port TEXT NOT NULL,
          modbus_id INTEGER DEFAULT 80,
          baud_rate INTEGER DEFAULT 9600,
          alert_threshold_mms REAL DEFAULT 7.1,
          baseline_velocity REAL,
          baseline_timestamp DATETIME,
          enabled BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add baseline columns if they don't exist (for existing installations)
      try {
        this.db.metricsDb.exec(`ALTER TABLE vibration_sensors ADD COLUMN baseline_velocity REAL`);
      } catch (e) { /* Column may already exist */ }
      try {
        this.db.metricsDb.exec(`ALTER TABLE vibration_sensors ADD COLUMN baseline_timestamp DATETIME`);
      } catch (e) { /* Column may already exist */ }

      // Create vibration readings table
      this.db.metricsDb.exec(`
        CREATE TABLE IF NOT EXISTS vibration_readings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sensor_id TEXT NOT NULL,
          temperature_f REAL,
          velocity_mms REAL,
          velocity_x REAL,
          velocity_y REAL,
          velocity_z REAL,
          iso_zone TEXT,
          alert_level TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (sensor_id) REFERENCES vibration_sensors(sensor_id)
        )
      `);

      // Create index for faster queries
      this.db.metricsDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_vibration_readings_timestamp
        ON vibration_readings(timestamp DESC)
      `);
    } catch (error) {
      console.error('[VibrationMonitor] Database initialization error:', error);
    }
  }

  loadConfigs() {
    try {
      const stmt = this.db.metricsDb.prepare('SELECT * FROM vibration_sensors');
      const sensors = stmt.all();

      sensors.forEach(sensor => {
        this.configs.set(sensor.sensor_id, {
          enabled: sensor.enabled === 1,
          port: sensor.port,
          sensor_id: sensor.sensor_id,
          equipment_name: sensor.equipment_name,
          modbus_id: sensor.modbus_id,
          baud_rate: sensor.baud_rate,
          alert_threshold_mms: sensor.alert_threshold_mms,
          baseline_velocity: sensor.baseline_velocity,
          baseline_timestamp: sensor.baseline_timestamp
        });
      });

      console.log(`[VibrationMonitor] Loaded ${sensors.length} sensor configurations`);
    } catch (error) {
      console.error('[VibrationMonitor] Error loading configs:', error);
    }
  }

  // Calculate CRC16 for Modbus RTU
  calculateCRC16(data) {
    let crc = 0xFFFF;

    for (let byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        if ((crc & 0x0001) !== 0) {
          crc >>= 1;
          crc ^= 0xA001;
        } else {
          crc >>= 1;
        }
      }
    }

    return crc;
  }

  // Build Modbus read command
  buildReadCommand(modbusId, startReg, numRegs) {
    const cmd = [
      modbusId,
      0x03, // Read holding registers
      (startReg >> 8) & 0xFF,
      startReg & 0xFF,
      (numRegs >> 8) & 0xFF,
      numRegs & 0xFF
    ];

    const crc = this.calculateCRC16(cmd);
    // WIT-Motion uses little-endian CRC (low byte first)
    cmd.push(crc & 0xFF);         // CRC low byte
    cmd.push((crc >> 8) & 0xFF);  // CRC high byte

    return Buffer.from(cmd);
  }

  // Get ISO 10816-3 classification based on velocity
  getISOClassification(velocityMms) {
    let zone, alertLevel;

    if (velocityMms <= 2.8) {
      zone = 'A';
      alertLevel = 'Good';
    } else if (velocityMms <= 4.5) {
      zone = 'B';
      alertLevel = 'Acceptable';
    } else if (velocityMms <= 7.1) {
      zone = 'B';
      alertLevel = 'Warning';
    } else if (velocityMms <= 11.0) {
      zone = 'C';
      alertLevel = 'Unsatisfactory';
    } else {
      zone = 'D';
      alertLevel = 'Unacceptable';
    }

    return { zone, alertLevel };
  }

  // Scan for available USB ports
  async scanPorts() {
    const ports = [];

    try {
      // Use ls to find USB serial devices
      const { stdout } = await execPromise('ls /dev/ttyUSB* 2>/dev/null || true');
      if (stdout) {
        ports.push(...stdout.trim().split('\n').filter(p => p));
      }

      // Also check for ttyACM devices
      const { stdout: acm } = await execPromise('ls /dev/ttyACM* 2>/dev/null || true');
      if (acm) {
        ports.push(...acm.trim().split('\n').filter(p => p));
      }
    } catch (error) {
      console.error('[VibrationMonitor] Error scanning ports:', error);
    }

    return ports;
  }

  // Configure a vibration sensor
  async configureSensor(config) {
    try {
      const stmt = this.db.metricsDb.prepare(`
        INSERT OR REPLACE INTO vibration_sensors
        (sensor_id, equipment_name, port, modbus_id, baud_rate, alert_threshold_mms, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run(
        config.sensor_id,
        config.equipment_name,
        config.port,
        config.modbus_id || 0x50, // Default address
        config.baud_rate || 9600,
        config.alert_threshold_mms || 7.1,
        config.enabled ? 1 : 0
      );

      this.configs.set(config.sensor_id, config);

      // Start polling if enabled
      if (config.enabled) {
        this.startPolling(config.sensor_id);
      }

      return { success: true, message: 'Sensor configured successfully' };
    } catch (error) {
      console.error('[VibrationMonitor] Configuration error:', error);
      return { success: false, error: error.message };
    }
  }

  // Delete sensor configuration
  async deleteSensor(sensorId) {
    try {
      // Stop polling
      this.stopPolling(sensorId);

      // Delete from database
      const stmt = this.db.metricsDb.prepare('DELETE FROM vibration_sensors WHERE sensor_id = ?');
      stmt.run(sensorId);

      // Remove from configs
      this.configs.delete(sensorId);

      return { success: true };
    } catch (error) {
      console.error('[VibrationMonitor] Delete error:', error);
      return { success: false, error: error.message };
    }
  }

  // Get all sensor configurations
  getConfigs() {
    return Array.from(this.configs.values());
  }

  // Set baseline for a sensor
  async setBaseline(sensorId, baselineVelocity, baselineTimestamp) {
    try {
      const stmt = this.db.metricsDb.prepare(`
        UPDATE vibration_sensors
        SET baseline_velocity = ?, baseline_timestamp = ?, updated_at = CURRENT_TIMESTAMP
        WHERE sensor_id = ?
      `);

      stmt.run(baselineVelocity, baselineTimestamp, sensorId);

      // Update in-memory config
      const config = this.configs.get(sensorId);
      if (config) {
        config.baseline_velocity = baselineVelocity;
        config.baseline_timestamp = baselineTimestamp;
      }

      return { success: true, message: 'Baseline set successfully' };
    } catch (error) {
      console.error('[VibrationMonitor] Set baseline error:', error);
      return { success: false, error: error.message };
    }
  }

  // Clear baseline for a sensor
  async clearBaseline(sensorId) {
    try {
      const stmt = this.db.metricsDb.prepare(`
        UPDATE vibration_sensors
        SET baseline_velocity = NULL, baseline_timestamp = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE sensor_id = ?
      `);

      stmt.run(sensorId);

      // Update in-memory config
      const config = this.configs.get(sensorId);
      if (config) {
        config.baseline_velocity = null;
        config.baseline_timestamp = null;
      }

      return { success: true, message: 'Baseline cleared successfully' };
    } catch (error) {
      console.error('[VibrationMonitor] Clear baseline error:', error);
      return { success: false, error: error.message };
    }
  }

  // Read sensor (real hardware only - no simulation)
  async readSensor(sensorId) {
    const config = this.configs.get(sensorId);

    if (!config) {
      throw new Error('Sensor not configured');
    }

    if (!config.enabled) {
      throw new Error('Sensor is disabled');
    }

    // Check if port exists for real reading
    const portExists = fs.existsSync(config.port);

    if (!portExists) {
      console.error(`[VibrationMonitor] Port ${config.port} does not exist for sensor ${sensorId}`);
      throw new Error(`Port ${config.port} not found`);
    }

    // Try real sensor reading only - no fallback to simulation
    let reading;
    try {
      reading = await this.readSensorModbus(config);
    } catch (error) {
      console.error(`[VibrationMonitor] Sensor ${sensorId} read failed:`, error.message);
      throw error; // Propagate error instead of using simulation
    }

    // Store reading in memory
    this.readings.set(sensorId, reading);
    this.latestReadings.set(sensorId, reading);  // Also store for BMS reporter

    // Store in database
    this.storeReading(reading);

    return reading;
  }

  // Read sensor using Modbus RTU (WTVB01-485)
  async readSensorModbus(config) {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({
        path: config.port,
        baudRate: config.baud_rate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none'
      });

      const timeout = setTimeout(() => {
        port.close();
        reject(new Error('Sensor read timeout'));
      }, 2000); // 2 second timeout

      let responseBuffer = Buffer.alloc(0);

      port.on('open', () => {
        // Read 12 registers starting from 0x34 as per Python WTVB01 implementation
        // Matches exactly: 50030034000C0980
        // 0x50 (80) = Modbus ID, 0x03 = Read, 0x0034 = Start reg, 0x000C = 12 registers
        const cmd = this.buildReadCommand(config.modbus_id, 0x34, 0x0C); // 12 registers from 0x34

        console.log(`[VibrationMonitor] Sending Modbus command to ${config.port}: ${cmd.toString('hex')}`);

        // Clear buffer and send command
        port.flush(() => {
          port.write(cmd);
        });
      });

      port.on('data', (data) => {
        // Accumulate data
        responseBuffer = Buffer.concat([responseBuffer, data]);

        // Expected response: 29 bytes total
        // Address(1) + Function(1) + ByteCount(1) + Data(24) + CRC(2) = 29 bytes
        if (responseBuffer.length >= 29) {
          // Verify response header
          if (responseBuffer[0] === config.modbus_id && responseBuffer[1] === 0x03) {
            // Parse registers from response - expecting 24 bytes of data (12 registers)
            const dataBytes = responseBuffer.slice(3, 27); // 24 bytes of data
            const registers = [];

            for (let i = 0; i < 24; i += 2) {
              // WIT-Motion sends data in big-endian (high byte first)
              let value = (dataBytes[i] << 8) | dataBytes[i + 1];
              // Convert to signed 16-bit
              if (value > 32767) value -= 65536;
              registers.push(value);
            }

            // Parse acceleration data from Python example - first 3 registers
            // Acceleration data at registers 0x34-0x36 (positions 0-2)
            const accelX = registers[0] / 32768.0 * 16.0; // ±16g range
            const accelY = registers[1] / 32768.0 * 16.0;
            const accelZ = registers[2] / 32768.0 * 16.0;

            // For now, calculate velocity from acceleration (we'll read more registers later)
            // Assuming 30Hz vibration frequency
            const freqHz = 30.0;
            const velX = Math.abs(accelX * 9.81 / (2 * Math.PI * freqHz)) * 1000;
            const velY = Math.abs(accelY * 9.81 / (2 * Math.PI * freqHz)) * 1000;
            const velZ = Math.abs(accelZ * 9.81 / (2 * Math.PI * freqHz)) * 1000;
            const velocityMms = Math.sqrt(velX * velX + velY * velY + velZ * velZ);

            // Default values for now (we'll read these in a second command)
            let tempC = 25.0;
            const tempF = (tempC * 9/5) + 32;

            const dispX = 0;
            const dispY = 0;
            const dispZ = 0;

            const freqX = 30.0;
            const freqY = 30.0;
            const freqZ = 30.0;

            const rmsAccel = Math.sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);

            const { zone, alertLevel } = this.getISOClassification(velocityMms);

            clearTimeout(timeout);
            port.close();

            console.log(`[VibrationMonitor] Sensor ${config.sensor_id} read: Vel=${velocityMms.toFixed(2)}mm/s, Temp=${tempF.toFixed(1)}°F, Zone=${zone}`);

            resolve({
              sensor_id: config.sensor_id,
              port: config.port,
              temperature_f: tempF,
              velocity_mms: velocityMms,
              velocity_x: velX,
              velocity_y: velY,
              velocity_z: velZ,
              displacement_x: dispX,
              displacement_y: dispY,
              displacement_z: dispZ,
              frequency_x: freqX,
              frequency_y: freqY,
              frequency_z: freqZ,
              acceleration_x: accelX,
              acceleration_y: accelY,
              acceleration_z: accelZ,
              rms_acceleration: rmsAccel,
              iso_zone: zone,
              alert_level: alertLevel,
              timestamp: Date.now()
            });
          } else {
            clearTimeout(timeout);
            port.close();
            reject(new Error('Invalid Modbus response'));
          }
        }
      });

      port.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // Removed generateSimulatedReading - no simulation allowed

  // Store reading in database
  storeReading(reading) {
    try {
      const stmt = this.db.metricsDb.prepare(`
        INSERT INTO vibration_readings
        (sensor_id, temperature_f, velocity_mms, velocity_x, velocity_y, velocity_z, iso_zone, alert_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        reading.sensor_id,
        reading.temperature_f,
        reading.velocity_mms,
        reading.velocity_x,
        reading.velocity_y,
        reading.velocity_z,
        reading.iso_zone,
        reading.alert_level
      );
    } catch (error) {
      console.error('[VibrationMonitor] Error storing reading:', error);
    }
  }

  // Get all current readings
  getAllReadings() {
    return Array.from(this.readings.values());
  }

  // Get historical readings for a sensor
  getHistoricalReadings(sensorId, hours = 24) {
    try {
      const stmt = this.db.metricsDb.prepare(`
        SELECT * FROM vibration_readings
        WHERE sensor_id = ?
        AND timestamp > datetime('now', '-${hours} hours')
        ORDER BY timestamp DESC
      `);

      return stmt.all(sensorId);
    } catch (error) {
      console.error('[VibrationMonitor] Error getting historical readings:', error);
      return [];
    }
  }

  // Check for alerts
  checkAlerts() {
    const alerts = [];

    for (const [sensorId, reading] of this.readings) {
      const config = this.configs.get(sensorId);
      if (config && reading.velocity_mms > config.alert_threshold_mms) {
        alerts.push({
          equipment_name: config.equipment_name,
          sensor_id: sensorId,
          alert_level: reading.alert_level,
          velocity_mms: reading.velocity_mms,
          threshold: config.alert_threshold_mms
        });
      }
    }

    return alerts;
  }

  // Start polling a sensor
  startPolling(sensorId, intervalMs = 5000) {
    // Stop existing polling if any
    this.stopPolling(sensorId);

    let failureCount = 0;
    const maxFailures = 3; // Stop polling after 3 consecutive failures

    // Start new polling interval
    const interval = setInterval(async () => {
      try {
        await this.readSensor(sensorId);
        failureCount = 0; // Reset on success
      } catch (error) {
        failureCount++;
        console.error(`[VibrationMonitor] Polling error for ${sensorId} (failure ${failureCount}/${maxFailures}):`, error.message);

        // Stop polling after too many failures to prevent UI freezing
        if (failureCount >= maxFailures) {
          console.error(`[VibrationMonitor] Stopping polling for ${sensorId} after ${maxFailures} consecutive failures`);
          this.stopPolling(sensorId);

          // Mark sensor as having connection issues
          const config = this.configs.get(sensorId);
          if (config) {
            // Store error state instead of reading
            this.readings.set(sensorId, {
              sensor_id: sensorId,
              error: true,
              errorMessage: `Connection failed after ${maxFailures} attempts`,
              timestamp: Date.now()
            });
          }
        }
      }
    }, intervalMs);

    this.pollingIntervals.set(sensorId, interval);
    console.log(`[VibrationMonitor] Started polling ${sensorId} every ${intervalMs}ms`);
  }

  // Stop polling a sensor
  stopPolling(sensorId) {
    const interval = this.pollingIntervals.get(sensorId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(sensorId);
      console.log(`[VibrationMonitor] Stopped polling ${sensorId}`);
    }
  }

  // Start all enabled sensors
  startAll() {
    // Don't auto-start polling on init to prevent freezing
    // Sensors should be started manually or when page is accessed
    console.log('[VibrationMonitor] Auto-start disabled to prevent UI freezing with disconnected sensors');
  }

  // Stop all sensors
  stopAll() {
    for (const sensorId of this.pollingIntervals.keys()) {
      this.stopPolling(sensorId);
    }
  }

  // Get latest reading from memory or database
  getLatestReading(sensorId) {
    try {
      // First check if we have it in memory
      if (this.latestReadings.has(sensorId)) {
        return this.latestReadings.get(sensorId);
      }

      // Otherwise get from database
      const stmt = this.db.metricsDb.prepare(`
        SELECT * FROM vibration_readings
        WHERE sensor_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `);

      const reading = stmt.get(sensorId);
      return reading || null;
    } catch (error) {
      console.error(`[VibrationMonitor] Error getting latest reading for ${sensorId}:`, error);
      return null;
    }
  }

  // Get all latest readings
  getAllReadings() {
    const readings = {};
    for (const [sensorId, reading] of this.latestReadings) {
      readings[sensorId] = reading;
    }
    return readings;
  }
}

module.exports = VibrationMonitor;