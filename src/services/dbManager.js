/**
 * Database Manager with better-sqlite3
 * Works properly on ARM/Raspberry Pi architecture
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const bcrypt = require('bcryptjs');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);

class DatabaseManager {
  constructor() {
    this.dbPath = path.join(__dirname, '../../data');
    this.archivePath = path.join(__dirname, '../../data/archives');
    this.maxDbSize = 100 * 1024 * 1024; // 100MB per database
    this.maxArchiveSize = 500 * 1024 * 1024; // 500MB total archive size
    this.retentionDays = 7;
    
    this.initDatabases();
  }

  initDatabases() {
    // Create data directories
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true });
    }
    if (!fs.existsSync(this.archivePath)) {
      fs.mkdirSync(this.archivePath, { recursive: true });
    }

    // Initialize databases
    this.metricsDb = new Database(path.join(this.dbPath, 'metrics.db'));
    this.usersDb = new Database(path.join(this.dbPath, 'users.db'));
    this.auditDb = new Database(path.join(this.dbPath, 'audit.db'));
    this.alarmsDb = new Database(path.join(this.dbPath, 'alarms.db'));
    this.weatherDb = new Database(path.join(this.dbPath, 'weather.db'));

    // Create tables
    this.createTables();
    
    // Start cleanup scheduler
    this.startCleanupScheduler();
    
    console.log('Database manager initialized with 5 databases');
  }

  createTables() {
    // METRICS DATABASE
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
      );
      
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
      );
      
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON system_metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_nodered_timestamp ON nodered_readings(timestamp);
    `);

    // USERS DATABASE
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
      );
      
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        session_token TEXT UNIQUE NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
    `);

    // Create default admin user
    const adminPassword = bcrypt.hashSync('AutomataAdmin2024!', 10);
    const stmt = this.usersDb.prepare(`
      INSERT OR IGNORE INTO users (username, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run('admin', 'admin@automatacontrols.com', adminPassword, 'admin');

    // AUDIT DATABASE
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
      );
      
      CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT NOT NULL,
        severity TEXT,
        source TEXT,
        message TEXT,
        details TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_system_events_timestamp ON system_events(timestamp);
    `);

    // ALARMS DATABASE
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
      );
      
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
      );
      
      CREATE INDEX IF NOT EXISTS idx_active_alarms_id ON active_alarms(alarm_id);
      CREATE INDEX IF NOT EXISTS idx_alarm_history_timestamp ON alarm_history(triggered_at);
    `);

    // WEATHER DATABASE
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
      );
      
      CREATE TABLE IF NOT EXISTS weather_forecast (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        location TEXT,
        forecast_time DATETIME,
        temperature REAL,
        feels_like REAL,
        humidity INTEGER,
        pressure INTEGER,
        wind_speed REAL,
        condition TEXT,
        icon TEXT,
        pop REAL
      );
      
      CREATE INDEX IF NOT EXISTS idx_current_weather_timestamp ON current_weather(timestamp);
      CREATE INDEX IF NOT EXISTS idx_forecast_timestamp ON weather_forecast(forecast_time);
    `);
  }

  // INSERT METHODS
  insertSystemMetrics(metrics) {
    try {
      const stmt = this.metricsDb.prepare(`
        INSERT INTO system_metrics (
          cpu_temp, cpu_usage, mem_percent, mem_used, mem_total,
          disk_percent, disk_used, disk_total, uptime, network_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
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
      
      return result.lastInsertRowid;
    } catch (error) {
      console.error('Error inserting system metrics:', error);
      return null;
    }
  }

  insertNodeRedReadings(readings) {
    try {
      const stmt = this.metricsDb.prepare(`
        INSERT INTO nodered_readings (
          setpoint, space_temp, supply_temp, amps,
          triac1, triac2, triac3, triac4,
          ao1, ao2, ao3, ao4
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
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
      
      return result.lastInsertRowid;
    } catch (error) {
      console.error('Error inserting Node-RED readings:', error);
      return null;
    }
  }

  insertWeatherData(weather) {
    try {
      const stmt = this.weatherDb.prepare(`
        INSERT INTO current_weather (
          location, zip_code, temperature, feels_like, temp_min, temp_max,
          humidity, pressure, wind_speed, wind_deg, visibility,
          clouds, condition, description, icon
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        weather.location,
        weather.zip_code,
        weather.temperature,
        weather.feelsLike,
        weather.temp_min,
        weather.temp_max,
        weather.humidity,
        weather.pressure,
        weather.windSpeed,
        weather.windDirection || weather.windDeg,
        weather.visibility,
        weather.clouds,
        weather.condition,
        weather.description,
        weather.icon
      );
      
      return result.lastInsertRowid;
    } catch (error) {
      console.error('Error inserting weather data:', error);
      return null;
    }
  }

  logAudit(audit) {
    try {
      const stmt = this.auditDb.prepare(`
        INSERT INTO audit_log (
          user_id, username, action, resource, resource_id,
          ip_address, user_agent, status, details, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
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
      
      return result.lastInsertRowid;
    } catch (error) {
      console.error('Error logging audit:', error);
      return null;
    }
  }

  // QUERY METHODS
  getHistoricalData(database, table, hours = 24) {
    try {
      const db = this[`${database}Db`];
      const stmt = db.prepare(`
        SELECT * FROM ${table}
        WHERE timestamp > datetime('now', '-${hours} hours')
        ORDER BY timestamp DESC
      `);
      
      return stmt.all();
    } catch (error) {
      console.error(`Error getting historical data from ${table}:`, error);
      return [];
    }
  }

  getActiveAlarms() {
    try {
      const stmt = this.alarmsDb.prepare(`
        SELECT * FROM active_alarms 
        WHERE acknowledged = 0 
        ORDER BY triggered_at DESC
      `);
      
      return stmt.all();
    } catch (error) {
      console.error('Error getting active alarms:', error);
      return [];
    }
  }

  getUserByUsername(username) {
    try {
      const stmt = this.usersDb.prepare('SELECT * FROM users WHERE username = ?');
      return stmt.get(username);
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  async validateUser(username, password) {
    const user = this.getUserByUsername(username);
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

  // CLEANUP METHODS
  async cleanOldData() {
    console.log('Starting database cleanup...');
    
    const databases = [
      { db: this.metricsDb, tables: ['system_metrics', 'nodered_readings'] },
      { db: this.auditDb, tables: ['audit_log', 'system_events'] },
      { db: this.alarmsDb, tables: ['alarm_history'] },
      { db: this.weatherDb, tables: ['current_weather', 'weather_forecast'] }
    ];
    
    for (const { db, tables } of databases) {
      for (const table of tables) {
        try {
          // Get old data for archiving
          const oldDataStmt = db.prepare(`
            SELECT * FROM ${table}
            WHERE timestamp < datetime('now', '-${this.retentionDays} days')
          `);
          const oldData = oldDataStmt.all();
          
          if (oldData.length > 0) {
            // Archive the data
            await this.archiveData(table, oldData);
            
            // Delete old data
            const deleteStmt = db.prepare(`
              DELETE FROM ${table}
              WHERE timestamp < datetime('now', '-${this.retentionDays} days')
            `);
            const result = deleteStmt.run();
            console.log(`Deleted ${result.changes} old records from ${table}`);
          }
        } catch (error) {
          console.error(`Error cleaning ${table}:`, error);
        }
      }
      
      // Vacuum database
      try {
        db.exec('VACUUM');
      } catch (error) {
        console.error('Error vacuuming database:', error);
      }
    }
    
    await this.checkArchiveSize();
    console.log('Database cleanup completed');
  }

  async archiveData(table, data) {
    if (data.length === 0) return;
    
    const date = new Date().toISOString().split('T')[0];
    const filename = `${table}_${date}.json.gz`;
    const filepath = path.join(this.archivePath, filename);
    
    try {
      const jsonData = JSON.stringify(data);
      const compressed = await gzip(jsonData);
      fs.writeFileSync(filepath, compressed);
      console.log(`Archived ${data.length} records from ${table} to ${filename}`);
    } catch (error) {
      console.error(`Error archiving data from ${table}:`, error);
    }
  }

  async checkArchiveSize() {
    if (!fs.existsSync(this.archivePath)) return;
    
    const files = fs.readdirSync(this.archivePath);
    let totalSize = 0;
    const fileStats = [];
    
    for (const file of files) {
      const filepath = path.join(this.archivePath, file);
      const stats = fs.statSync(filepath);
      totalSize += stats.size;
      fileStats.push({ file, size: stats.size, mtime: stats.mtime });
    }
    
    if (totalSize > this.maxArchiveSize) {
      console.log(`Archive size (${totalSize} bytes) exceeds limit, deleting oldest archives...`);
      
      fileStats.sort((a, b) => a.mtime - b.mtime);
      
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

  startCleanupScheduler() {
    // Run cleanup daily at 2 AM
    const scheduleCleanup = () => {
      const now = new Date();
      const night = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        2, 0, 0
      );
      const msToNight = night.getTime() - now.getTime();
      
      setTimeout(() => {
        this.cleanOldData();
        scheduleCleanup();
      }, msToNight);
      
      console.log(`Next cleanup scheduled for ${night.toISOString()}`);
    };
    
    scheduleCleanup();
  }

  // Get statistics
  getStatistics() {
    const stats = {
      databases: {},
      archive: {}
    };
    
    const databases = [
      { name: 'metrics', db: this.metricsDb, tables: ['system_metrics', 'nodered_readings'] },
      { name: 'users', db: this.usersDb, tables: ['users', 'sessions'] },
      { name: 'audit', db: this.auditDb, tables: ['audit_log', 'system_events'] },
      { name: 'alarms', db: this.alarmsDb, tables: ['active_alarms', 'alarm_history'] },
      { name: 'weather', db: this.weatherDb, tables: ['current_weather', 'weather_forecast'] }
    ];
    
    for (const { name, db, tables } of databases) {
      stats.databases[name] = {};
      
      for (const table of tables) {
        try {
          const countStmt = db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
          const result = countStmt.get();
          stats.databases[name][table] = result.count;
        } catch (error) {
          stats.databases[name][table] = 0;
        }
      }
      
      // Add file size
      const dbFile = path.join(this.dbPath, `${name}.db`);
      if (fs.existsSync(dbFile)) {
        const dbStats = fs.statSync(dbFile);
        stats.databases[name].size = dbStats.size;
      }
    }
    
    // Archive statistics
    if (fs.existsSync(this.archivePath)) {
      const archiveFiles = fs.readdirSync(this.archivePath);
      let archiveSize = 0;
      
      archiveFiles.forEach(file => {
        const filepath = path.join(this.archivePath, file);
        archiveSize += fs.statSync(filepath).size;
      });
      
      stats.archive.count = archiveFiles.length;
      stats.archive.size = archiveSize;
    }
    
    return stats;
  }

  // Close all databases
  close() {
    try {
      this.metricsDb.close();
      this.usersDb.close();
      this.auditDb.close();
      this.alarmsDb.close();
      this.weatherDb.close();
      console.log('All database connections closed');
    } catch (error) {
      console.error('Error closing databases:', error);
    }
  }
}

module.exports = new DatabaseManager();