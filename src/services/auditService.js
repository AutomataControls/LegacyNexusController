// Audit Service - Tracks all user actions and UI changes
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class AuditService {
  constructor() {
    this.dbPath = path.join(__dirname, '../../data/audit.db');
    this.ensureDatabase();
  }

  ensureDatabase() {
    const db = new Database(this.dbPath);
    
    // Create audit_logs table with comprehensive tracking
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER,
        username TEXT,
        action_type TEXT NOT NULL,
        action_category TEXT,
        description TEXT,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        session_id TEXT,
        page_url TEXT,
        component TEXT,
        old_value TEXT,
        new_value TEXT,
        success BOOLEAN DEFAULT 1,
        error_message TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(username);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action_type);
      CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_logs(action_category);
    `);

    // Create user_sessions table for session management
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        user_id INTEGER,
        username TEXT,
        login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT,
        is_active BOOLEAN DEFAULT 1,
        logout_time DATETIME,
        logout_reason TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_session_id ON user_sessions(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_active ON user_sessions(is_active);
    `);

    // Create ui_state table for persistence
    db.exec(`
      CREATE TABLE IF NOT EXISTS ui_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        page TEXT NOT NULL,
        component TEXT,
        state_key TEXT NOT NULL,
        state_value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(username, page, state_key)
      );
      
      CREATE INDEX IF NOT EXISTS idx_ui_state_user ON ui_state(username);
      CREATE INDEX IF NOT EXISTS idx_ui_state_page ON ui_state(page);
    `);
    
    db.close();
  }

  // Log an audit event
  logAudit(data) {
    const db = new Database(this.dbPath);
    try {
      const stmt = db.prepare(`
        INSERT INTO audit_logs (
          user_id, username, action_type, action_category, description, 
          details, ip_address, user_agent, session_id, page_url, 
          component, old_value, new_value, success, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        data.userId || null,
        data.username || 'system',
        data.actionType,
        data.actionCategory || 'general',
        data.description,
        JSON.stringify(data.details || {}),
        data.ipAddress || null,
        data.userAgent || null,
        data.sessionId || null,
        data.pageUrl || null,
        data.component || null,
        data.oldValue || null,
        data.newValue || null,
        data.success !== false ? 1 : 0,
        data.errorMessage || null
      );
      
      return { success: true };
    } catch (error) {
      console.error('Audit log error:', error);
      return { success: false, error: error.message };
    } finally {
      db.close();
    }
  }

  // Track Node-RED deploy action
  logNodeRedDeploy(username, details) {
    return this.logAudit({
      username,
      actionType: 'NODE_RED_DEPLOY',
      actionCategory: 'node-red',
      description: `User ${username} deployed Node-RED flows`,
      details,
      component: 'Node-RED'
    });
  }

  // Track UI state changes
  logUIChange(data) {
    return this.logAudit({
      ...data,
      actionCategory: 'ui-change'
    });
  }

  // Save UI state for persistence
  saveUIState(username, page, stateKey, stateValue) {
    const db = new Database(this.dbPath);
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO ui_state (username, page, state_key, state_value, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `);
      
      stmt.run(username, page, stateKey, JSON.stringify(stateValue));
      return { success: true };
    } catch (error) {
      console.error('UI state save error:', error);
      return { success: false, error: error.message };
    } finally {
      db.close();
    }
  }

  // Load UI state
  loadUIState(username, page) {
    const db = new Database(this.dbPath);
    try {
      const stmt = db.prepare(`
        SELECT state_key, state_value 
        FROM ui_state 
        WHERE username = ? AND page = ?
      `);
      
      const rows = stmt.all(username, page);
      const state = {};
      
      rows.forEach(row => {
        try {
          state[row.state_key] = JSON.parse(row.state_value);
        } catch {
          state[row.state_key] = row.state_value;
        }
      });
      
      return { success: true, state };
    } catch (error) {
      console.error('UI state load error:', error);
      return { success: false, error: error.message };
    } finally {
      db.close();
    }
  }

  // Session management
  createSession(sessionId, userId, username, ipAddress, userAgent) {
    const db = new Database(this.dbPath);
    try {
      const stmt = db.prepare(`
        INSERT INTO user_sessions (session_id, user_id, username, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      stmt.run(sessionId, userId, username, ipAddress, userAgent);
      
      // Log login audit
      this.logAudit({
        userId,
        username,
        actionType: 'LOGIN',
        actionCategory: 'authentication',
        description: `User ${username} logged in`,
        ipAddress,
        userAgent,
        sessionId
      });
      
      return { success: true };
    } catch (error) {
      console.error('Session creation error:', error);
      return { success: false, error: error.message };
    } finally {
      db.close();
    }
  }

  // Update session activity
  updateSessionActivity(sessionId) {
    const db = new Database(this.dbPath);
    try {
      const stmt = db.prepare(`
        UPDATE user_sessions 
        SET last_activity = datetime('now')
        WHERE session_id = ? AND is_active = 1
      `);
      
      stmt.run(sessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      db.close();
    }
  }

  // Check session timeout (15 minutes for admin)
  checkSessionTimeout(sessionId, timeoutMinutes = 15) {
    const db = new Database(this.dbPath);
    try {
      const stmt = db.prepare(`
        SELECT 
          session_id,
          username,
          last_activity,
          (strftime('%s', 'now') - strftime('%s', last_activity)) / 60 as minutes_inactive
        FROM user_sessions 
        WHERE session_id = ? AND is_active = 1
      `);
      
      const session = stmt.get(sessionId);
      
      if (!session) {
        return { valid: false, reason: 'Session not found' };
      }
      
      if (session.minutes_inactive > timeoutMinutes) {
        // Expire the session
        this.endSession(sessionId, 'timeout');
        return { valid: false, reason: 'Session timeout' };
      }
      
      return { valid: true, session };
    } catch (error) {
      console.error('Session check error:', error);
      return { valid: false, reason: error.message };
    } finally {
      db.close();
    }
  }

  // End session
  endSession(sessionId, reason = 'logout') {
    const db = new Database(this.dbPath);
    try {
      // Get session info for audit
      const session = db.prepare('SELECT username FROM user_sessions WHERE session_id = ?').get(sessionId);
      
      const stmt = db.prepare(`
        UPDATE user_sessions 
        SET is_active = 0, logout_time = datetime('now'), logout_reason = ?
        WHERE session_id = ?
      `);
      
      stmt.run(reason, sessionId);
      
      // Log logout audit
      if (session) {
        this.logAudit({
          username: session.username,
          actionType: 'LOGOUT',
          actionCategory: 'authentication',
          description: `User ${session.username} logged out (${reason})`,
          sessionId
        });
      }
      
      return { success: true };
    } catch (error) {
      console.error('Session end error:', error);
      return { success: false, error: error.message };
    } finally {
      db.close();
    }
  }

  // Get audit logs
  getAuditLogs(filters = {}, limit = 100) {
    const db = new Database(this.dbPath);
    try {
      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params = [];
      
      if (filters.username) {
        query += ' AND username = ?';
        params.push(filters.username);
      }
      
      if (filters.actionType) {
        query += ' AND action_type = ?';
        params.push(filters.actionType);
      }
      
      if (filters.category) {
        query += ' AND action_category = ?';
        params.push(filters.category);
      }
      
      if (filters.startDate) {
        query += ' AND timestamp >= ?';
        params.push(filters.startDate);
      }
      
      if (filters.endDate) {
        query += ' AND timestamp <= ?';
        params.push(filters.endDate);
      }
      
      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);
      
      const stmt = db.prepare(query);
      const logs = stmt.all(...params);
      
      return { success: true, logs };
    } catch (error) {
      console.error('Get audit logs error:', error);
      return { success: false, error: error.message };
    } finally {
      db.close();
    }
  }

  // Clean up old sessions and logs
  cleanup(daysToKeep = 30) {
    const db = new Database(this.dbPath);
    try {
      // Clean old audit logs
      db.prepare(`
        DELETE FROM audit_logs 
        WHERE timestamp < datetime('now', '-${daysToKeep} days')
      `).run();
      
      // Clean old inactive sessions
      db.prepare(`
        DELETE FROM user_sessions 
        WHERE is_active = 0 AND logout_time < datetime('now', '-7 days')
      `).run();
      
      // Clean old UI states
      db.prepare(`
        DELETE FROM ui_state 
        WHERE updated_at < datetime('now', '-7 days')
      `).run();
      
      return { success: true };
    } catch (error) {
      console.error('Cleanup error:', error);
      return { success: false, error: error.message };
    } finally {
      db.close();
    }
  }
}

module.exports = new AuditService();