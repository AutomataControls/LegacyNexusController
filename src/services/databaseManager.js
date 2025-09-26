/**
 * Comprehensive Database Manager
 * SQLite3 databases for metrics, users, audit logs, alarms, and weather
 * 7-day retention with auto-compression and rolling delete
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const bcrypt = require('bcryptjs');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class DatabaseManager {
  constructor() {
    this.dbPath = path.join(__dirname, '../../data');
    this.archivePath = path.join(__dirname, '../../data/archives');
    this.maxDbSize = 100 * 1024 * 1024; // 100MB per database
    this.maxArchiveSize = 500 * 1024 * 1024; // 500MB total archive size
    this.retentionDays = 7;
    
    // Initialize all databases
    this.metricsDb = null;
    this.usersDb = null;
    this.auditDb = null;
    this.alarmsDb = null;
    this.weatherDb = null;
    
    this.initDatabases();
  }

  initDatabases() {
    // Create data directories if they don't exist
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true });
    }
    if (!fs.existsSync(this.archivePath)) {
      fs.mkdirSync(this.archivePath, { recursive: true });
    }

    // Initialize each database
    this.initMetricsDb();
    this.initUsersDb();
    this.initAuditDb();
    this.initAlarmsDb();
    this.initWeatherDb();
    
    // Start cleanup scheduler
    this.startCleanupScheduler();
  }

  // ==================== METRICS DATABASE ====================
  initMetricsDb() {
    const dbFile = path.join(this.dbPath, 'metrics.db');
    try {
      this.metricsDb = new Database(dbFile);
      console.log('Connected to metrics database');
      this.createMetricsTables();
    } catch (err) {
      console.error('Error opening metrics database:', err);
    }
  }

  createMetricsTables() {
    // System metrics table
    this.metricsDb.exec(`
      CREATE TABLE IF NOT EXISTS system_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        cpu_temp REAL,
        cpu_usage REAL,
        mem_percent INTEGER,
        mem_used INTEGER,
        mem_total INTEGER,
        disk_percent INTEGER,
        disk_used TEXT,
        disk_total TEXT,
        uptime INTEGER,
        network_status TEXT
      )
    `);

    // Node-RED readings table
    this.metricsDb.exec(`
      CREATE TABLE IF NOT EXISTS nodered_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        setpoint REAL,
        space_temp REAL,
        supply_temp REAL,
        amps REAL,
        triac1 BOOLEAN,
        triac2 BOOLEAN,
        triac3 BOOLEAN,
        triac4 BOOLEAN,
        ao1 INTEGER,
        ao2 INTEGER,
        ao3 INTEGER,
        ao4 INTEGER
      )
    `);

    // Equipment configuration table
    this.metricsDb.exec(`
      CREATE TABLE IF NOT EXISTS equipment_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        equipment_id TEXT UNIQUE NOT NULL,
        enabled BOOLEAN DEFAULT 0,
        logic_file_path TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        uploaded_by INTEGER,
        temperature_setpoint REAL DEFAULT 72,
        schedule_start TEXT DEFAULT '05:30',
        schedule_end TEXT DEFAULT '20:30',
        pid_config TEXT,
        board_config TEXT,
        auto_run_enabled BOOLEAN DEFAULT 0,
        polling_interval INTEGER DEFAULT 7
      )
    `);

    // Add new columns if they don't exist (for migration)
    try {
      this.metricsDb.exec(`ALTER TABLE equipment_config ADD COLUMN auto_run_enabled BOOLEAN DEFAULT 0`);
    } catch (e) {
      // Column already exists
    }
    try {
      this.metricsDb.exec(`ALTER TABLE equipment_config ADD COLUMN polling_interval INTEGER DEFAULT 7`);
    } catch (e) {
      // Column already exists
    }
    
    // Board manual control states table
    this.metricsDb.exec(`
      CREATE TABLE IF NOT EXISTS board_manual_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_type TEXT NOT NULL,
        board_id INTEGER DEFAULT 0,
        output_id INTEGER NOT NULL,
        output_type TEXT NOT NULL,
        state TEXT,
        value REAL,
        mode TEXT DEFAULT 'auto',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(board_type, board_id, output_id, output_type)
      )
    `);
    
    // Board configurations table
    this.metricsDb.exec(`
      CREATE TABLE IF NOT EXISTS board_configurations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )
    `);
    
    // Create indexes (nodered_readings is a VIEW, cannot be indexed)
    this.metricsDb.exec(`CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON system_metrics(timestamp)`);
    // Removed: CREATE INDEX on nodered_readings - it's a view, not a table
    this.metricsDb.exec(`CREATE INDEX IF NOT EXISTS idx_equipment_id ON equipment_config(equipment_id)`);
    this.metricsDb.exec(`CREATE INDEX IF NOT EXISTS idx_board_states ON board_manual_states(board_type, board_id)`);
  }

  // ==================== USERS DATABASE ====================
  initUsersDb() {
    const dbFile = path.join(this.dbPath, 'users.db');
    try {
      this.usersDb = new Database(dbFile);
      console.log('Connected to users database');
      this.createUsersTables();
    } catch (err) {
      console.error('Error opening users database:', err);
    }
  }

  createUsersTables() {
    // Users table
    this.usersDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'viewer',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        is_active BOOLEAN DEFAULT 1,
        two_factor_enabled BOOLEAN DEFAULT 0,
        two_factor_secret TEXT
      )
    `);

    // Sessions table
    this.usersDb.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        session_token TEXT UNIQUE NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Permissions table
    this.usersDb.exec(`
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        granted BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create indexes
    this.usersDb.exec(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
    this.usersDb.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)`);
    this.usersDb.exec(`CREATE INDEX IF NOT EXISTS idx_permissions_user ON permissions(user_id)`);

    // Create default admin user if none exists
    this.createDefaultAdmin();
  }

  createDefaultAdmin() {
    const adminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMe123!';
    const hashedPassword = bcrypt.hashSync(adminPassword, 10);

    const stmt = this.usersDb.prepare(`
      INSERT OR IGNORE INTO users (username, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(adminUsername, 'admin@automatacontrols.com', hashedPassword, 'admin');
  }

  // ==================== AUDIT LOG DATABASE ====================
  initAuditDb() {
    const dbFile = path.join(this.dbPath, 'audit.db');
    try {
      this.auditDb = new Database(dbFile);
      console.log('Connected to audit database');
      this.createAuditTables();
    } catch (err) {
      console.error('Error opening audit database:', err);
    }
  }

  createAuditTables() {
    // Audit log table
    this.auditDb.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER,
        username TEXT,
        action TEXT NOT NULL,
        resource TEXT,
        resource_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        status TEXT,
        details TEXT,
        error_message TEXT
      )
    `);

    // System events table
    this.auditDb.exec(`
      CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT NOT NULL,
        severity TEXT,
        source TEXT,
        message TEXT,
        details TEXT
      )
    `);

    // Configuration changes table
    this.auditDb.exec(`
      CREATE TABLE IF NOT EXISTS config_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER,
        username TEXT,
        config_type TEXT,
        config_key TEXT,
        old_value TEXT,
        new_value TEXT,
        reason TEXT
      )
    `);

    // Create indexes
    this.auditDb.exec(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`);
    this.auditDb.exec(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)`);
    this.auditDb.exec(`CREATE INDEX IF NOT EXISTS idx_system_events_timestamp ON system_events(timestamp)`);
    this.auditDb.exec(`CREATE INDEX IF NOT EXISTS idx_config_timestamp ON config_changes(timestamp)`);
  }

  // ==================== ALARMS DATABASE ====================
  initAlarmsDb() {
    const dbFile = path.join(this.dbPath, 'alarms.db');
    try {
      this.alarmsDb = new Database(dbFile);
      console.log('Connected to alarms database');
      this.createAlarmsTables();
    } catch (err) {
      console.error('Error opening alarms database:', err);
    }
  }

  createAlarmsTables() {
    // Active alarms table
    this.alarmsDb.exec(`
      CREATE TABLE IF NOT EXISTS active_alarms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarm_id TEXT UNIQUE NOT NULL,
        alarm_name TEXT NOT NULL,
        alarm_type TEXT,
        severity TEXT,
        parameter TEXT,
        current_value REAL,
        threshold_value REAL,
        triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        acknowledged BOOLEAN DEFAULT 0,
        acknowledged_by TEXT,
        acknowledged_at DATETIME,
        notes TEXT
      )
    `);

    // Alarm history table
    this.alarmsDb.exec(`
      CREATE TABLE IF NOT EXISTS alarm_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarm_id TEXT NOT NULL,
        alarm_name TEXT NOT NULL,
        alarm_type TEXT,
        severity TEXT,
        parameter TEXT,
        value REAL,
        threshold_value REAL,
        triggered_at DATETIME,
        cleared_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration_seconds INTEGER,
        acknowledged BOOLEAN,
        acknowledged_by TEXT,
        notes TEXT
      )
    `);

    // Alarm configurations table
    this.alarmsDb.exec(`
      CREATE TABLE IF NOT EXISTS alarm_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_name TEXT UNIQUE NOT NULL,
        parameter TEXT NOT NULL,
        alarm_type TEXT,
        min_threshold REAL,
        max_threshold REAL,
        severity TEXT,
        enabled BOOLEAN DEFAULT 1,
        delay_seconds INTEGER DEFAULT 0,
        email_notification BOOLEAN DEFAULT 0,
        sms_notification BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      )
    `);

    // Create indexes
    this.alarmsDb.exec(`CREATE INDEX IF NOT EXISTS idx_active_alarms_id ON active_alarms(alarm_id)`);
    this.alarmsDb.exec(`CREATE INDEX IF NOT EXISTS idx_alarm_history_timestamp ON alarm_history(triggered_at)`);
    this.alarmsDb.exec(`CREATE INDEX IF NOT EXISTS idx_alarm_configs_param ON alarm_configs(parameter)`);
  }

  // ==================== WEATHER DATABASE ====================
  initWeatherDb() {
    const dbFile = path.join(this.dbPath, 'weather.db');
    try {
      this.weatherDb = new Database(dbFile);
      console.log('Connected to weather database');
      this.createWeatherTables();
    } catch (err) {
      console.error('Error opening weather database:', err);
    }
  }

  createWeatherTables() {
    // Current weather table
    this.weatherDb.exec(`
      CREATE TABLE IF NOT EXISTS current_weather (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        location TEXT,
        zip_code TEXT,
        temperature REAL,
        feels_like REAL,
        temp_min REAL,
        temp_max REAL,
        humidity INTEGER,
        pressure INTEGER,
        wind_speed REAL,
        wind_deg INTEGER,
        wind_gust REAL,
        visibility INTEGER,
        clouds INTEGER,
        condition TEXT,
        description TEXT,
        icon TEXT,
        sunrise DATETIME,
        sunset DATETIME
      )
    `);

    // Settings table for weather and other app settings
    this.weatherDb.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Weather forecast table
    this.weatherDb.exec(`
      CREATE TABLE IF NOT EXISTS weather_forecast (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        location TEXT,
        forecast_time DATETIME,
        temperature REAL,
        feels_like REAL,
        temp_min REAL,
        temp_max REAL,
        humidity INTEGER,
        pressure INTEGER,
        wind_speed REAL,
        wind_deg INTEGER,
        clouds INTEGER,
        condition TEXT,
        description TEXT,
        icon TEXT,
        pop REAL,
        rain_volume REAL,
        snow_volume REAL
      )
    `);

    // Weather alerts table
    this.weatherDb.exec(`
      CREATE TABLE IF NOT EXISTS weather_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        location TEXT,
        sender_name TEXT,
        event TEXT,
        start_time DATETIME,
        end_time DATETIME,
        description TEXT,
        tags TEXT
      )
    `);

    // Create indexes
    this.weatherDb.exec(`CREATE INDEX IF NOT EXISTS idx_current_weather_timestamp ON current_weather(timestamp)`);
    this.weatherDb.exec(`CREATE INDEX IF NOT EXISTS idx_forecast_timestamp ON weather_forecast(forecast_time)`);
    this.weatherDb.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON weather_alerts(timestamp)`);
  }

  // ==================== INSERT METHODS ====================
  
  // Insert system metrics
  insertSystemMetrics(metrics) {
    try {
      const sql = `
        INSERT INTO system_metrics (
          cpu_temp, cpu_usage, mem_percent, mem_used, mem_total,
          disk_percent, disk_used, disk_total, uptime, network_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const stmt = this.metricsDb.prepare(sql);
      const result = stmt.run(
        metrics.cpu_temp,
        parseFloat(metrics.cpu_usage),
        metrics.mem_percent,
        metrics.mem_used,
        metrics.mem_total,
        metrics.disk_percent,
        metrics.disk_used,
        metrics.disk_total,
        metrics.uptime,
        metrics.network_status || 'Connected'
      );
      return Promise.resolve(result.lastInsertRowid);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Insert Node-RED readings
  insertNodeRedReadings(readings) {
    try {
      const sql = `
        INSERT INTO nodered_readings (
          setpoint, space_temp, supply_temp, amps,
          triac1, triac2, triac3, triac4,
          ao1, ao2, ao3, ao4
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const stmt = this.metricsDb.prepare(sql);
      const result = stmt.run(
        readings.inputs.setpoint,
        readings.inputs.space,
        readings.inputs.supply,
        readings.inputs.amps,
        readings.outputs.triacs.triac1 ? 1 : 0,
        readings.outputs.triacs.triac2 ? 1 : 0,
        readings.outputs.triacs.triac3 ? 1 : 0,
        readings.outputs.triacs.triac4 ? 1 : 0,
        readings.outputs.analog.ao1,
        readings.outputs.analog.ao2,
        readings.outputs.analog.ao3,
        readings.outputs.analog.ao4
      );
      return Promise.resolve(result.lastInsertRowid);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Insert Nexus Controller Metrics
  insertNexusControllerMetrics(metrics) {
    try {
      const sql = `
        INSERT INTO NexusControllerMetrics (
          setpoint,
          tower_loop_supply_temp, tower_loop_return_temp,
          hp_supply_temp, hp_return_temp, outdoor_air_temp,
          hx_effectiveness,
          tower_1_vfd_current_l1, tower_1_vfd_current_l3,
          tower_2_vfd_current_l1, tower_2_vfd_current_l3,
          tower_3_vfd_current_l1, tower_3_vfd_current_l3,
          pump_1_current, pump_2_current, pump_3_current,
          vfd_current_7, vfd_current_8,
          triac1, triac2, triac3, triac4,
          ao1, ao2, ao3, ao4,
          relay1, relay2, relay3, relay4, relay5, relay6, relay7, relay8,
          relay9, relay10, relay11, relay12, relay13, relay14, relay15, relay16
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const stmt = this.metricsDb.prepare(sql);
      const result = stmt.run(
        metrics.setpoint,
        metrics.tower_loop_supply_temp,
        metrics.tower_loop_return_temp,
        metrics.hp_supply_temp,
        metrics.hp_return_temp,
        metrics.outdoor_air_temp,
        metrics.hx_effectiveness,
        metrics.tower_1_vfd_current_l1,
        metrics.tower_1_vfd_current_l3,
        metrics.tower_2_vfd_current_l1,
        metrics.tower_2_vfd_current_l3,
        metrics.tower_3_vfd_current_l1,
        metrics.tower_3_vfd_current_l3,
        metrics.pump_1_current,
        metrics.pump_2_current,
        metrics.pump_3_current,
        metrics.vfd_current_7,
        metrics.vfd_current_8,
        metrics.triac1 ? 1 : 0,
        metrics.triac2 ? 1 : 0,
        metrics.triac3 ? 1 : 0,
        metrics.triac4 ? 1 : 0,
        metrics.ao1,
        metrics.ao2,
        metrics.ao3,
        metrics.ao4,
        metrics.relay1 ? 1 : 0,
        metrics.relay2 ? 1 : 0,
        metrics.relay3 ? 1 : 0,
        metrics.relay4 ? 1 : 0,
        metrics.relay5 ? 1 : 0,
        metrics.relay6 ? 1 : 0,
        metrics.relay7 ? 1 : 0,
        metrics.relay8 ? 1 : 0,
        metrics.relay9 ? 1 : 0,
        metrics.relay10 ? 1 : 0,
        metrics.relay11 ? 1 : 0,
        metrics.relay12 ? 1 : 0,
        metrics.relay13 ? 1 : 0,
        metrics.relay14 ? 1 : 0,
        metrics.relay15 ? 1 : 0,
        metrics.relay16 ? 1 : 0
      );
      return Promise.resolve(result.lastInsertRowid);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Insert audit log
  logAudit(audit) {
    try {
      const sql = `
        INSERT INTO audit_log (
          user_id, username, action, resource, resource_id,
          ip_address, user_agent, status, details, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const stmt = this.auditDb.prepare(sql);
      const result = stmt.run(
        audit.user_id,
        audit.username,
        audit.action,
        audit.resource,
        audit.resource_id,
        audit.ip_address,
        audit.user_agent,
        audit.status,
        audit.details,
        audit.error_message
      );
      return Promise.resolve(result.lastInsertRowid);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Insert or update alarm
  upsertAlarm(alarm) {
    try {
      // Check if alarm already exists
      const selectStmt = this.alarmsDb.prepare(
        'SELECT id FROM active_alarms WHERE alarm_id = ?'
      );
      const row = selectStmt.get(alarm.alarm_id);
      
      if (row) {
        // Update existing alarm
        const sql = `
          UPDATE active_alarms SET
            current_value = ?,
            threshold_value = ?,
            severity = ?
          WHERE alarm_id = ?
        `;
        
        const updateStmt = this.alarmsDb.prepare(sql);
        updateStmt.run(
          alarm.current_value,
          alarm.threshold_value,
          alarm.severity,
          alarm.alarm_id
        );
        return Promise.resolve(row.id);
      } else {
        // Insert new alarm
        const sql = `
          INSERT INTO active_alarms (
            alarm_id, alarm_name, alarm_type, severity,
            parameter, current_value, threshold_value
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        const insertStmt = this.alarmsDb.prepare(sql);
        const result = insertStmt.run(
          alarm.alarm_id,
          alarm.alarm_name,
          alarm.alarm_type,
          alarm.severity,
          alarm.parameter,
          alarm.current_value,
          alarm.threshold_value
        );
        return Promise.resolve(result.lastInsertRowid);
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Clear alarm
  clearAlarm(alarmId) {
    try {
      // Get alarm details
      const selectStmt = this.alarmsDb.prepare(
        'SELECT * FROM active_alarms WHERE alarm_id = ?'
      );
      const alarm = selectStmt.get(alarmId);
      
      if (!alarm) {
        return Promise.resolve(null);
      }
      
      // Calculate duration
      const triggered = new Date(alarm.triggered_at);
      const cleared = new Date();
      const duration = Math.floor((cleared - triggered) / 1000);
      
      // Insert into history
      const sql = `
        INSERT INTO alarm_history (
          alarm_id, alarm_name, alarm_type, severity,
          parameter, value, threshold_value, triggered_at,
          cleared_at, duration_seconds, acknowledged, acknowledged_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const insertStmt = this.alarmsDb.prepare(sql);
      insertStmt.run(
        alarm.alarm_id,
        alarm.alarm_name,
        alarm.alarm_type,
        alarm.severity,
        alarm.parameter,
        alarm.current_value,
        alarm.threshold_value,
        alarm.triggered_at,
        cleared.toISOString(),
        duration,
        alarm.acknowledged,
        alarm.acknowledged_by,
        alarm.notes
      );
      
      // Delete from active alarms
      const deleteStmt = this.alarmsDb.prepare(
        'DELETE FROM active_alarms WHERE alarm_id = ?'
      );
      const result = deleteStmt.run(alarmId);
      return Promise.resolve(result.changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Insert weather data
  insertWeatherData(weather) {
    try {
      const sql = `
        INSERT INTO current_weather (
          location, zip_code, temperature, feels_like, temp_min, temp_max,
          humidity, pressure, wind_speed, wind_deg, wind_gust,
          visibility, clouds, condition, description, icon, sunrise, sunset
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const stmt = this.weatherDb.prepare(sql);
      const result = stmt.run(
        weather.location,
        weather.zip_code,
        weather.temperature,
        weather.feels_like,
        weather.temp_min,
        weather.temp_max,
        weather.humidity,
        weather.pressure,
        weather.wind_speed,
        weather.wind_deg,
        weather.wind_gust,
        weather.visibility,
        weather.clouds,
        weather.condition,
        weather.description,
        weather.icon,
        weather.sunrise,
        weather.sunset
      );
      return Promise.resolve(result.lastInsertRowid);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Save app setting
  saveSetting(key, value) {
    try {
      const sql = `
        INSERT INTO app_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at = CURRENT_TIMESTAMP
      `;
      const stmt = this.weatherDb.prepare(sql);
      const result = stmt.run(key, value);
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      console.error('Error saving setting:', err);
      return { success: false, error: err.message };
    }
  }

  // Get app setting
  getSetting(key) {
    try {
      const sql = 'SELECT setting_value FROM app_settings WHERE setting_key = ?';
      const stmt = this.weatherDb.prepare(sql);
      const row = stmt.get(key);
      return row ? row.setting_value : null;
    } catch (err) {
      console.error('Error getting setting:', err);
      return null;
    }
  }

  // Save board manual state
  saveBoardState(boardType, boardId, outputId, outputType, state, value, mode) {
    try {
      const sql = `
        INSERT INTO board_manual_states (board_type, board_id, output_id, output_type, state, value, mode, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(board_type, board_id, output_id, output_type) DO UPDATE SET
          state = excluded.state,
          value = excluded.value,
          mode = excluded.mode,
          updated_at = CURRENT_TIMESTAMP
      `;
      const stmt = this.metricsDb.prepare(sql);
      const result = stmt.run(boardType, boardId || 0, outputId, outputType, state, value, mode);
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      console.error('Error saving board state:', err);
      return { success: false, error: err.message };
    }
  }

  // Get all board manual states
  getBoardStates() {
    try {
      const sql = 'SELECT * FROM board_manual_states ORDER BY board_type, board_id, output_id';
      const stmt = this.metricsDb.prepare(sql);
      const rows = stmt.all();
      return rows || [];
    } catch (err) {
      console.error('Error getting board states:', err);
      return [];
    }
  }

  // Save board configuration
  saveBoardConfiguration(configData, updatedBy) {
    try {
      const sql = `
        INSERT INTO board_configurations (config_data, updated_at, updated_by)
        VALUES (?, CURRENT_TIMESTAMP, ?)
      `;
      const stmt = this.metricsDb.prepare(sql);
      const result = stmt.run(JSON.stringify(configData), updatedBy || 'system');
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      console.error('Error saving board configuration:', err);
      return { success: false, error: err.message };
    }
  }

  // Get latest board configuration
  getBoardConfiguration() {
    try {
      const sql = 'SELECT * FROM board_configurations ORDER BY updated_at DESC LIMIT 1';
      const stmt = this.metricsDb.prepare(sql);
      const row = stmt.get();
      if (row) {
        return JSON.parse(row.config_data);
      }
      return null;
    } catch (err) {
      console.error('Error getting board configuration:', err);
      return null;
    }
  }

  // Get equipment configuration from board configs
  getEquipmentConfig() {
    try {
      // First try to get from board_configurations table
      const boardConfig = this.getBoardConfiguration();
      if (boardConfig) {
        // Transform board config to equipment config format
        const equipmentConfig = {
          inputs: {}
        };
        
        // Process each board config
        boardConfig.forEach(board => {
          if (board.inputs) {
            Object.entries(board.inputs).forEach(([channel, config]) => {
              if (config.enabled && config.name) {
                equipmentConfig.inputs[channel] = config;
              }
            });
          }
        });
        
        return equipmentConfig;
      }
      
      return null;
    } catch (err) {
      console.error('Error getting equipment config:', err);
      return null;
    }
  }

  // Get board configurations for boardController
  getBoardConfigs() {
    try {
      // Try to get from board_configs table (newer format)
      const sql = 'SELECT config FROM board_configs WHERE id = 1';
      const stmt = this.metricsDb.prepare(sql);
      const row = stmt.get();
      if (row && row.config) {
        return JSON.parse(row.config);
      }
      
      // Fallback to board_configurations table
      const boardConfig = this.getBoardConfiguration();
      if (boardConfig) {
        return boardConfig;
      }
      
      return [];
    } catch (err) {
      console.error('Error getting board configs:', err);
      return [];
    }
  }

  // ==================== PID CONTROLLER METHODS ====================

  // Initialize PID config table
  initPIDConfigTable() {
    try {
      this.metricsDb.exec(`
        CREATE TABLE IF NOT EXISTS pid_config (
          equipment_id TEXT NOT NULL,
          controller_type TEXT NOT NULL,
          kp REAL DEFAULT 1.0,
          ki REAL DEFAULT 0.1,
          kd REAL DEFAULT 0.0,
          output_min REAL DEFAULT 0,
          output_max REAL DEFAULT 100,
          reverse_acting INTEGER DEFAULT 0,
          max_integral REAL DEFAULT 100,
          enabled INTEGER DEFAULT 1,
          PRIMARY KEY (equipment_id, controller_type)
        )
      `);
    } catch (err) {
      console.error('Error creating PID config table:', err);
    }
  }

  // Get all PID controllers
  getPIDControllers() {
    try {
      // Make sure table exists
      this.initPIDConfigTable();

      const sql = 'SELECT * FROM pid_config ORDER BY equipment_id, controller_type';
      const stmt = this.metricsDb.prepare(sql);
      const rows = stmt.all();

      // Transform database format to frontend format
      return rows.map(row => ({
        equipmentId: row.equipment_id,
        controllerType: row.controller_type,
        name: `${row.equipment_id} - ${row.controller_type}`,
        enabled: row.enabled === 1,
        kp: row.kp,
        ki: row.ki,
        kd: row.kd,
        outputMin: row.output_min,
        outputMax: row.output_max,
        reverseActing: row.reverse_acting === 1,
        maxIntegral: row.max_integral,
        setpoint: 45.0  // Default setpoint for valve control
      }));
    } catch (err) {
      console.error('Error getting PID controllers:', err);
      return [];
    }
  }

  // Get PID controller by ID
  getPIDController(equipmentId, controllerType) {
    try {
      const sql = 'SELECT * FROM pid_config WHERE equipment_id = ? AND controller_type = ?';
      const stmt = this.metricsDb.prepare(sql);
      const row = stmt.get(equipmentId, controllerType);

      if (!row) return null;

      return {
        equipmentId: row.equipment_id,
        controllerType: row.controller_type,
        name: `${row.equipment_id} - ${row.controller_type}`,
        enabled: row.enabled === 1,
        kp: row.kp,
        ki: row.ki,
        kd: row.kd,
        outputMin: row.output_min,
        outputMax: row.output_max,
        reverseActing: row.reverse_acting === 1,
        maxIntegral: row.max_integral
      };
    } catch (err) {
      console.error('Error getting PID controller:', err);
      return null;
    }
  }

  // Update PID controller
  updatePIDController(equipmentId, controllerType, updates) {
    try {
      const allowedFields = ['kp', 'ki', 'kd', 'output_min', 'output_max', 'reverse_acting', 'max_integral', 'enabled'];
      const setClause = [];
      const values = [];

      for (const field of allowedFields) {
        let dbField = field;
        let value = updates[field];

        // Map frontend field names to database field names
        if (updates.outputMin !== undefined && field === 'output_min') {
          value = updates.outputMin;
        }
        if (updates.outputMax !== undefined && field === 'output_max') {
          value = updates.outputMax;
        }
        if (updates.reverseActing !== undefined && field === 'reverse_acting') {
          value = updates.reverseActing ? 1 : 0;
        }
        if (updates.maxIntegral !== undefined && field === 'max_integral') {
          value = updates.maxIntegral;
        }
        if (updates.enabled !== undefined && field === 'enabled') {
          value = updates.enabled ? 1 : 0;
        }

        if (value !== undefined) {
          setClause.push(`${dbField} = ?`);
          values.push(value);
        }
      }

      if (setClause.length === 0) {
        return { success: true, changes: 0 };
      }

      values.push(equipmentId, controllerType);
      const sql = `UPDATE pid_config SET ${setClause.join(', ')} WHERE equipment_id = ? AND controller_type = ?`;
      const stmt = this.metricsDb.prepare(sql);
      const result = stmt.run(...values);

      return { success: true, changes: result.changes };
    } catch (err) {
      console.error('Error updating PID controller:', err);
      throw err;
    }
  }

  // Create PID controller
  createPIDController(controller) {
    try {
      // Make sure table exists
      this.initPIDConfigTable();

      const sql = `
        INSERT OR REPLACE INTO pid_config (
          equipment_id, controller_type, kp, ki, kd,
          output_min, output_max, reverse_acting, max_integral, enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const stmt = this.metricsDb.prepare(sql);
      const result = stmt.run(
        controller.equipmentId || 'cooling_tower',
        controller.controllerType || 'valve_control',
        controller.kp !== undefined ? controller.kp : 2.5,
        controller.ki !== undefined ? controller.ki : 0.15,
        controller.kd !== undefined ? controller.kd : 0.05,
        controller.outputMin !== undefined ? controller.outputMin : 0.0,
        controller.outputMax !== undefined ? controller.outputMax : 10.0,
        controller.reverseActing ? 1 : 0,
        controller.maxIntegral !== undefined ? controller.maxIntegral : 50.0,
        controller.enabled !== false ? 1 : 0
      );

      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      console.error('Error creating PID controller:', err);
      throw err;
    }
  }

  // Delete PID controller
  deletePIDController(equipmentId, controllerType) {
    try {
      const sql = 'DELETE FROM pid_config WHERE equipment_id = ? AND controller_type = ?';
      const stmt = this.metricsDb.prepare(sql);
      const result = stmt.run(equipmentId, controllerType);

      return { success: true, changes: result.changes };
    } catch (err) {
      console.error('Error deleting PID controller:', err);
      throw err;
    }
  }

  // ==================== QUERY METHODS ====================

  // Get historical data from any table
  getHistoricalData(database, table, hours = 24) {
    try {
      const db = this[`${database}Db`];
      if (!db) {
        return Promise.reject(new Error(`Database ${database} not found`));
      }
      
      const sql = `
        SELECT * FROM ${table}
        WHERE timestamp > datetime('now', '-${hours} hours')
        ORDER BY timestamp DESC
      `;
      
      const stmt = db.prepare(sql);
      const rows = stmt.all();
      return Promise.resolve(rows);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Get active alarms
  getActiveAlarms() {
    try {
      const sql = 'SELECT * FROM active_alarms WHERE acknowledged = 0 ORDER BY triggered_at DESC';
      const stmt = this.alarmsDb.prepare(sql);
      const rows = stmt.all();
      return Promise.resolve(rows);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Get user by username
  getUserByUsername(username) {
    try {
      const sql = 'SELECT * FROM users WHERE username = ?';
      const stmt = this.usersDb.prepare(sql);
      const row = stmt.get(username);
      return Promise.resolve(row);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Validate user credentials
  async validateUser(username, password) {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return null;
    
    // Update last login
    const updateStmt = this.usersDb.prepare(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'
    );
    updateStmt.run(user.id);
    
    return user;
  }

  // ==================== ADDITIONAL CRUD OPERATIONS ====================
  
  // UPDATE Operations
  
  // Update user information
  updateUser(userId, updates) {
    try {
      const allowedFields = ['email', 'role', 'is_active', 'two_factor_enabled'];
      const setClause = [];
      const values = [];
      
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          setClause.push(`${field} = ?`);
          values.push(updates[field]);
        }
      }
      
      if (setClause.length === 0) {
        return Promise.resolve(0);
      }
      
      values.push(userId);
      const sql = `UPDATE users SET ${setClause.join(', ')} WHERE id = ?`;
      const stmt = this.usersDb.prepare(sql);
      const result = stmt.run(...values);
      return Promise.resolve(result.changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Update user password
  async updateUserPassword(userId, newPassword) {
    try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const stmt = this.usersDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
      const result = stmt.run(hashedPassword, userId);
      return Promise.resolve(result.changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Update alarm configuration
  updateAlarmConfig(configId, updates) {
    try {
      const allowedFields = ['min_threshold', 'max_threshold', 'severity', 'enabled', 
                            'delay_seconds', 'email_notification', 'sms_notification'];
      const setClause = [];
      const values = [];
      
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          setClause.push(`${field} = ?`);
          values.push(updates[field]);
        }
      }
      
      if (setClause.length === 0) {
        return Promise.resolve(0);
      }
      
      setClause.push('updated_at = CURRENT_TIMESTAMP');
      values.push(configId);
      
      const sql = `UPDATE alarm_configs SET ${setClause.join(', ')} WHERE id = ?`;
      const stmt = this.alarmsDb.prepare(sql);
      const result = stmt.run(...values);
      return Promise.resolve(result.changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Acknowledge alarm
  acknowledgeAlarm(alarmId, username, notes) {
    try {
      const sql = `
        UPDATE active_alarms 
        SET acknowledged = 1, 
            acknowledged_by = ?, 
            acknowledged_at = CURRENT_TIMESTAMP,
            notes = ?
        WHERE alarm_id = ?
      `;
      const stmt = this.alarmsDb.prepare(sql);
      const result = stmt.run(username, notes, alarmId);
      return Promise.resolve(result.changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // DELETE Operations
  
  // Delete user
  deleteUser(userId) {
    try {
      // Delete user's permissions first
      const permStmt = this.usersDb.prepare('DELETE FROM permissions WHERE user_id = ?');
      permStmt.run(userId);
      
      // Delete user's sessions
      const sessionStmt = this.usersDb.prepare('DELETE FROM sessions WHERE user_id = ?');
      sessionStmt.run(userId);
      
      // Delete user
      const userStmt = this.usersDb.prepare('DELETE FROM users WHERE id = ?');
      const result = userStmt.run(userId);
      return Promise.resolve(result.changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Delete expired sessions
  deleteExpiredSessions() {
    try {
      const sql = 'DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP';
      const stmt = this.usersDb.prepare(sql);
      const result = stmt.run();
      return Promise.resolve(result.changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Delete alarm configuration
  deleteAlarmConfig(configId) {
    try {
      const stmt = this.alarmsDb.prepare('DELETE FROM alarm_configs WHERE id = ?');
      const result = stmt.run(configId);
      return Promise.resolve(result.changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Delete old audit logs (manual cleanup)
  deleteOldAuditLogs(days) {
    try {
      const sql = `DELETE FROM audit_log WHERE timestamp < datetime('now', '-${days} days')`;
      const stmt = this.auditDb.prepare(sql);
      const result = stmt.run();
      return Promise.resolve(result.changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Delete old metrics (manual cleanup)
  deleteOldMetrics(days) {
    try {
      const sql = `DELETE FROM system_metrics WHERE timestamp < datetime('now', '-${days} days')`;
      const stmt = this.metricsDb.prepare(sql);
      const result = stmt.run();
      return Promise.resolve(result.changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // ADDITIONAL CREATE Operations
  
  // Create new user
  async createUser(userData) {
    try {
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const sql = `
        INSERT INTO users (username, email, password_hash, role)
        VALUES (?, ?, ?, ?)
      `;
      const stmt = this.usersDb.prepare(sql);
      const result = stmt.run(
        userData.username,
        userData.email,
        hashedPassword,
        userData.role || 'viewer'
      );
      return Promise.resolve(result.lastInsertRowid);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Create session
  createSession(userId, token, ipAddress, userAgent, expiresIn = 86400000) {
    try {
      const sql = `
        INSERT INTO sessions (user_id, session_token, ip_address, user_agent, expires_at)
        VALUES (?, ?, ?, ?, datetime('now', '+${expiresIn/1000} seconds'))
      `;
      const stmt = this.usersDb.prepare(sql);
      const result = stmt.run(userId, token, ipAddress, userAgent);
      return Promise.resolve(result.lastInsertRowid);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Create alarm configuration
  createAlarmConfig(config) {
    try {
      const sql = `
        INSERT INTO alarm_configs (
          config_name, parameter, alarm_type, min_threshold, max_threshold,
          severity, enabled, delay_seconds, email_notification, sms_notification
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const stmt = this.alarmsDb.prepare(sql);
      const result = stmt.run(
        config.config_name,
        config.parameter,
        config.alarm_type,
        config.min_threshold,
        config.max_threshold,
        config.severity || 'warning',
        config.enabled !== false,
        config.delay_seconds || 0,
        config.email_notification || false,
        config.sms_notification || false
      );
      return Promise.resolve(result.lastInsertRowid);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Add user permission
  addUserPermission(userId, resource, action, granted = true) {
    try {
      const sql = `
        INSERT INTO permissions (user_id, resource, action, granted)
        VALUES (?, ?, ?, ?)
      `;
      const stmt = this.usersDb.prepare(sql);
      const result = stmt.run(userId, resource, action, granted);
      return Promise.resolve(result.lastInsertRowid);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // ADDITIONAL READ Operations
  
  // Get all users
  getAllUsers() {
    try {
      const sql = 'SELECT id, username, email, role, created_at, last_login, is_active FROM users';
      const stmt = this.usersDb.prepare(sql);
      const rows = stmt.all();
      return Promise.resolve(rows);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Get user by ID
  getUserById(userId) {
    try {
      const sql = 'SELECT * FROM users WHERE id = ?';
      const stmt = this.usersDb.prepare(sql);
      const row = stmt.get(userId);
      return Promise.resolve(row);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Get user permissions
  getUserPermissions(userId) {
    try {
      const sql = 'SELECT * FROM permissions WHERE user_id = ?';
      const stmt = this.usersDb.prepare(sql);
      const rows = stmt.all(userId);
      return Promise.resolve(rows);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Get alarm configurations
  getAlarmConfigs(enabled = null) {
    try {
      let sql = 'SELECT * FROM alarm_configs';
      if (enabled !== null) {
        sql += ' WHERE enabled = ?';
      }
      sql += ' ORDER BY config_name';
      
      const stmt = this.alarmsDb.prepare(sql);
      const rows = enabled !== null ? stmt.all(enabled ? 1 : 0) : stmt.all();
      return Promise.resolve(rows);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Get alarm history
  getAlarmHistory(hours = 24) {
    try {
      const sql = `
        SELECT * FROM alarm_history
        WHERE triggered_at > datetime('now', '-${hours} hours')
        ORDER BY triggered_at DESC
      `;
      const stmt = this.alarmsDb.prepare(sql);
      const rows = stmt.all();
      return Promise.resolve(rows);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Get session by token
  getSessionByToken(token) {
    try {
      const sql = `
        SELECT s.*, u.username, u.role 
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.session_token = ? AND s.expires_at > CURRENT_TIMESTAMP
      `;
      const stmt = this.usersDb.prepare(sql);
      const row = stmt.get(token);
      return Promise.resolve(row);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Get latest metrics
  getLatestMetrics(limit = 1) {
    try {
      const sql = 'SELECT * FROM system_metrics ORDER BY timestamp DESC LIMIT ?';
      const stmt = this.metricsDb.prepare(sql);
      const rows = stmt.all(limit);
      return Promise.resolve(limit === 1 ? rows[0] : rows);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Get latest Node-RED readings
  getLatestNodeRedReadings(limit = 1) {
    try {
      const sql = 'SELECT * FROM nodered_readings ORDER BY timestamp DESC LIMIT ?';
      const stmt = this.metricsDb.prepare(sql);
      const rows = stmt.all(limit);
      return Promise.resolve(limit === 1 ? rows[0] : rows);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Get latest weather
  getLatestWeather() {
    try {
      const sql = 'SELECT * FROM current_weather ORDER BY timestamp DESC LIMIT 1';
      const stmt = this.weatherDb.prepare(sql);
      const row = stmt.get();
      return Promise.resolve(row);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  
  // Check user permission
  checkUserPermission(userId, resource, action) {
    try {
      const sql = `
        SELECT granted FROM permissions 
        WHERE user_id = ? AND resource = ? AND action = ?
      `;
      const stmt = this.usersDb.prepare(sql);
      const row = stmt.get(userId, resource, action);
      return Promise.resolve(row ? row.granted : false);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Get historical board data for trends
  getBoardHistoricalData(hours = 8) {
    try {
      const sql = `
        SELECT * FROM nodered_readings 
        WHERE datetime(timestamp) > datetime('now', '-${hours} hours')
        ORDER BY timestamp ASC
      `;
      const stmt = this.metricsDb.prepare(sql);
      const rows = stmt.all();
      
      // Transform data to format expected by TrendGraph
      return rows.map(row => {
        const data = JSON.parse(row.data);
        return {
          time: new Date(row.timestamp).toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            timeZone: 'America/New_York'
          }),
          setpoint: data.inputs?.setpoint,
          supply: data.inputs?.supply,
          return: data.inputs?.return,
          space: data.inputs?.space,
          oat: data.inputs?.oat,
          amps: data.inputs?.amps,
          triac1: data.outputs?.triacs?.triac1 ? 1 : 0,
          triac2: data.outputs?.triacs?.triac2 ? 1 : 0,
          triac3: data.outputs?.triacs?.triac3 ? 1 : 0,
          triac4: data.outputs?.triacs?.triac4 ? 1 : 0
        };
      });
    } catch (err) {
      console.error('Error getting board historical data:', err);
      return [];
    }
  }

  // Get database statistics for Database page
  getStatistics() {
    try {
      const stats = {
        databases: {},
        archive: {
          count: 0,
          size: 0
        }
      };

      // Get metrics database stats
      if (this.metricsDb) {
        stats.databases.metrics = {};
        
        // Get only actual tables, not views or backup tables
        const tablesStmt = this.metricsDb.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' 
          AND name NOT LIKE '%_backup' 
          AND name NOT IN ('sqlite_sequence')
          ORDER BY name
        `);
        const tables = tablesStmt.all();
        
        tables.forEach(table => {
          try {
            const stmt = this.metricsDb.prepare(`SELECT COUNT(*) as count FROM ${table.name}`);
            const result = stmt.get();
            stats.databases.metrics[table.name] = result.count;
          } catch (err) {
            stats.databases.metrics[table.name] = 0;
          }
        });
      }

      // Get users database stats
      if (this.usersDb) {
        stats.databases.users = {};
        const tablesStmt = this.usersDb.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' 
          AND name NOT LIKE '%_backup'
          AND name NOT IN ('sqlite_sequence')
          ORDER BY name
        `);
        const tables = tablesStmt.all();
        tables.forEach(table => {
          try {
            const stmt = this.usersDb.prepare(`SELECT COUNT(*) as count FROM ${table.name}`);
            const result = stmt.get();
            stats.databases.users[table.name] = result.count;
          } catch (err) {
            stats.databases.users[table.name] = 0;
          }
        });
      }

      // Get audit database stats
      if (this.auditDb) {
        stats.databases.audit = {};
        const tablesStmt = this.auditDb.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' 
          AND name NOT LIKE '%_backup'
          AND name NOT IN ('sqlite_sequence')
          ORDER BY name
        `);
        const tables = tablesStmt.all();
        tables.forEach(table => {
          try {
            const stmt = this.auditDb.prepare(`SELECT COUNT(*) as count FROM ${table.name}`);
            const result = stmt.get();
            stats.databases.audit[table.name] = result.count;
          } catch (err) {
            stats.databases.audit[table.name] = 0;
          }
        });
      }

      // Get alarms database stats
      if (this.alarmsDb) {
        stats.databases.alarms = {};
        const tablesStmt = this.alarmsDb.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' 
          AND name NOT LIKE '%_backup'
          AND name NOT IN ('sqlite_sequence')
          ORDER BY name
        `);
        const tables = tablesStmt.all();
        tables.forEach(table => {
          try {
            const stmt = this.alarmsDb.prepare(`SELECT COUNT(*) as count FROM ${table.name}`);
            const result = stmt.get();
            stats.databases.alarms[table.name] = result.count;
          } catch (err) {
            stats.databases.alarms[table.name] = 0;
          }
        });
      }

      // Get weather database stats
      if (this.weatherDb) {
        stats.databases.weather = {};
        const tablesStmt = this.weatherDb.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' 
          AND name NOT LIKE '%_backup'
          AND name NOT IN ('sqlite_sequence')
          ORDER BY name
        `);
        const tables = tablesStmt.all();
        tables.forEach(table => {
          try {
            const stmt = this.weatherDb.prepare(`SELECT COUNT(*) as count FROM ${table.name}`);
            const result = stmt.get();
            stats.databases.weather[table.name] = result.count;
          } catch (err) {
            stats.databases.weather[table.name] = 0;
          }
        });
      }

      return stats;
    } catch (err) {
      console.error('Error getting database statistics:', err);
      return {
        databases: {},
        archive: { count: 0, size: 0 }
      };
    }
  }

  // Clear all metrics data
  clearAllMetricsData() {
    try {
      let totalDeleted = 0;

      if (this.metricsDb) {
        // Clear NexusControllerMetrics (main metrics table)
        try {
          const stmt1 = this.metricsDb.prepare('DELETE FROM NexusControllerMetrics');
          const result1 = stmt1.run();
          totalDeleted += result1.changes;
        } catch (err) {
          console.error('Error clearing NexusControllerMetrics:', err);
        }

        // Clear system metrics
        try {
          const stmt2 = this.metricsDb.prepare('DELETE FROM system_metrics');
          const result2 = stmt2.run();
          totalDeleted += result2.changes;
        } catch (err) {
          console.error('Error clearing system_metrics:', err);
        }

        // Clear logic results
        try {
          const stmt3 = this.metricsDb.prepare('DELETE FROM logic_results');
          const result3 = stmt3.run();
          totalDeleted += result3.changes;
        } catch (err) {
          console.error('Error clearing logic_results:', err);
        }
      }

      console.log(`Cleared ${totalDeleted} metrics records`);
      return totalDeleted;
    } catch (err) {
      console.error('Error clearing metrics data:', err);
      throw err;
    }
  }

  // Clear all alarms data
  clearAllAlarmsData() {
    try {
      let totalDeleted = 0;
      
      if (this.alarmsDb) {
        // Clear alarm history (keep configurations)
        const stmt = this.alarmsDb.prepare('DELETE FROM alarm_history');
        const result = stmt.run();
        totalDeleted += result.changes;
      }

      console.log(`Cleared ${totalDeleted} alarm history records`);
      return totalDeleted;
    } catch (err) {
      console.error('Error clearing alarm data:', err);
      throw err;
    }
  }


  // ==================== CLEANUP METHODS ====================
  
  // Clean old data (7-day retention)
  async cleanOldData() {
    console.log('Starting database cleanup...');
    
    // Define tables to clean with their databases
    const cleanupTasks = [
      { db: this.metricsDb, tables: ['system_metrics', 'nodered_readings'] },
      { db: this.auditDb, tables: ['audit_log', 'system_events', 'config_changes'] },
      { db: this.alarmsDb, tables: ['alarm_history'] },
      { db: this.weatherDb, tables: ['current_weather', 'weather_forecast', 'weather_alerts'] }
    ];
    
    for (const task of cleanupTasks) {
      for (const table of task.tables) {
        await this.cleanTable(task.db, table);
      }
    }
    
    // Check database sizes
    await this.checkDatabaseSizes();
    
    // Check archive size
    await this.checkArchiveSize();
    
    console.log('Database cleanup completed');
  }

  cleanTable(db, table) {
    return new Promise(async (resolve, reject) => {
      try {
        // Get data older than 7 days for archiving
        const oldDataSql = `
          SELECT * FROM ${table}
          WHERE timestamp < datetime('now', '-${this.retentionDays} days')
          OR triggered_at < datetime('now', '-${this.retentionDays} days')
          OR created_at < datetime('now', '-${this.retentionDays} days')
        `;
        
        const stmt = db.prepare(oldDataSql);
        const rows = stmt.all();
        
        if (rows.length > 0) {
          // Archive the old data
          await this.archiveData(table, rows);
          
          // Delete from database
          const deleteSql = `
            DELETE FROM ${table}
            WHERE timestamp < datetime('now', '-${this.retentionDays} days')
            OR triggered_at < datetime('now', '-${this.retentionDays} days')
            OR created_at < datetime('now', '-${this.retentionDays} days')
          `;
          
          const deleteStmt = db.prepare(deleteSql);
          const result = deleteStmt.run();
          console.log(`Deleted ${result.changes} old records from ${table}`);
        }
        resolve();
      } catch (err) {
        console.error(`Error cleaning table ${table}:`, err);
        resolve();
      }
    });
  }

  // Archive data to compressed files
  async archiveData(table, data) {
    if (data.length === 0) return;
    
    const date = new Date().toISOString().split('T')[0];
    const filename = `${table}_${date}.json.gz`;
    const filepath = path.join(this.archivePath, filename);
    
    try {
      // Compress data
      const jsonData = JSON.stringify(data);
      const compressed = await gzip(jsonData);
      
      // Write to archive
      fs.writeFileSync(filepath, compressed);
      console.log(`Archived ${data.length} records from ${table} to ${filename}`);
    } catch (error) {
      console.error(`Error archiving data from ${table}:`, error);
    }
  }

  // Check database sizes
  async checkDatabaseSizes() {
    const databases = ['metrics', 'users', 'audit', 'alarms', 'weather'];
    
    for (const dbName of databases) {
      const dbFile = path.join(this.dbPath, `${dbName}.db`);
      
      if (fs.existsSync(dbFile)) {
        const stats = fs.statSync(dbFile);
        const sizeInBytes = stats.size;
        
        if (sizeInBytes > this.maxDbSize) {
          console.log(`${dbName} database size (${sizeInBytes} bytes) exceeds limit, performing cleanup...`);
          
          const db = this[`${dbName}Db`];
          if (db) {
            // Vacuum database to reclaim space
            db.exec('VACUUM');
          }
        }
      }
    }
  }

  // Check archive size and delete oldest archives if needed
  async checkArchiveSize() {
    if (!fs.existsSync(this.archivePath)) return;
    
    const files = fs.readdirSync(this.archivePath);
    let totalSize = 0;
    const fileStats = [];
    
    // Calculate total archive size
    for (const file of files) {
      const filepath = path.join(this.archivePath, file);
      const stats = fs.statSync(filepath);
      totalSize += stats.size;
      fileStats.push({ file, size: stats.size, mtime: stats.mtime });
    }
    
    if (totalSize > this.maxArchiveSize) {
      console.log(`Archive size (${totalSize} bytes) exceeds limit, deleting oldest archives...`);
      
      // Sort by modification time (oldest first)
      fileStats.sort((a, b) => a.mtime - b.mtime);
      
      // Delete oldest files until under limit
      let currentSize = totalSize;
      for (const fileStat of fileStats) {
        if (currentSize <= this.maxArchiveSize) break;
        
        const filepath = path.join(this.archivePath, fileStat.file);
        fs.unlinkSync(filepath);
        currentSize -= fileStat.size;
        console.log(`Deleted archive: ${fileStat.file}`);
      }
    }
  }

  // Schedule cleanup tasks
  startCleanupScheduler() {
    // Run cleanup daily at 2 AM
    const scheduleCleanup = () => {
      const now = new Date();
      const night = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1, // Tomorrow
        2, 0, 0 // 2:00:00 AM
      );
      const msToNight = night.getTime() - now.getTime();
      
      setTimeout(() => {
        this.cleanOldData();
        scheduleCleanup(); // Schedule next cleanup
      }, msToNight);
      
      console.log(`Next cleanup scheduled for ${night.toISOString()}`);
    };
    
    scheduleCleanup();
  }


  // Get historical data from a specific table
  async getHistoricalData(database, table, hours = 24, sortColumn = null, sortOrder = 'DESC') {
    try {
      const db = this[`${database}Db`];
      if (!db) {
        throw new Error(`Database ${database} not found`);
      }

      // Sanitize sort parameters to prevent SQL injection
      const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Build query based on table type
      let query;
      if (table === 'nodered_readings') {
        // For nodered_readings, get recent data
        const orderBy = sortColumn ? `${sortColumn} ${validSortOrder}` : `timestamp ${validSortOrder}`;
        query = `
          SELECT * FROM ${table}
          WHERE timestamp > datetime('now', '-${hours} hours')
          ORDER BY ${orderBy}
          LIMIT 1000
        `;
      } else if (table.includes('history') || table.includes('log')) {
        // For history/log tables, get recent entries
        const orderBy = sortColumn ? `${sortColumn} ${validSortOrder}` : `timestamp ${validSortOrder}`;
        query = `
          SELECT * FROM ${table}
          ORDER BY ${orderBy}
          LIMIT 1000
        `;
      } else {
        // For other tables, get all data (limited)
        if (sortColumn) {
          query = `
            SELECT * FROM ${table}
            ORDER BY ${sortColumn} ${validSortOrder}
            LIMIT 1000
          `;
        } else {
          // Try to find a timestamp column for default ordering
          query = `
            SELECT * FROM ${table}
            ORDER BY
              CASE
                WHEN EXISTS (SELECT 1 FROM pragma_table_info('${table}') WHERE name = 'timestamp') THEN timestamp
                WHEN EXISTS (SELECT 1 FROM pragma_table_info('${table}') WHERE name = 'created_at') THEN created_at
                WHEN EXISTS (SELECT 1 FROM pragma_table_info('${table}') WHERE name = 'id') THEN id
                ELSE rowid
              END ${validSortOrder}
            LIMIT 1000
          `;
        }
      }

      const stmt = db.prepare(query);
      const rows = stmt.all();
      return rows || [];
    } catch (err) {
      console.error(`Error getting data from ${database}.${table}:`, err);
      return [];
    }
  }

  // Close all database connections
  close() {
    const databases = ['metricsDb', 'usersDb', 'auditDb', 'alarmsDb', 'weatherDb'];
    
    databases.forEach(dbName => {
      const db = this[dbName];
      if (db) {
        try {
          db.close();
          console.log(`${dbName} connection closed`);
        } catch (err) {
          console.error(`Error closing ${dbName}:`, err);
        }
      }
    });
  }
}

// Export singleton instance
module.exports = new DatabaseManager();