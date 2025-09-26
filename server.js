/*
 * AutomataControls™ Remote Portal - Server
 * Copyright © 2024 AutomataNexus, LLC. All rights reserved.
 * 
 * PROPRIETARY AND CONFIDENTIAL
 * This software is proprietary to AutomataNexus and constitutes valuable 
 * trade secrets. This software may not be copied, distributed, modified, 
 * or disclosed to third parties without prior written authorization from 
 * AutomataNexus. Use of this software is governed by a commercial license
 * agreement. Unauthorized use is strictly prohibited.
 * 
 * AutomataNexusBms Controller Software
 */

require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ["GET", "POST"]
  }
});
const pty = require('node-pty');
const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const winston = require('winston');

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API);

// Database Manager - commented out for now to prevent connection loops
// const DatabaseManager = require('./src/services/databaseManager');
// const dbManager = new DatabaseManager();

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

if (process.env.LOG_TO_FILE === 'true') {
  logger.add(new winston.transports.File({ 
    filename: path.join(process.env.LOG_PATH || '/var/log', 'automata-portal.log')
  }));
}

// Initialize database manager
const db = require('./src/services/databaseManager');
logger.info('Database manager initialized');

// Initialize audit service
const auditService = require('./src/services/auditService');
logger.info('Audit service initialized');

// Schedule daily cleanup of old audit logs and sessions
setInterval(() => {
  auditService.cleanup(30); // Keep 30 days of logs
  logger.info('Audit cleanup completed');
}, 24 * 60 * 60 * 1000); // Run once per day

// Node-RED poller DISABLED - not needed, using board readings directly
// const NodeRedPoller = require('./src/services/nodeRedPoller');
// const nodeRedPoller = new NodeRedPoller(db);
// nodeRedPoller.start();

// Initialize Alarm Monitor with existing database connection
const AlarmMonitor = require('./src/services/alarmMonitor');
const alarmMonitor = new AlarmMonitor(db);
logger.info('Alarm monitor initialized');

// Initialize Vibration Monitor
const VibrationMonitor = require('./src/services/vibrationMonitor');
const vibrationMonitor = new VibrationMonitor(db);
logger.info('Vibration monitor initialized');

// Set up alarm monitoring to check board readings every 30 seconds
setInterval(async () => {
  try {
    const readings = await boardController.getCurrentReadings();
    // Format readings for alarm monitor (same format as current-readings API)
    const formatted = {
      inputs: readings.inputs || {},
      outputs: {
        triacs: readings.triacs || {},
        analog: readings.outputs || {},
        relays: readings.relays || {}
      }
    };
    alarmMonitor.checkThresholds(formatted);
  } catch (error) {
    logger.error('Error checking thresholds:', error);
  }
}, 30000);

// Initialize board controller
const boardController = require('./src/services/boardController');
logger.info('Board controller initialized');

// Initialize logic executor
const LogicExecutor = require('./src/services/logicExecutor');
const logicExecutor = new LogicExecutor();
logger.info('Logic executor initialized');

// Vibration monitor already initialized above on line 85-87

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Disabled for iframe compatibility
}));

// Commenting out rate limiting for internal portal use
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: parseInt(process.env.RATE_LIMIT || '10000')
// });
// app.use('/api', limiter);

// JSON middleware - but exclude Node-RED paths
app.use((req, res, next) => {
  if (req.path.startsWith('/node-red') || 
      req.path.startsWith('/vendor') || 
      req.path.startsWith('/red') ||
      req.path.startsWith('/flows') ||
      req.path.startsWith('/flow')) {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// Serve static files (CSS, JS, images, etc.)
// This MUST come before the catch-all route
app.use('/static', express.static(path.join(__dirname, 'public', 'static')));
app.use('/automata-nexus-logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'automata-nexus-logo.png'));
});

// Proxy Node-RED FIRST - before static files
const nodeRedProxy = createProxyMiddleware({
  target: 'http://localhost:1880',
  changeOrigin: true,
  ws: true,
  logLevel: 'error',
  onProxyRes: (proxyRes, req, res) => {
    // Cache static assets
    if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$/)) {
      proxyRes.headers['cache-control'] = 'public, max-age=86400';
    }
    // Disable Cloudflare Rocket Loader for Node-RED assets
    proxyRes.headers['cf-cache-status'] = 'BYPASS';
  }
});

// Apply Node-RED proxy routes BEFORE static files
app.use('/node-red', createProxyMiddleware({
  target: 'http://localhost:1880',
  changeOrigin: true,
  ws: true,
  pathRewrite: { '^/node-red': '' },
  onProxyReq: (proxyReq, req, res) => {
    // Fix body parsing for POST/PUT requests
    if (req.body && (req.method === 'POST' || req.method === 'PUT')) {
      const bodyData = JSON.stringify(req.body);
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
      proxyReq.write(bodyData);
    }
  }
}));
app.use('/vendor', nodeRedProxy);
app.use('/red', nodeRedProxy);
app.use('/icons', nodeRedProxy);
app.use('/locales', nodeRedProxy);
app.use('/settings', nodeRedProxy);

// Serve static files from public directory AFTER proxy
app.use(express.static(path.join(__dirname, 'public')));

// Authentication middleware with session timeout
const authenticateRequest = async (req, res, next) => {
  // First check for Bearer token (from web UI)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key');
      req.user = decoded;
      
      // Check session timeout for admin users (15 minutes)
      if (decoded.role === 'admin' && decoded.sessionId) {
        const sessionCheck = auditService.checkSessionTimeout(decoded.sessionId, 15);
        if (!sessionCheck.valid) {
          logger.warn(`Session timeout for user ${decoded.username}: ${sessionCheck.reason}`);
          return res.status(401).json({ error: 'Session expired', reason: sessionCheck.reason });
        }
        // Update session activity
        auditService.updateSessionActivity(decoded.sessionId);
      }
      
      return next();
    } catch (error) {
      // Invalid token, continue to check API key
    }
  }
  
  // Fallback to API key check (for external systems)
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.API_AUTH_KEY) {
    req.user = { username: 'api-user', role: 'admin' };
    return next();
  }
  
  logger.warn(`Unauthorized access attempt from ${req.ip}`);
  auditService.logAudit({
    actionType: 'UNAUTHORIZED_ACCESS',
    actionCategory: 'security',
    description: `Unauthorized access attempt from ${req.ip}`,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    pageUrl: req.originalUrl,
    success: false
  });
  return res.status(401).json({ error: 'Unauthorized' });
};

// Apply authentication to protected API routes only
app.use('/api', (req, res, next) => {
  // Skip authentication for auth endpoints and public data endpoints
  if (req.path.startsWith('/auth/') ||
      req.path === '/system-info' ||
      req.path === '/weather' ||
      req.path === '/network-info' ||
      req.path.startsWith('/historical/') ||
      req.path === '/thresholds' ||
      req.path.startsWith('/boards/current-readings') ||
      req.path.startsWith('/boards/historical-data') ||
      req.path === '/setpoint' ||
      req.path.startsWith('/logic/results/') ||
      req.path.startsWith('/vibration/') ||
      req.path.startsWith('/alarms')) {
    return next();
  }
  // Apply authentication to all other API routes
  authenticateRequest(req, res, next);
});

// Auth endpoints
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  // Use credentials from environment variables
  const validUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
  const validPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin';
  
  if (username === validUsername && password === validPassword) {
    const token = jwt.sign(
      { username, role: 'admin' },
      process.env.JWT_SECRET || 'default-secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: { username, role: 'admin' }
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Removed duplicate POST verify endpoint - using GET instead

// Store terminal sessions
const terminals = {};

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// System info endpoint
app.get('/api/system-info', async (req, res) => {
  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  
  try {
    const hostname = require('os').hostname();
    const uptime = require('os').uptime();
    
    // Get CPU temp (Raspberry Pi specific)
    const cpuTemp = await execPromise('vcgencmd measure_temp')
      .then(r => r.stdout.trim().split('=')[1])
      .catch(() => 'N/A');
    
    // Get memory info
    const memInfo = await execPromise('free -m').then(r => {
      const lines = r.stdout.split('\n');
      const mem = lines[1].split(/\s+/);
      return {
        total: parseInt(mem[1]),
        used: parseInt(mem[2]),
        free: parseInt(mem[3]),
        percent: Math.round((parseInt(mem[2]) / parseInt(mem[1])) * 100)
      };
    });
    
    // Get disk usage
    const diskInfo = await execPromise('df -h /').then(r => {
      const lines = r.stdout.split('\n');
      const disk = lines[1].split(/\s+/);
      return {
        total: disk[1],
        used: disk[2],
        available: disk[3],
        percent: parseInt(disk[4])
      };
    });
    
    // Get CPU usage
    const cpuUsage = await execPromise("top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'")
      .then(r => parseFloat(r.stdout.trim()))
      .catch(() => 0);
    
    const systemData = {
      hostname,
      serial: process.env.CONTROLLER_SERIAL || 'AutomataNexusBms-XXXXXX',
      location: process.env.LOCATION || 'Unknown',
      uptime: Math.floor(uptime),
      cpu_temp: cpuTemp,
      cpu_usage: cpuUsage.toFixed(1),
      mem_total: memInfo.total,
      mem_used: memInfo.used,
      mem_free: memInfo.free,
      mem_percent: memInfo.percent,
      disk_total: diskInfo.total,
      disk_used: diskInfo.used,
      disk_available: diskInfo.available,
      disk_percent: diskInfo.percent,
      timestamp: new Date().toISOString()
    };
    
    // Save to database
    db.insertSystemMetrics(systemData).catch(err => {
      logger.error('Failed to save system metrics:', err);
    });
    
    res.json(systemData);
    
    logger.info('System info requested');
  } catch (error) {
    logger.error('System info error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== AUTHENTICATION ROUTES ====================

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = await db.validateUser(username, password);
    
    if (!user) {
      auditService.logAudit({
        username: username,
        actionType: 'LOGIN_FAILED',
        actionCategory: 'authentication',
        description: `Failed login attempt for user ${username}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        success: false
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate unique session ID
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role, sessionId },
      process.env.JWT_SECRET || 'default-secret-key',
      { expiresIn: user.role === 'admin' ? '15m' : '24h' } // 15 min for admin, 24h for others
    );
    
    // Create session in audit service
    auditService.createSession(sessionId, user.id, user.username, req.ip, req.headers['user-agent']);
    
    // Also create in db for backward compatibility
    await db.createSession(user.id, token, req.ip, req.headers['user-agent']);
    
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify token endpoint
app.get('/api/auth/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key');
    
    // Return the decoded user info
    res.json({
      id: decoded.userId || decoded.id || 1,
      username: decoded.username,
      role: decoded.role
    });
  } catch (error) {
    logger.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout endpoint
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key');
        if (decoded.sessionId) {
          // End session in audit service
          auditService.endSession(decoded.sessionId, 'logout');
        }
      } catch (err) {
        // Token invalid, but still allow logout
      }
      
      await db.deleteExpiredSessions();
    }
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ==================== DATABASE API ROUTES ====================

// Get database statistics
app.get('/api/database/stats', async (req, res) => {
  try {
    const stats = await db.getStatistics();
    res.json(stats);
  } catch (error) {
    logger.error('Database stats error:', error);
    res.status(500).json({ error: 'Failed to get database statistics' });
  }
});

// Get table data
app.get('/api/database/:database/:table', async (req, res) => {
  try {
    const { database, table } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const hours = parseInt(req.query.hours) || 24;
    const sort = req.query.sort || null;
    const order = req.query.order || 'desc';

    const data = await db.getHistoricalData(database, table, hours, sort, order);
    const limitedData = data.slice(0, limit);
    
    // Format for display
    if (limitedData.length > 0) {
      let headers = Object.keys(limitedData[0]);
      let displayHeaders = [...headers];
      
      // If this is the NexusControllerMetrics table or nodered_readings view, 
      // map column names to friendly names based on board config
      if (table === 'NexusControllerMetrics' || table === 'nodered_readings') {
        const boardConfigs = db.getBoardConfigs();
        const columnMappings = {};
        
        // Map temperature columns
        columnMappings['tower_loop_supply_temp'] = 'Tower Loop Supply Temp';
        columnMappings['tower_loop_return_temp'] = 'Tower Loop Return Temp';
        columnMappings['hp_supply_temp'] = 'HP Supply Temp';
        columnMappings['hp_return_temp'] = 'HP Return Temp';
        columnMappings['outdoor_air_temp'] = 'Outdoor Air Temp';
        columnMappings['space_temp'] = 'Space Temp';
        columnMappings['supply_temp'] = 'Supply Temp';
        
        // Map current columns
        columnMappings['tower_1_vfd_current_l1'] = 'Tower 1 L1 (A)';
        columnMappings['tower_1_vfd_current_l3'] = 'Tower 1 L3 (A)';
        columnMappings['tower_2_vfd_current_l1'] = 'Tower 2 L1 (A)';
        columnMappings['tower_2_vfd_current_l3'] = 'Tower 2 L3 (A)';
        columnMappings['tower_3_vfd_current_l1'] = 'Tower 3 L1 (A)';
        columnMappings['tower_3_vfd_current_l3'] = 'Tower 3 L3 (A)';
        columnMappings['pump_1_current'] = 'Pump 1 (A)';
        columnMappings['pump_2_current'] = 'Pump 2 (A)';
        columnMappings['pump_3_current'] = 'Pump 3 (A)';
        columnMappings['amps'] = 'Current (A)';
        
        // Map output columns based on configuration
        if (boardConfigs && boardConfigs.length > 0) {
          boardConfigs.forEach(board => {
            if (board.enabled && board.outputs && board.boardType === 'megabas') {
              Object.entries(board.outputs).forEach(([key, output]) => {
                if (output && output.name) {
                  if (key <= 4) {
                    columnMappings[`triac${key}`] = output.name;
                  } else {
                    columnMappings[`ao${key - 4}`] = output.name;
                  }
                }
              });
            }
          });
        }
        
        // Map relay columns if configured
        const relay16Config = boardConfigs.find(c => c.boardType === '16relind' && c.enabled);
        if (relay16Config && relay16Config.outputs) {
          Object.entries(relay16Config.outputs).forEach(([key, output]) => {
            if (output && output.name) {
              columnMappings[`relay${key}`] = output.name;
            }
          });
        }
        
        // Apply mappings to headers
        displayHeaders = headers.map(h => {
          const mapped = columnMappings[h.toLowerCase()];
          if (mapped) return mapped;
          
          // Capitalize and clean up unmapped headers
          return h.replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase())
            .replace(/Id\b/g, 'ID')
            .replace(/Ao(\d+)/g, 'AO$1')
            .replace(/Triac(\d+)/g, 'Triac $1');
        });
      }
      
      // Format rows with both raw and converted values for sensor data
      const rows = limitedData.map(row => {
        return headers.map(h => {
          const value = row[h];
          const colName = h.toLowerCase();
          
          // Format temperature values
          if (colName.includes('temp') && !colName.includes('timestamp') && value !== null && value !== undefined) {
            const numVal = parseFloat(value);
            if (!isNaN(numVal)) {
              // If it looks like a raw BALCO value (900-1200 range), convert it
              if (numVal > 900 && numVal < 1200) {
                const tempF = (Math.sqrt((0.00644 * numVal) - 1.6597) - 1.961) / 0.00322;
                return `${tempF.toFixed(1)}°F (${numVal.toFixed(0)}Ω)`;
              }
              // Otherwise it's already in Fahrenheit
              return `${numVal.toFixed(1)}°F`;
            }
          }
          
          // Format current values
          if ((colName.includes('current') || colName.includes('amps')) && value !== null && value !== undefined) {
            const numVal = parseFloat(value);
            if (!isNaN(numVal)) {
              return `${numVal.toFixed(1)}A`;
            }
          }
          
          // Format boolean values for triacs and relays
          if ((colName.includes('triac') || colName.includes('relay')) && !colName.includes('name')) {
            if (value === 1 || value === true) return 'ON';
            if (value === 0 || value === false) return 'OFF';
          }
          
          // Format analog outputs (0-100 scale to 0-10V)
          if (colName.includes('ao') && !colName.includes('name') && value !== null && value !== undefined) {
            const numVal = parseFloat(value);
            if (!isNaN(numVal)) {
              const voltage = (numVal / 100) * 10;
              return `${voltage.toFixed(1)}V (${numVal}%)`;
            }
          }
          
          // Format timestamps
          if (colName.includes('timestamp') || colName.includes('time')) {
            if (value) {
              const date = new Date(value);
              if (!isNaN(date.getTime())) {
                return date.toLocaleString('en-US', { 
                  timeZone: 'America/New_York',
                  month: 'short',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                });
              }
            }
          }
          
          // Return raw value for everything else
          return value;
        });
      });
      
      res.json({ headers: displayHeaders, rows });
    } else {
      res.json({ headers: [], rows: [] });
    }
  } catch (error) {
    logger.error('Table data error:', error);
    res.status(500).json({ error: 'Failed to get table data' });
  }
});

// Execute query (SELECT only for safety)
app.post('/api/database/query', async (req, res) => {
  try {
    const { database, query } = req.body;
    
    // Basic safety check - only allow SELECT queries
    if (!query.trim().toUpperCase().startsWith('SELECT')) {
      return res.status(400).json({ error: 'Only SELECT queries are allowed' });
    }
    
    const dbInstance = db[`${database}Db`];
    if (!dbInstance) {
      return res.status(400).json({ error: 'Invalid database' });
    }
    
    const stmt = dbInstance.prepare(query);
    const rows = stmt.all();
    
    res.json({ rows });
  } catch (error) {
    logger.error('Query execution error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export data
app.get('/api/database/export/:database/:table', async (req, res) => {
  try {
    const { database, table } = req.params;
    const format = req.query.format || 'json';
    
    const data = await db.getHistoricalData(database, table, 168); // 7 days
    
    if (format === 'csv') {
      const headers = data.length > 0 ? Object.keys(data[0]) : [];
      const csv = [
        headers.join(','),
        ...data.map(row => headers.map(h => JSON.stringify(row[h])).join(','))
      ].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${table}.csv"`);
      res.send(csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${table}.json"`);
      res.json(data);
    }
  } catch (error) {
    logger.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Database cleanup
app.post('/api/database/cleanup', authenticateRequest, async (req, res) => {
  try {
    const { database, days } = req.body;
    
    let deletedRows = 0;
    
    if (database === 'metrics') {
      deletedRows = await db.deleteOldMetrics(days);
    } else if (database === 'audit') {
      deletedRows = await db.deleteOldAuditLogs(days);
    } else {
      return res.status(400).json({ error: 'Invalid database for cleanup' });
    }
    
    // Log to audit
    auditService.logAudit({
      username: req.user.username,
      actionType: 'DATABASE_CLEANUP',
      actionCategory: 'database',
      description: `Cleaned up ${database} database (${deletedRows} old records)`,
      component: 'database',
      details: { database, days, deletedRows },
      success: true
    });
    
    res.json({ deletedRows });
  } catch (error) {
    logger.error('Cleanup error:', error);
    res.status(500).json({ error: 'Failed to cleanup database' });
  }
});

// Clear all metrics data
app.post('/api/database/clear-metrics', authenticateRequest, async (req, res) => {
  try {
    const deletedRows = await db.clearAllMetricsData();
    
    // Log to audit
    auditService.logAudit({
      username: req.user.username,
      actionType: 'CLEAR_METRICS',
      actionCategory: 'database',
      description: `Cleared all metrics data (${deletedRows} records)`,
      component: 'database',
      details: { deletedRows },
      success: true
    });
    
    res.json({ success: true, deletedRows });
  } catch (error) {
    logger.error('Clear metrics error:', error);
    res.status(500).json({ error: 'Failed to clear metrics data' });
  }
});

// Clear all alarms data
app.post('/api/database/clear-alarms', authenticateRequest, async (req, res) => {
  try {
    const deletedRows = await db.clearAllAlarmsData();
    
    // Log to audit
    auditService.logAudit({
      username: req.user.username,
      actionType: 'CLEAR_ALARMS',
      actionCategory: 'database',
      description: `Cleared all alarm history data (${deletedRows} records)`,
      component: 'database',
      details: { deletedRows },
      success: true
    });
    
    res.json({ success: true, deletedRows });
  } catch (error) {
    logger.error('Clear alarms error:', error);
    res.status(500).json({ error: 'Failed to clear alarms data' });
  }
});

// Historical data for trend graphs
app.get('/api/historical/:graphType', async (req, res) => {
  try {
    const { graphType } = req.params;
    const hours = parseInt(req.query.hours) || 8;
    
    let data = [];
    
    if (graphType === 'temperature') {
      // Get temperature data from nodered_readings
      const readings = await db.getHistoricalData('metrics', 'nodered_readings', hours);
      data = readings.map(r => ({
        time: new Date(r.timestamp).getTime(),
        setpoint: r.setpoint || null,
        supply: r.supply || null,
        space: r.space || null
      }));
    } else if (graphType === 'amps') {
      // Get amps data from nodered_readings
      const readings = await db.getHistoricalData('metrics', 'nodered_readings', hours);
      data = readings.map(r => ({
        time: new Date(r.timestamp).getTime(),
        amps: r.amps || null
      }));
    } else if (graphType === 'triacs') {
      // Get triac data from nodered_readings
      const readings = await db.getHistoricalData('metrics', 'nodered_readings', hours);
      data = readings.map(r => ({
        time: new Date(r.timestamp).getTime(),
        triac1: r.triac1 || 0,
        triac2: r.triac2 || 0,
        triac3: r.triac3 || 0,
        triac4: r.triac4 || 0
      }));
    }
    
    res.json(data);
  } catch (error) {
    logger.error('Historical data error:', error);
    res.status(500).json({ error: 'Failed to get historical data' });
  }
});

// Get thresholds
app.get('/api/thresholds', async (req, res) => {
  try {
    // For now, return hardcoded values. In production, these would come from database or config
    const thresholds = {
      high: 85,  // High temperature threshold
      low: 65    // Low temperature threshold
    };
    
    res.json(thresholds);
  } catch (error) {
    logger.error('Thresholds error:', error);
    res.status(500).json({ error: 'Failed to get thresholds' });
  }
});

// Node-RED data storage endpoint
app.post('/api/nodered/readings', async (req, res) => {
  try {
    const readings = req.body;
    
    // Validate data structure
    if (!readings.inputs || !readings.outputs) {
      return res.status(400).json({ error: 'Invalid data format' });
    }
    
    // Store in database
    await db.insertNodeRedReadings(readings);
    
    res.json({ success: true, message: 'Readings stored successfully' });
  } catch (error) {
    logger.error('Node-RED readings storage error:', error);
    res.status(500).json({ error: 'Failed to store readings' });
  }
});

// Network info endpoint
app.get('/api/network-info', async (req, res) => {
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Get network interfaces
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let ipAddress = 'Not connected';
    
    // Find the first non-internal IPv4 address
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ipAddress = iface.address;
          break;
        }
      }
      if (ipAddress !== 'Not connected') break;
    }
    
    res.json({
      ipAddress,
      hostname: os.hostname(),
      uptime: os.uptime()
    });
  } catch (error) {
    logger.error('Network info error:', error);
    res.status(500).json({ error: 'Failed to get network info' });
  }
});

// Weather API endpoint
app.get('/api/weather', async (req, res) => {
  if (process.env.WEATHER_ENABLED !== 'true') {
    return res.json({
      temperature: 72,
      condition: 'Weather Disabled',
      humidity: 0,
      location: process.env.LOCATION || 'Local',
      icon: '01d'
    });
  }
  
  try {
    const axios = require('axios');
    const location = process.env.WEATHER_LOCATION || 'New York,US';
    const units = process.env.WEATHER_UNITS || 'imperial';
    const apiKey = process.env.OPENWEATHER_API;
    
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${location}&units=${units}&appid=${apiKey}`
    );
    
    const data = response.data;
    // Calculate wet bulb temperature
    const T = data.main.temp; // Temperature in F
    const RH = data.main.humidity; // Relative humidity in %
    const P = data.main.pressure * 0.02953; // Convert hPa to inHg

    // Simplified wet bulb calculation for HVAC applications
    // More accurate than the simple approximation
    let wetBulbF;
    if (T >= 80) {
      // For hot weather (typical cooling season)
      wetBulbF = T - ((100 - RH) * 0.22);
    } else if (T >= 60) {
      // For moderate temps
      wetBulbF = T - ((100 - RH) * 0.20);
    } else {
      // For cool weather
      wetBulbF = T - ((100 - RH) * 0.17);
    }

    const weatherData = {
      temperature: Math.round(data.main.temp),
      condition: data.weather[0].main,
      humidity: data.main.humidity,
      location: data.name,
      icon: data.weather[0].icon,
      windSpeed: Math.round(data.wind.speed),
      windDirection: data.wind.deg,
      pressure: data.main.pressure,
      feelsLike: Math.round(data.main.feels_like),
      visibility: data.visibility,
      clouds: data.clouds?.all,
      description: data.weather[0].description,
      temp_min: data.main.temp_min,
      temp_max: data.main.temp_max,
      zip_code: location,
      wetBulb: Math.round(wetBulbF * 10) / 10 // Round to 1 decimal
    };
    
    // Save weather data to database
    db.insertWeatherData(weatherData).catch(err => {
      logger.error('Failed to save weather data:', err);
    });
    
    res.json(weatherData);
  } catch (error) {
    logger.error('Weather API error:', error);
    res.json({
      temperature: 72,
      condition: 'API Error',
      humidity: 65,
      location: 'Local',
      icon: '01d'
    });
  }
});

// Update weather location (ZIP code)
app.post('/api/settings/weather-location', authenticateRequest, async (req, res) => {
  try {
    const { zipCode } = req.body;
    
    // Validate ZIP code
    if (!zipCode || !/^\d{5}$/.test(zipCode)) {
      return res.status(400).json({ error: 'Invalid ZIP code format' });
    }
    
    // Update .env file with new ZIP code
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    // Update WEATHER_LOCATION in the env content
    const weatherLocationRegex = /^WEATHER_LOCATION=.*$/m;
    const newWeatherLocation = `WEATHER_LOCATION=${zipCode},US`;
    
    if (weatherLocationRegex.test(envContent)) {
      envContent = envContent.replace(weatherLocationRegex, newWeatherLocation);
    } else {
      // Add it if it doesn't exist
      envContent += `\n${newWeatherLocation}`;
    }
    
    // Write the updated .env file
    fs.writeFileSync(envPath, envContent);
    
    // Update process.env
    process.env.WEATHER_LOCATION = `${zipCode},US`;
    
    // Log the change to audit
    auditService.logAudit({
      username: req.user.username,
      actionType: 'SETTINGS_UPDATE',
      actionCategory: 'configuration',
      description: `Updated weather location to ZIP: ${zipCode}`,
      component: 'weather',
      details: { zipCode },
      success: true
    });
    
    res.json({ 
      success: true, 
      message: 'Weather location updated successfully',
      zipCode 
    });
    
  } catch (error) {
    logger.error('Weather location update error:', error);
    res.status(500).json({ error: 'Failed to update weather location' });
  }
});

// Database API endpoints - removed for now until properly implemented
// The database functionality needs the database manager to be properly configured
// to avoid connection loops

// ==================== UI STATE PERSISTENCE API ====================

// Save UI state
app.post('/api/ui-state/save', authenticateRequest, async (req, res) => {
  try {
    const { page, stateKey, stateValue } = req.body;
    const username = req.user.username;
    
    const result = auditService.saveUIState(username, page, stateKey, stateValue);
    
    // Log UI state change
    auditService.logAudit({
      username,
      actionType: 'UI_STATE_SAVE',
      actionCategory: 'ui-change',
      description: `Saved UI state for ${page}`,
      component: page,
      details: { stateKey },
      success: result.success
    });
    
    res.json(result);
  } catch (error) {
    logger.error('UI state save error:', error);
    res.status(500).json({ error: 'Failed to save UI state' });
  }
});

// Load UI state
app.get('/api/ui-state/load/:page', authenticateRequest, async (req, res) => {
  try {
    const { page } = req.params;
    const username = req.user.username;
    
    const result = auditService.loadUIState(username, page);
    res.json(result);
  } catch (error) {
    logger.error('UI state load error:', error);
    res.status(500).json({ error: 'Failed to load UI state' });
  }
});

// ==================== AUDIT API ENDPOINTS ====================

// Get audit logs with filtering
app.get('/api/audit/logs', authenticateRequest, async (req, res) => {
  try {
    const filters = {
      username: req.query.username,
      actionType: req.query.actionType,
      category: req.query.category,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };
    
    const limit = parseInt(req.query.limit) || 100;
    const result = auditService.getAuditLogs(filters, limit);
    
    res.json(result.logs || []);
  } catch (error) {
    logger.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Failed to get audit logs' });
  }
});

// Log UI change
app.post('/api/audit/ui-change', authenticateRequest, async (req, res) => {
  try {
    const data = {
      ...req.body,
      username: req.user.username,
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    };
    
    const result = auditService.logUIChange(data);
    res.json(result);
  } catch (error) {
    logger.error('Log UI change error:', error);
    res.status(500).json({ error: 'Failed to log UI change' });
  }
});

// Node-RED deploy audit endpoint
app.post('/api/audit/nodered-deploy', authenticateRequest, async (req, res) => {
  try {
    const username = req.user.username;
    const details = req.body;
    
    const result = auditService.logNodeRedDeploy(username, {
      ...details,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Node-RED deploy audit error:', error);
    res.status(500).json({ error: 'Failed to log Node-RED deploy' });
  }
});

// Get audit logs (legacy endpoint)
app.get('/api/audit/logs-legacy', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (hours * 60 * 60 * 1000));
    
    // Get audit logs from database - check if auditDb exists
    if (!db.auditDb) {
      logger.warn('Audit database not initialized');
      return res.json([]);
    }
    
    const stmt = db.auditDb.prepare(`
      SELECT * FROM audit_log 
      WHERE timestamp >= ? 
      ORDER BY timestamp DESC 
      LIMIT 1000
    `);
    const logs = stmt.all(startTime.toISOString());
    
    res.json(logs || []);
  } catch (error) {
    logger.error('Get audit logs error:', error);
    // Return empty array instead of error to avoid breaking the UI
    res.json([]);
  }
});

// ==================== LOGIC ENGINE API ENDPOINTS ====================

// Upload and execute equipment logic files
app.post('/api/logic/execute', authenticateRequest, async (req, res) => {
  try {
    const { logicFile, equipmentId, pollingInterval = 7 } = req.body;
    
    if (!logicFile || !equipmentId) {
      return res.status(400).json({ error: 'Logic file and equipment ID required' });
    }
    
    // Save logic file
    const logicDir = path.join(__dirname, 'logic', 'equipment');
    const logicPath = path.join(logicDir, `${equipmentId}.js`);
    
    if (!fs.existsSync(logicDir)) {
      fs.mkdirSync(logicDir, { recursive: true });
    }
    
    fs.writeFileSync(logicPath, logicFile);
    
    // Save configuration for the service
    const configPath = path.join(__dirname, 'data', 'logic_executor_config.json');
    const config = {
      enabled: true,
      autoRunEnabled: true,
      equipmentId: equipmentId,
      logicFilePath: logicPath,
      pollingInterval: pollingInterval,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.username
    };
    
    // Ensure data directory exists
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    // Start or restart the PM2 service
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    try {
      // Check if service is running
      const { stdout } = await execPromise('pm2 list');
      
      if (stdout.includes('logic-executor')) {
        // Restart the service to pick up new configuration
        await execPromise('pm2 restart logic-executor');
        logger.info('Logic executor service restarted');
      } else {
        // Start the service
        await execPromise('pm2 start logicExecutor.config.js');
        logger.info('Logic executor service started');
        
        // Save PM2 configuration for auto-start on reboot
        await execPromise('pm2 save');
      }
      
      res.json({ 
        success: true, 
        message: 'Logic execution started as background service',
        equipmentId,
        pollingInterval
      });
    } catch (pmError) {
      logger.error('PM2 error:', pmError);
      // Fallback to in-process execution
      await logicExecutor.loadBoardConfigs();
      const loaded = await logicExecutor.loadLogicFile(logicPath);
      
      if (loaded) {
        logicExecutor.startExecution(pollingInterval);
        res.json({ 
          success: true, 
          message: 'Logic execution started (in-process)',
          equipmentId 
        });
      } else {
        res.status(400).json({ error: 'Failed to load logic file' });
      }
    }
  } catch (error) {
    logger.error('Logic execution error:', error);
    res.status(500).json({ error: 'Failed to execute logic' });
  }
});

// Stop logic execution
app.post('/api/logic/stop', authenticateRequest, async (req, res) => {
  try {
    // Stop the logic executor
    logicExecutor.stopExecution();

    // Clear the executor config to prevent auto-restart
    const executorConfigPath = path.join(__dirname, 'data', 'logic_executor_config.json');
    if (fs.existsSync(executorConfigPath)) {
      const config = JSON.parse(fs.readFileSync(executorConfigPath, 'utf8'));
      config.autoRunEnabled = false;
      config.enabled = false;
      fs.writeFileSync(executorConfigPath, JSON.stringify(config, null, 2));
    }

    // Update database to disable auto-run
    try {
      db.metricsDb.exec(`
        CREATE TABLE IF NOT EXISTS system_config (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);

      const stmt = db.metricsDb.prepare(`
        INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)
      `);
      stmt.run('auto_run_enabled', '0');
    } catch (dbError) {
      logger.error('Error updating database:', dbError);
    }

    logger.info('Logic execution stopped and auto-run disabled');
    res.json({ success: true, message: 'Logic execution stopped' });
  } catch (error) {
    logger.error('Stop logic error:', error);
    res.status(500).json({ error: 'Failed to stop logic execution' });
  }
});

// Get current logic execution status
app.get('/api/logic/status', authenticateRequest, async (req, res) => {
  try {
    const status = {
      active: logicExecutor.activeLogic !== null,
      activeLogic: logicExecutor.activeLogic,
      lastInputs: logicExecutor.lastInputs,
      lastOutputs: logicExecutor.lastOutputs
    };
    res.json(status);
  } catch (error) {
    logger.error('Get logic status error:', error);
    res.status(500).json({ error: 'Failed to get logic status' });
  }
});

// Get execution results from the background service
app.get('/api/logic/execution-results', authenticateRequest, async (req, res) => {
  try {
    const resultsPath = path.join(__dirname, 'data', 'logic_execution_results.json');
    
    if (fs.existsSync(resultsPath)) {
      const resultsData = fs.readFileSync(resultsPath, 'utf8');
      const results = JSON.parse(resultsData);
      
      // Return last 20 results
      const recentResults = results.slice(-20);
      res.json(recentResults);
    } else {
      res.json([]);
    }
  } catch (error) {
    logger.error('Get execution results error:', error);
    res.json([]);
  }
});

// Test logic with simulated inputs
app.post('/api/logic/test-inputs', authenticateRequest, async (req, res) => {
  try {
    const { inputs } = req.body;
    const result = await logicExecutor.testLogic(inputs);
    res.json(result);
  } catch (error) {
    logger.error('Test logic error:', error);
    res.status(500).json({ error: 'Failed to test logic' });
  }
});

// Save board I/O configuration to data file
app.post('/api/boards/save-config', authenticateRequest, async (req, res) => {
  try {
    const config = req.body;
    const configPath = path.join(__dirname, 'data', 'board_configs.json');
    
    // Create data directory if it doesn't exist
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    // Reload configs in executor
    await logicExecutor.loadBoardConfigs();
    
    res.json({ success: true, message: 'Board configuration saved' });
  } catch (error) {
    logger.error('Save board config error:', error);
    res.status(500).json({ error: 'Failed to save board configuration' });
  }
});

// ==================== PID CONTROLLER API ENDPOINTS ====================

// Get all PID controllers
app.get('/api/pid-controllers', authenticateRequest, async (req, res) => {
  try {
    const controllers = await db.getPIDControllers();
    res.json(controllers || []);
  } catch (error) {
    logger.error('Get PID controllers error:', error);
    res.status(500).json({ error: 'Failed to get PID controllers' });
  }
});

// Update PID controller
app.put('/api/pid-controllers/:equipmentId/:controllerType', authenticateRequest, async (req, res) => {
  try {
    const { equipmentId, controllerType } = req.params;
    const updates = req.body;

    await db.updatePIDController(equipmentId, controllerType, updates);
    res.json({ success: true });
  } catch (error) {
    logger.error('Update PID controller error:', error);
    res.status(500).json({ error: 'Failed to update PID controller' });
  }
});

// Create PID controller
app.post('/api/pid-controllers', authenticateRequest, async (req, res) => {
  try {
    const controller = req.body;
    await db.createPIDController(controller);
    res.json({ success: true });
  } catch (error) {
    logger.error('Create PID controller error:', error);
    res.status(500).json({ error: 'Failed to create PID controller' });
  }
});

// Delete PID controller
app.delete('/api/pid-controllers/:equipmentId/:controllerType', authenticateRequest, async (req, res) => {
  try {
    const { equipmentId, controllerType } = req.params;
    await db.deletePIDController(equipmentId, controllerType);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete PID controller error:', error);
    res.status(500).json({ error: 'Failed to delete PID controller' });
  }
});

// ==================== LOGIC ENGINE API ENDPOINTS ====================

// Get equipment list
app.get('/api/logic/equipment-list', authenticateRequest, async (req, res) => {
  try {
    const logicDir = path.join(__dirname, 'logic', 'equipment');
    const equipmentList = [];
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(logicDir)) {
      fs.mkdirSync(logicDir, { recursive: true });
    }
    
    // Read all logic files
    const files = fs.readdirSync(logicDir);
    for (const file of files) {
      if (file.endsWith('.js')) {
        const equipmentId = file.replace('.js', '');
        equipmentList.push({
          id: equipmentId,
          name: equipmentId.replace(/-/g, ' ').toUpperCase(),
          hasLogic: true
        });
      }
    }
    
    // Add some default equipment IDs if none exist
    if (equipmentList.length === 0) {
      equipmentList.push(
        { id: 'AHU-01', name: 'AIR HANDLER UNIT 01', hasLogic: false },
        { id: 'RTU-01', name: 'ROOFTOP UNIT 01', hasLogic: false },
        { id: 'FCU-01', name: 'FAN COIL UNIT 01', hasLogic: false }
      );
    }
    
    res.json(equipmentList);
  } catch (error) {
    logger.error('Get equipment list error:', error);
    res.status(500).json({ error: 'Failed to get equipment list' });
  }
});

// Upload logic file for specific equipment and save to database
app.post('/api/logic/upload', authenticateRequest, async (req, res) => {
  try {
    const { content, equipmentId, enabled = false, autoRunEnabled = false, pollingInterval = 7 } = req.body;

    if (!equipmentId) {
      return res.status(400).json({ error: 'Equipment ID required' });
    }

    const logicDir = path.join(__dirname, 'logic', 'equipment');

    // Create logic directory if it doesn't exist
    if (!fs.existsSync(logicDir)) {
      fs.mkdirSync(logicDir, { recursive: true });
    }

    // Handle multiple equipment IDs (for cooling towers with multiple units)
    const equipmentIds = equipmentId.split(',').map(id => id.trim()).filter(id => id);
    const primaryId = equipmentIds[0]; // Use first ID as primary for file naming

    const logicPath = path.join(logicDir, `${primaryId}.js`);

    // Write logic file for specific equipment
    fs.writeFileSync(logicPath, content);
    
    // Save equipment configuration to database for each equipment ID
    const stmt = db.metricsDb.prepare(`
      INSERT OR REPLACE INTO equipment_config
      (equipment_id, enabled, logic_file_path, uploaded_at, uploaded_by, temperature_setpoint, schedule_start, schedule_end, auto_run_enabled, polling_interval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Save config for each equipment ID (all pointing to same logic file)
    for (const eqId of equipmentIds) {
      stmt.run(
        eqId,
        enabled ? 1 : 0,
        logicPath,
        new Date().toISOString(),
        req.user.username || req.user.id || 'unknown',
        72,
        '05:30',
        '20:30',
        autoRunEnabled ? 1 : 0,
        pollingInterval
      );
    }
    
    // Also save to JSON for backward compatibility
    const configDir = path.join(__dirname, 'config', 'equipment');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Save config for each equipment ID
    for (const eqId of equipmentIds) {
      const configPath = path.join(configDir, `${eqId}.json`);
      const config = {
        equipmentId: eqId,
        primaryEquipmentId: primaryId, // Reference to primary ID
        allEquipmentIds: equipmentIds, // All related IDs
        enabled,
        autoRunEnabled,
        pollingInterval,
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user.username,
        temperatureSetpoint: 72,
        occupancySchedule: {
          start: '05:30',
          end: '20:30'
        }
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    // Create/update logic executor config file for the service
    const executorConfig = {
      equipmentId: primaryId,
      allEquipmentIds: equipmentIds,
      enabled,
      autoRunEnabled,
      pollingInterval: pollingInterval || 7,
      logicFilePath: logicPath,
      updatedAt: new Date().toISOString()
    };

    const executorConfigPath = path.join(__dirname, 'data', 'logic_executor_config.json');
    fs.writeFileSync(executorConfigPath, JSON.stringify(executorConfig, null, 2));
    logger.info(`Logic executor config updated: ${executorConfigPath}`);

    // Log to audit
    await db.logAudit({
      user_id: req.user.userId || req.user.id || 1,
      username: req.user.username || 'unknown',
      action: 'UPLOAD',
      resource: `Logic File: ${equipmentIds.join(', ')}`,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      status: 'success',
      details: `Logic ${enabled ? 'enabled' : 'disabled'} for ${equipmentIds.length} equipment${equipmentIds.length > 1 ? 's' : ''}`
    });

    logger.info(`Logic file uploaded for equipment: ${equipmentIds.join(', ')}, enabled: ${enabled}`);
    res.json({ success: true, message: `Configuration saved for ${equipmentIds.length} equipment${equipmentIds.length > 1 ? 's' : ''}` });
  } catch (error) {
    logger.error('Logic upload error:', error);
    res.status(500).json({ error: 'Failed to upload logic file' });
  }
});

// Delete logic file for specific equipment
app.delete('/api/logic/delete/:equipmentId', authenticateRequest, async (req, res) => {
  try {
    const { equipmentId } = req.params;

    // Handle comma-separated IDs
    const equipmentIds = equipmentId.split(',').map(id => id.trim()).filter(id => id);

    // Delete all associated files
    for (const eqId of equipmentIds) {
      const logicPath = path.join(__dirname, 'logic', 'equipment', `${eqId}.js`);
      const configPath = path.join(__dirname, 'config', 'equipment', `${eqId}.json`);

      // Delete logic file if exists
      if (fs.existsSync(logicPath)) {
        fs.unlinkSync(logicPath);
        logger.info(`Deleted logic file: ${logicPath}`);
      }

      // Delete config file if exists
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        logger.info(`Deleted config file: ${configPath}`);
      }

      // Delete from database
      try {
        const stmt = db.metricsDb.prepare('DELETE FROM equipment_config WHERE equipment_id = ?');
        stmt.run(eqId);
      } catch (dbErr) {
        logger.error(`Error deleting ${eqId} from database:`, dbErr);
      }
    }

    logger.info(`Configuration reset for equipment: ${equipmentIds.join(', ')}`);
    res.json({ success: true, message: `Configuration reset for ${equipmentIds.length} equipment${equipmentIds.length > 1 ? 's' : ''}` });
  } catch (error) {
    logger.error('Delete logic error:', error);
    res.status(500).json({ error: 'Failed to delete logic file' });
  }
});

// Start local controller service
app.post('/api/logic/start-controller', authenticateRequest, async (req, res) => {
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Check if controller is already running
    const { stdout: status } = await execPromise('pm2 status local-controller');
    
    if (!status.includes('local-controller')) {
      // Start the controller
      await execPromise('pm2 start localController.config.js');
      logger.info('Local controller service started');
      res.json({ success: true, message: 'Local controller started' });
    } else if (status.includes('stopped')) {
      // Restart if stopped
      await execPromise('pm2 restart local-controller');
      logger.info('Local controller service restarted');
      res.json({ success: true, message: 'Local controller restarted' });
    } else {
      res.json({ success: true, message: 'Local controller already running' });
    }
  } catch (error) {
    logger.error('Start controller error:', error);
    res.status(500).json({ error: 'Failed to start controller' });
  }
});

// Stop local controller service
app.post('/api/logic/stop-controller', authenticateRequest, async (req, res) => {
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    await execPromise('pm2 stop local-controller');
    logger.info('Local controller service stopped');
    res.json({ success: true, message: 'Local controller stopped' });
  } catch (error) {
    logger.error('Stop controller error:', error);
    res.status(500).json({ error: 'Failed to stop controller' });
  }
});

// Get equipment configuration from database
app.get('/api/logic/config/:equipmentId', authenticateRequest, async (req, res) => {
  try {
    const { equipmentId } = req.params;
    
    // Try to get from database first
    try {
      const stmt = db.metricsDb.prepare(`
        SELECT * FROM equipment_config WHERE equipment_id = ?
      `);
      const config = stmt.get(equipmentId);
      
      if (config) {
        res.json({
          equipmentId: config.equipment_id,
          enabled: config.enabled === 1,
          autoRunEnabled: config.auto_run_enabled === 1,
          pollingInterval: config.polling_interval || 7,
          uploadedAt: config.uploaded_at,
          temperatureSetpoint: config.temperature_setpoint,
          scheduleStart: config.schedule_start,
          scheduleEnd: config.schedule_end
        });
        return;
      }
    } catch (dbError) {
      // Table might not exist yet
      console.log('Database table not found, checking JSON file');
    }
    
    // Fallback to JSON file
    const configPath = path.join(__dirname, 'config', 'equipment', `${equipmentId}.json`);
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      res.json(config);
    } else {
      res.json({ equipmentId, enabled: false });
    }
  } catch (error) {
    logger.error('Get config error:', error);
    res.status(500).json({ error: 'Failed to get configuration' });
  }
});

// Get current logic file for specific equipment
app.get('/api/logic/current/:equipmentId', authenticateRequest, async (req, res) => {
  try {
    const { equipmentId } = req.params;
    const logicPath = path.join(__dirname, 'logic', 'equipment', `${equipmentId}.js`);
    
    if (fs.existsSync(logicPath)) {
      const content = fs.readFileSync(logicPath, 'utf8');
      res.send(content);
    } else {
      res.status(404).send('// No logic file uploaded for this equipment yet');
    }
  } catch (error) {
    logger.error('Get logic error:', error);
    res.status(500).json({ error: 'Failed to get logic file' });
  }
});

// Test logic file for specific equipment
app.post('/api/logic/test', authenticateRequest, async (req, res) => {
  try {
    const { content, equipmentId } = req.body;
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Validate the logic file has a control function (support multiple types)
    const controlFunctions = [
      'airHandlerControl',
      'coolingTowerControl',
      'processCoolingTowerControl',  // Also check for process prefix
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
    
    let foundFunction = null;
    for (const func of controlFunctions) {
      if (content.includes(func)) {
        foundFunction = func;
        break;
      }
    }
    
    if (!foundFunction) {
      return res.json({ 
        success: false, 
        output: 'Logic file validation failed: No control function found. Expected one of: ' + controlFunctions.join(', '),
        error: 'Missing required control function' 
      });
    }
    
    // Create temp directory for testing
    const tempDir = path.join(__dirname, 'logic', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFile = path.join(tempDir, `test-${equipmentId || Date.now()}.js`);
    
    // Add test wrapper that reads ACTUAL sensor data
    const testWrapper = `
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

${content}

// Test execution with REAL sensor readings
async function runTest() {
  try {
    // Dynamically check which function exists after the uploaded logic is loaded
    let controlFunc = null;
    let functionName = null;

    // First check for direct function definitions
    ${controlFunctions.map(fn => `if (typeof ${fn} === 'function') { controlFunc = ${fn}; functionName = '${fn}'; }`).join(' else ')}

    // If not found, check module.exports
    if (!controlFunc && typeof module !== 'undefined' && module.exports) {
      ${controlFunctions.map(fn => `if (typeof module.exports.${fn} === 'function') { controlFunc = module.exports.${fn}; functionName = '${fn}'; }`).join(' else ')}
    }

    if (!controlFunc) {
      console.log('ERROR: No control function found in logic file. Expected one of: ${controlFunctions.join(', ')}');
      return;
    }

    // Load board configurations to know how to read sensors
    const boardConfigs = JSON.parse(fs.readFileSync('/home/Automata/remote-access-portal/data/board_configs.json', 'utf8'));
    const inputs = {};

    // Read actual MegaBAS inputs (current sensors)
    const megabasConfig = boardConfigs.find(b => b.boardType === 'megabas');
    if (megabasConfig && megabasConfig.enabled) {
      for (let i = 1; i <= 8; i++) {
        if (megabasConfig.inputs && megabasConfig.inputs[i] && megabasConfig.inputs[i].enabled) {
          try {
            const { stdout } = await execPromise(\`megabas \${megabasConfig.stackAddress} uinrd \${i}\`);
            const value = parseFloat(stdout.trim());
            inputs[\`AI\${i}\`] = value;
          } catch (err) {
            inputs[\`AI\${i}\`] = 0;
          }
        }
      }
    }

    // Read actual 16-Universal Input board (temperature sensors)
    const input16Config = boardConfigs.find(b => b.boardType === '16univin');
    if (input16Config && input16Config.enabled) {
      for (const [key, inputConfig] of Object.entries(input16Config.inputs || {})) {
        if (inputConfig && inputConfig.enabled) {
          try {
            let value, convertedValue;

            // Read based on configured input type
            if (inputConfig.inputType === '10k') {
              // Read 10K thermistor resistance
              const { stdout } = await execPromise(\`16univin \${input16Config.stackAddress} 10kinrd \${key}\`);
              value = parseFloat(stdout.trim());
              // Convert resistance to temperature using Steinhart-Hart equation
              const R0 = 10000;
              const B = 3950;
              const T0 = 298.15;
              const tempK = 1 / ((1/T0) + (1/B) * Math.log(value/R0));
              const tempC = tempK - 273.15;
              convertedValue = (tempC * 9/5) + 32;
            } else if (inputConfig.inputType === '1k') {
              // Read 1K RTD resistance
              const { stdout } = await execPromise(\`16univin \${input16Config.stackAddress} 1kinrd \${key}\`);
              value = parseFloat(stdout.trim());
              // Convert RTD resistance to temperature
              const R0 = 1000;
              const alpha = 0.00385;
              const tempC = (value - R0) / (R0 * alpha);
              convertedValue = (tempC * 9/5) + 32;
            } else {
              // Default to 0-10V reading
              const { stdout } = await execPromise(\`16univin \${input16Config.stackAddress} uinrd \${key}\`);
              value = parseFloat(stdout.trim());

              // For the test, we need RAW voltage values, not converted values
              // The logic function expects voltage and will do its own conversion
              convertedValue = value;
            }

            inputs[\`CH\${key}\`] = convertedValue;
          } catch (err) {
            inputs[\`CH\${key}\`] = 0;
          }
        }
      }
    }

    // Get outdoor temperature from weather database
    try {
      const weatherDb = new sqlite3.Database('/home/Automata/remote-access-portal/data/weather.db', sqlite3.OPEN_READONLY);
      await new Promise((resolve) => {
        weatherDb.get(
          'SELECT temperature FROM current_weather ORDER BY timestamp DESC LIMIT 1',
          (err, row) => {
            if (row && row.temperature) {
              inputs.outdoorTemp = row.temperature;
            } else {
              inputs.outdoorTemp = 72; // Default fallback
            }
            weatherDb.close();
            resolve();
          }
        );
      });
    } catch (err) {
      inputs.outdoorTemp = 72;
    }

    // Fill in any missing expected values with defaults for testing
    inputs.AI1 = inputs.AI1 || 2.14;
    inputs.AI2 = inputs.AI2 || 2.14;
    inputs.AI3 = inputs.AI3 || 0.007;
    inputs.AI4 = inputs.AI4 || 0.015;
    inputs.AI5 = inputs.AI5 || 0.007;
    inputs.AI6 = inputs.AI6 || 0.007;

    console.log('Testing logic for equipment: ${equipmentId || 'unknown'}');
    console.log('========================================');
    console.log('\\nSensor Readings:');
    console.log('  Tower Loop Supply Temp (CH1): ' + (inputs.CH1 || 'N/A') + '°F');
    console.log('  Tower Loop Return Temp (CH2): ' + (inputs.CH2 || 'N/A') + '°F');
    console.log('  Loop Delta-T: ' + ((inputs.CH2 && inputs.CH1) ? (inputs.CH2 - inputs.CH1).toFixed(1) : 'N/A') + '°F');
    console.log('  HP Supply Temp (CH10): ' + (inputs.CH10 || 'N/A') + '°F');
    console.log('  HP Return Temp (CH9): ' + (inputs.CH9 || 'N/A') + '°F');
    console.log('  Outdoor Temp: ' + (inputs.outdoorTemp || 'N/A') + '°F');
    console.log('\\nCurrent Readings:');
    console.log('  Tower 1 VFD L1 (AI1): ' + inputs.AI1 + 'V (' + (inputs.AI1 * 5).toFixed(1) + 'A)');
    console.log('  Tower 1 VFD L3 (AI2): ' + inputs.AI2 + 'V (' + (inputs.AI2 * 5).toFixed(1) + 'A)');
    console.log('  Tower 2 VFD L1 (AI3): ' + inputs.AI3 + 'V (' + (inputs.AI3 * 5).toFixed(1) + 'A)');
    console.log('  Tower 2 VFD L3 (AI4): ' + inputs.AI4 + 'V (' + (inputs.AI4 * 5).toFixed(1) + 'A)');
    console.log('  Tower 3 VFD L1 (AI5): ' + inputs.AI5 + 'V (' + (inputs.AI5 * 5).toFixed(1) + 'A)');
    console.log('  Tower 3 VFD L3 (AI6): ' + inputs.AI6 + 'V (' + (inputs.AI6 * 5).toFixed(1) + 'A)');
    console.log('  Pump 1 Current (CH8): ' + (inputs.CH8 || 0) + 'V (' + ((inputs.CH8 || 0) * 5).toFixed(1) + 'A)');
    console.log('  Pump 2 Current (CH5): ' + (inputs.CH5 || 0) + 'V (' + ((inputs.CH5 || 0) * 5).toFixed(1) + 'A)');
    console.log('  Pump 3 Current (CH7): ' + (inputs.CH7 || 0) + 'V (' + ((inputs.CH7 || 0) * 5).toFixed(1) + 'A)');

    // Run the logic function with whatever inputs we actually read from the hardware
    const result = controlFunc(inputs, {}, {});
    
    // Handle promise if returned
    Promise.resolve(result).then(finalResult => {
      console.log('\\nControl Outputs:');
      console.log('----------------------------------------');

      // Display key control outputs first
      if (finalResult.tower1VFDEnable !== undefined) {
        console.log('* Tower 1 VFD: ' + (finalResult.tower1VFDEnable ? 'ON' : 'OFF') + ', Speed: ' + (finalResult.tower1FanSpeed || 0).toFixed(1) + 'V');
      }
      if (finalResult.tower2VFDEnable !== undefined) {
        console.log('* Tower 2 VFD: ' + (finalResult.tower2VFDEnable ? 'ON' : 'OFF') + ', Speed: ' + (finalResult.tower2FanSpeed || 0).toFixed(1) + 'V');
      }
      if (finalResult.tower3VFDEnable !== undefined) {
        console.log('* Tower 3 VFD: ' + (finalResult.tower3VFDEnable ? 'ON' : 'OFF') + ', Speed: ' + (finalResult.tower3FanSpeed || 0).toFixed(1) + 'V');
      }

      console.log('* Bypass Valve Position: ' + (finalResult.bypassValvePosition || 0).toFixed(1) + 'V');

      // Display isolation valve states
      console.log('\\nIsolation Valves:');
      console.log('* Tower 1: ' + (finalResult.tower1IsolationValveOpen ? 'OPEN' : finalResult.tower1IsolationValveClose ? 'CLOSED' : 'IDLE'));
      console.log('* Tower 2: ' + (finalResult.tower2IsolationValveOpen ? 'OPEN' : finalResult.tower2IsolationValveClose ? 'CLOSED' : 'IDLE'));
      console.log('* Tower 3: ' + (finalResult.tower3IsolationValveOpen ? 'OPEN' : finalResult.tower3IsolationValveClose ? 'CLOSED' : 'IDLE'));

      console.log('\\nSystem Metrics:');
      console.log('* Active Towers: ' + (finalResult.activeTowers || 0));
      console.log('* Lead Tower: ' + (finalResult.leadTower || 1));
      console.log('* Cooling Demand: ' + (finalResult.coolingDemand || 0) + '%');
      console.log('* Loop Delta-T: ' + (finalResult.loopDeltaT || 0).toFixed(1) + '°F');

      // Show system status
      console.log('\\nSystem Status:');
      console.log('* System Enabled: ' + (finalResult.systemEnabled ? 'YES' : 'NO'));
      console.log('* Control Mode: ' + (finalResult.controlMode || 'auto'));
      console.log('* Alarm Status: ' + (finalResult.alarmStatus || 'normal'));

      // Show any faults or errors
      if (finalResult.faultConditions && finalResult.faultConditions.length > 0) {
        console.log('* FAULTS: ' + finalResult.faultConditions.join(', '));
      }
      if (finalResult.errorMessage) {
        console.log('* ERROR: ' + finalResult.errorMessage);
      }

      console.log('\\n* Logic test completed successfully!');
    }).catch(err => {
      console.error('ERROR:', err.message);
    });
  } catch (error) {
    console.log('ERROR during test execution:', error.message);
  }
}

// Run the async test function
runTest().catch(err => console.error('Test failed:', err));
`;
    
    // Write test file
    fs.writeFileSync(tempFile, testWrapper);
    
    // Execute the test with timeout
    try {
      const { stdout, stderr } = await execPromise(`node ${tempFile}`, {
        timeout: 5000 // 5 second timeout
      });
      
      // Clean up
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      
      // Check for errors in output
      const hasError = stderr && stderr.length > 0;
      const success = !hasError && stdout.includes('Logic test completed successfully');
      
      res.json({ 
        success: success,
        output: stdout || 'Test completed',
        error: stderr || null
      });
    } catch (execError) {
      // Clean up on error
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      
      res.json({ 
        success: false,
        output: 'Test execution failed',
        error: execError.message
      });
    }
  } catch (error) {
    logger.error('Logic test error:', error);
    res.status(500).json({ error: 'Logic test failed: ' + error.message });
  }
});

// Toggle BMS connection
app.post('/api/logic/bms-toggle', authenticateRequest, async (req, res) => {
  try {
    const { enabled } = req.body;
    const bmsMonitor = require('./src/services/bmsMonitor');
    
    if (enabled) {
      await bmsMonitor.connect();
    } else {
      await bmsMonitor.disconnect();
    }
    
    res.json({ success: true, enabled });
  } catch (error) {
    logger.error('Error toggling BMS:', error);
    res.status(500).json({ error: 'Failed to toggle BMS connection' });
  }
});

// Configure auto-run for logic execution
app.post('/api/logic/auto-run', authenticateRequest, async (req, res) => {
  try {
    const { enabled, interval } = req.body;
    
    // Update local controller configuration
    const LocalController = require('./src/services/localController');
    const localController = new LocalController(db);
    
    if (enabled) {
      // Set polling interval (convert seconds to milliseconds)
      localController.pollingRate = interval * 1000;
      localController.start();
      logger.info(`Auto-run enabled with ${interval}s interval`);
    } else {
      localController.stop();
      logger.info('Auto-run disabled');
    }
    
    // Save configuration to database
    try {
      db.metricsDb.exec(`
        CREATE TABLE IF NOT EXISTS system_config (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);
      
      const stmt = db.metricsDb.prepare(`
        INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)
      `);
      stmt.run('auto_run_enabled', enabled ? '1' : '0');
      stmt.run('polling_interval', interval.toString());
    } catch (dbError) {
      logger.error('Error saving config to database:', dbError);
    }
    
    res.json({ success: true, enabled, interval });
  } catch (error) {
    logger.error('Error configuring auto-run:', error);
    res.status(500).json({ error: 'Failed to configure auto-run' });
  }
});

// Get latest logic processing results
app.get('/api/logic/results/:equipmentId', authenticateRequest, async (req, res) => {
  try {
    const { equipmentId } = req.params;
    
    // Get latest results from database
    const stmt = db.metricsDb.prepare(`
      SELECT * FROM logic_results 
      WHERE equipment_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 10
    `);
    
    const results = stmt.all(equipmentId);
    
    // Format for display
    const formatted = results.map(r => ({
      timestamp: r.timestamp,
      setpoint: r.temperature_setpoint,
      currentTemp: r.current_temp,
      heating: r.heating_valve,
      cooling: r.cooling_valve,
      damper: r.oa_damper,
      fan: r.fan_enabled === 1,
      fanSpeed: r.fan_speed,
      spaceTemp: r.space_temp,
      supplyTemp: r.supply_temp,
      outdoorTemp: r.outdoor_temp
    }));
    
    res.json(formatted);
  } catch (error) {
    logger.error('Error fetching logic results:', error);
    res.status(500).json({ error: 'Failed to fetch logic results' });
  }
});

// Get board configurations
app.get('/api/logic/boards', authenticateRequest, async (req, res) => {
  try {
    // Try to load from database first
    const dbConfig = db.getBoardConfiguration();
    if (dbConfig) {
      res.json(dbConfig);
      return;
    }
    
    // Fallback to JSON file
    const configPath = path.join(__dirname, 'config', 'boards.json');
    
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      res.json(config);
    } else {
      // Return default config
      res.json([
        { board: 0, type: 'none', outputs: {} },
        { board: 1, type: 'none', outputs: {} },
        { board: 2, type: 'none', outputs: {} },
        { board: 3, type: 'none', outputs: {} }
      ]);
    }
  } catch (error) {
    logger.error('Get boards error:', error);
    res.status(500).json({ error: 'Failed to get board configuration' });
  }
});

// Save board configurations
app.post('/api/logic/boards', authenticateRequest, async (req, res) => {
  try {
    const config = req.body;
    const configPath = path.join(__dirname, 'config', 'boards.json');
    
    // Create config directory if it doesn't exist
    if (!fs.existsSync(path.join(__dirname, 'config'))) {
      fs.mkdirSync(path.join(__dirname, 'config'));
    }
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    // Also save to database
    const result = db.saveBoardConfiguration(config, req.user.username);
    
    if (result.success) {
      // Log to audit
      auditService.logAudit({
        username: req.user.username,
        actionType: 'BOARD_CONFIG_UPDATE',
        actionCategory: 'configuration',
        description: 'Updated board configuration',
        component: 'boards',
        details: { configCount: config.length },
        success: true
      });
    }
    
    res.json({ success: true, message: 'Board configuration saved' });
  } catch (error) {
    logger.error('Save boards error:', error);
    res.status(500).json({ error: 'Failed to save board configuration' });
  }
});

// BMS Status endpoint
app.get('/api/logic/bms-status', authenticateRequest, async (req, res) => {
  try {
    const bmsMonitor = require('./src/services/bmsMonitor');
    const status = await bmsMonitor.getStatus();
    res.json(status);
  } catch (error) {
    // Return default status if monitor not ready
    res.json({
      connected: false,
      lastPing: 'Never',
      latency: 0,
      usingLocalFile: false,
      logicFileStatus: 'none',
      enabled: false
    });
  }
});

// Toggle BMS connection
app.post('/api/logic/bms-toggle', authenticateRequest, async (req, res) => {
  try {
    const { enabled } = req.body;
    const bmsMonitor = require('./src/services/bmsMonitor');
    
    if (enabled) {
      await bmsMonitor.connect();
    } else {
      await bmsMonitor.disconnect();
    }
    
    res.json({ success: true, enabled });
  } catch (error) {
    logger.error('BMS toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle BMS connection' });
  }
});

// ==================== ALARM API ENDPOINTS ====================

// Get all alarms
app.get('/api/alarms', async (req, res) => {
  try {
    const alarms = await alarmMonitor.getAllAlarms();
    res.json(alarms);
  } catch (error) {
    logger.error('Get alarms error:', error);
    res.status(500).json({ error: 'Failed to get alarms' });
  }
});

// Get alarm thresholds
app.get('/api/alarms/thresholds', async (req, res) => {
  try {
    // Create table if not exists
    db.metricsDb.exec(`
      CREATE TABLE IF NOT EXISTS alarm_thresholds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parameter TEXT NOT NULL,
        minValue REAL,
        maxValue REAL,
        unit TEXT,
        enabled BOOLEAN DEFAULT 1,
        alarmType TEXT DEFAULT 'warning',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    const stmt = db.metricsDb.prepare('SELECT * FROM alarm_thresholds');
    const thresholds = stmt.all();
    res.json(thresholds);
  } catch (error) {
    logger.error('Get alarm thresholds error:', error);
    res.json([]); // Return empty array on error
  }
});

// Save alarm thresholds
app.post('/api/alarms/thresholds', async (req, res) => {
  try {
    const thresholds = req.body;
    
    // Create table if not exists
    db.metricsDb.exec(`
      CREATE TABLE IF NOT EXISTS alarm_thresholds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parameter TEXT NOT NULL,
        minValue REAL,
        maxValue REAL,
        unit TEXT,
        enabled BOOLEAN DEFAULT 1,
        alarmType TEXT DEFAULT 'warning',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Clear existing thresholds
    db.metricsDb.prepare('DELETE FROM alarm_thresholds').run();
    
    // Insert new thresholds
    const stmt = db.metricsDb.prepare(`
      INSERT INTO alarm_thresholds (id, name, parameter, minValue, maxValue, unit, enabled, alarmType, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    for (const threshold of thresholds) {
      stmt.run(
        threshold.id,
        threshold.name,
        threshold.parameter,
        threshold.minValue,
        threshold.maxValue,
        threshold.unit,
        threshold.enabled ? 1 : 0,
        threshold.alarmType
      );
    }
    
    logger.info(`Saved ${thresholds.length} alarm thresholds`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Save alarm thresholds error:', error);
    res.status(500).json({ error: 'Failed to save thresholds' });
  }
});

// Get alarm settings
app.get('/api/alarms/settings', async (req, res) => {
  try {
    // Ensure settings are loaded
    await alarmMonitor.loadSettings();
    res.json(alarmMonitor.settings);
  } catch (error) {
    logger.error('Get alarm settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update alarm settings
app.put('/api/alarms/settings', async (req, res) => {
  try {
    await alarmMonitor.updateSettings(req.body);
    res.json({ success: true });
  } catch (error) {
    logger.error('Update alarm settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Acknowledge alarm
app.put('/api/alarms/:id/acknowledge', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    let username = 'System';
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key');
        username = decoded.username;
      } catch (err) {
        // Use default username if token invalid
      }
    }
    
    await alarmMonitor.acknowledgeAlarm(req.params.id, username);
    res.json({ success: true });
  } catch (error) {
    logger.error('Acknowledge alarm error:', error);
    res.status(500).json({ error: 'Failed to acknowledge alarm' });
  }
});

// Delete alarm
app.delete('/api/alarms/:id', async (req, res) => {
  try {
    await alarmMonitor.deleteAlarm(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete alarm error:', error);
    res.status(500).json({ error: 'Failed to delete alarm' });
  }
});

// Get email recipients
app.get('/api/alarms/recipients', async (req, res) => {
  try {
    const recipients = await alarmMonitor.getRecipients();
    res.json(recipients);
  } catch (error) {
    logger.error('Get recipients error:', error);
    res.status(500).json({ error: 'Failed to get recipients' });
  }
});

// Add email recipient
app.post('/api/alarms/recipients', async (req, res) => {
  try {
    await alarmMonitor.addRecipient(req.body);
    res.json({ success: true });
  } catch (error) {
    logger.error('Add recipient error:', error);
    res.status(500).json({ error: 'Failed to add recipient' });
  }
});

// Update email recipient
app.put('/api/alarms/recipients/:id', async (req, res) => {
  try {
    await alarmMonitor.updateRecipient(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    logger.error('Update recipient error:', error);
    res.status(500).json({ error: 'Failed to update recipient' });
  }
});

// Delete email recipient
app.delete('/api/alarms/recipients/:id', async (req, res) => {
  try {
    await alarmMonitor.deleteRecipient(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete recipient error:', error);
    res.status(500).json({ error: 'Failed to delete recipient' });
  }
});

// Forward alarm email to specific address
app.post('/api/alarms/forward', authenticateRequest, async (req, res) => {
  try {
    const { email, alarm } = req.body;

    if (!email || !alarm) {
      return res.status(400).json({ error: 'Email and alarm data required' });
    }

    // Format alarm data for email
    const alarmData = {
      type: alarm.type,
      description: alarm.description,
      value: alarm.value,
      threshold: alarm.threshold,
      severity: alarm.severity,
      timestamp: alarm.timestamp
    };

    // Send email using the alarm monitor's email functionality
    await alarmMonitor.sendAlarmEmailTo(alarmData, email);

    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    logger.error('Forward alarm email error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Vibration monitoring endpoints
app.get('/api/vibration/readings', async (req, res) => {
  try {
    // Get all configured sensors
    const configs = vibrationMonitor.getConfigs();
    const readings = {};

    // Get latest reading for each sensor from database (not hardware)
    for (const config of configs) {
      const reading = vibrationMonitor.getLatestReading(config.sensor_id);
      if (reading) {
        readings[config.sensor_id] = reading;
      }
    }

    res.json(readings);
  } catch (error) {
    logger.error('Get vibration readings error:', error);
    res.json({}); // Return empty object on error instead of 500 to prevent UI freezing
  }
});

app.get('/api/vibration/readings/:sensorId', async (req, res) => {
  try {
    // Get latest reading from database instead of reading hardware
    const reading = vibrationMonitor.getLatestReading(req.params.sensorId);

    if (reading) {
      res.json(reading);
    } else {
      // Return a default/empty reading instead of error
      res.json({
        sensor_id: req.params.sensorId,
        velocity_mms: 0,
        temperature_f: 0,
        error: true,
        errorMessage: 'No data available',
        timestamp: Date.now()
      });
    }
  } catch (error) {
    logger.error('Read vibration sensor error:', error);
    // Return safe default instead of 500 error
    res.json({
      sensor_id: req.params.sensorId,
      velocity_mms: 0,
      temperature_f: 0,
      error: true,
      errorMessage: error.message,
      timestamp: Date.now()
    });
  }
});

app.get('/api/vibration/configs', async (req, res) => {
  try {
    const configs = vibrationMonitor.getConfigs();
    res.json(configs);
  } catch (error) {
    logger.error('Get vibration configs error:', error);
    res.status(500).json({ error: 'Failed to get vibration configs' });
  }
});

app.get('/api/vibration/ports', async (req, res) => {
  try {
    const ports = await vibrationMonitor.scanPorts();
    res.json(ports);
  } catch (error) {
    logger.error('Scan ports error:', error);
    res.status(500).json({ error: 'Failed to scan ports' });
  }
});

app.post('/api/vibration/configs', async (req, res) => {
  try {
    const result = await vibrationMonitor.configureSensor(req.body);
    res.json(result);
  } catch (error) {
    logger.error('Configure vibration sensor error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/vibration/configs/:sensorId', async (req, res) => {
  try {
    const result = await vibrationMonitor.deleteSensor(req.params.sensorId);
    res.json(result);
  } catch (error) {
    logger.error('Delete vibration sensor error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vibration/history/:sensorId', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const history = vibrationMonitor.getHistoricalReadings(req.params.sensorId, hours);
    res.json(history);
  } catch (error) {
    logger.error('Get vibration history error:', error);
    res.json([]); // Return empty array instead of 500 error to prevent UI issues
  }
});

app.post('/api/vibration/baseline/:sensorId', async (req, res) => {
  try {
    const { velocity, timestamp } = req.body;
    const result = await vibrationMonitor.setBaseline(req.params.sensorId, velocity, timestamp);
    res.json(result);
  } catch (error) {
    logger.error('Set vibration baseline error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/vibration/baseline/:sensorId', async (req, res) => {
  try {
    const result = await vibrationMonitor.clearBaseline(req.params.sensorId);
    res.json(result);
  } catch (error) {
    logger.error('Clear vibration baseline error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Email notification endpoint
app.post('/api/notifications', async (req, res) => {
  const { subject, message, type } = req.body;
  
  try {
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0f1823 0%, #1a2332 100%); padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="color: #06b6d4; margin: 0;">AutomataNexusBms Controller Alert</h1>
        </div>
        <div style="background: #f5f5f5; padding: 20px;">
          <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid ${
            type === 'error' ? '#ef4444' : 
            type === 'warning' ? '#f59e0b' : 
            type === 'info' ? '#3b82f6' : '#10b981'
          };">
            <h2 style="color: #1e293b; margin-top: 0;">${subject}</h2>
            <p style="color: #475569; line-height: 1.6;">${message}</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <p style="color: #94a3b8; font-size: 12px;">
              Controller: ${process.env.CONTROLLER_SERIAL || 'Unknown'}<br>
              Location: ${process.env.LOCATION || 'Unknown'}<br>
              Timestamp: ${new Date().toISOString()}
            </p>
          </div>
        </div>
        <div style="background: #1a2332; color: #64748b; padding: 15px; text-align: center; font-size: 12px;">
          © 2024 AutomataNexus, LLC. All rights reserved.
        </div>
      </div>
    `;
    
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@automatacontrols.com',
      to: process.env.EMAIL_ADMIN || 'admin@automatacontrols.com',
      subject: `[${type.toUpperCase()}] ${subject}`,
      html: emailHtml
    });
    
    if (error) {
      throw error;
    }
    
    logger.info(`Email notification sent: ${subject}`);
    res.json({ success: true, messageId: data.id });
  } catch (error) {
    logger.error('Email notification error:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// ==================== DUPLICATE VIBRATION ENDPOINTS REMOVED ====================
// All vibration endpoints are already defined above without auth requirement (lines 2418-2508)

// ==================== BOARD CONTROL API ENDPOINTS ====================

// Detect connected boards
app.get('/api/boards/detect', authenticateRequest, async (req, res) => {
  try {
    const boards = boardController.getBoards();
    res.json(boards);
  } catch (error) {
    logger.error('Board detection error:', error);
    res.status(500).json({ error: 'Failed to detect boards' });
  }
});

// Get current board states
app.get('/api/boards/states', authenticateRequest, async (req, res) => {
  try {
    const states = boardController.getBoardStates();
    res.json(states);
  } catch (error) {
    logger.error('Get board states error:', error);
    res.status(500).json({ error: 'Failed to get board states' });
  }
});

// Set relay state
app.post('/api/boards/relay', authenticateRequest, async (req, res) => {
  try {
    const { board, relayId, state } = req.body;
    
    if (!board || !relayId || state === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const result = await boardController.setRelay(board, relayId, state);
    
    // Log to audit
    auditService.logAudit({
      username: req.user.username,
      actionType: 'RELAY_CONTROL',
      actionCategory: 'control',
      description: `Set ${board} relay ${relayId} to ${state ? 'ON' : 'OFF'}`,
      component: 'boards',
      details: { board, relayId, state },
      success: result.success
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Set relay error:', error);
    res.status(500).json({ error: 'Failed to set relay state' });
  }
});

// Set analog output
app.post('/api/boards/analog', authenticateRequest, async (req, res) => {
  try {
    const { board, outputId, value } = req.body;
    
    if (!outputId || value === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const result = await boardController.setAnalogOutput(outputId, value);
    
    // Log to audit
    auditService.logAudit({
      username: req.user.username,
      actionType: 'ANALOG_CONTROL',
      actionCategory: 'control',
      description: `Set analog output ${outputId} to ${value}V`,
      component: 'boards',
      details: { outputId, value },
      success: result.success
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Set analog output error:', error);
    res.status(500).json({ error: 'Failed to set analog output' });
  }
});

// Set output mode (manual/auto)
app.post('/api/boards/mode', authenticateRequest, async (req, res) => {
  try {
    const { board, outputId, mode } = req.body;
    
    if (!board || !outputId || !mode) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const result = boardController.setMode(board, outputId, mode);
    
    // Log to audit
    auditService.logAudit({
      username: req.user.username,
      actionType: 'MODE_CHANGE',
      actionCategory: 'control',
      description: `Set ${board} output ${outputId} to ${mode} mode`,
      component: 'boards',
      details: { board, outputId, mode },
      success: result.success
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Set mode error:', error);
    res.status(500).json({ error: 'Failed to set output mode' });
  }
});

// Get current board readings for dashboard
app.get('/api/boards/current-readings', async (req, res) => {
  try {
    // Read from all boards and aggregate the data
    const readings = await boardController.getCurrentReadings();
    
    // Load the equipment configuration from database - handle if it doesn't exist
    let equipmentConfig = null;
    try {
      equipmentConfig = await db.getEquipmentConfig();
    } catch (err) {
      console.log('No equipment config found, using defaults');
    }
    
    // Convert raw values based on actual configuration
    const convertValue = (rawValue, inputConfig) => {
      if (rawValue === null || rawValue === undefined) return null;
      
      if (!inputConfig) return rawValue; // No config, return raw
      
      const { type, conversionType, scaling } = inputConfig;
      
      // Handle different input types
      if (type === '0-10V') {
        // For 0-10V inputs (like current sensors)
        // Raw value is already in volts from board controller
        const voltage = rawValue;
        
        if (conversionType === 'amps' && scaling) {
          // Parse scaling like "0-50" to get max value
          const maxAmps = parseFloat(scaling.split('-')[1]);
          if (maxAmps) {
            return (voltage / 10) * maxAmps; // 10V = max amps
          }
        }
        return voltage;
        
      } else if (type === '10k') {
        // 10k thermistor temperature conversion
        if (conversionType === 'temperature') {
          const resistance = rawValue; // Assuming raw value is resistance
          const tempC = 1 / (Math.log(resistance / 10000) / 3950 + 1 / 298.15) - 273.15;
          const tempF = tempC * 9/5 + 32;
          return isNaN(tempF) ? 0 : tempF;
        }
        
      } else if (type === '1k') {
        // BALCO 1000Ω temperature sensor conversion
        if (conversionType === 'temperature') {
          // BALCO sensor formula from Schneider Electric spec sheet:
          // Temperature = (SQRT((0.00644 × R) - 1.6597) - 1.961) / 0.00322
          // Where R is resistance in ohms
          
          const tempF = (Math.sqrt((0.00644 * rawValue) - 1.6597) - 1.961) / 0.00322;
          
          // Clamp to sensor operating range (-40°F to 250°F)
          const clampedTemp = Math.max(-40, Math.min(250, tempF));
          
          if (tempF < 30 || tempF > 145) {
            console.log(`Warning: temp reading ${tempF}°F outside sensor range 30-145°F (raw=${rawValue})`);
          }
          return isNaN(clampedTemp) ? 0 : clampedTemp;
        } else {
          // Return raw resistance value if not temperature
          return rawValue;
        }
      }
      
      return rawValue; // Default to raw value
    };
    
    // Get configured input mappings from board configs
    const inputMappings = {};
    
    // Load board configurations from database
    let boardConfigs = [];
    try {
      // Try new table first
      const configStmt = db.metricsDb.prepare('SELECT config FROM board_configs WHERE id = 1');
      const configRow = configStmt.get();
      if (configRow && configRow.config) {
        boardConfigs = JSON.parse(configRow.config);
      }
    } catch (err) {
      // Fall back to old table
      try {
        const configStmt = db.metricsDb.prepare('SELECT config_data FROM board_configurations ORDER BY updated_at DESC LIMIT 1');
        const configRow = configStmt.get();
        if (configRow && configRow.config_data) {
          boardConfigs = JSON.parse(configRow.config_data);
        }
      } catch (err2) {
        console.log('No board configs found in either table');
      }
    }
    
    // Map inputs from board configs
    if (boardConfigs && Array.isArray(boardConfigs)) {
      boardConfigs.forEach(board => {
        if (board.inputs && typeof board.inputs === 'object') {
          Object.entries(board.inputs).forEach(([key, input]) => {
            if (input && input.name) {
              const channelKey = board.boardType === 'megabas' ? `AI${key}` : `CH${key}`;
              inputMappings[input.name.toLowerCase()] = {
                channel: channelKey,
                config: input
              };
            }
          });
        }
      });
    }
    
    // Transform to format expected by components using actual configuration
    const formatted = {
      inputs: {},
      outputs: {
        triacs: {
          triac1: readings.triacs?.T1 || false,
          triac2: readings.triacs?.T2 || false,
          triac3: readings.triacs?.T3 || false,
          triac4: readings.triacs?.T4 || false
        },
        analog: {
          ao1: readings.outputs?.AO1 || 0,
          ao2: readings.outputs?.AO2 || 0,
          ao3: readings.outputs?.AO3 || 0,
          ao4: readings.outputs?.AO4 || 0
        },
        relays: {}
      },
      alarms: readings.alarms || [],
      labels: {
        triacs: {},
        analog: {},
        relays: {}
      }
    };

    // Add relay states from boardController readings
    if (readings.relays) {
      // Handle 16-relay board
      if (readings.relays.relay16) {
        for (let i = 1; i <= 16; i++) {
          formatted.outputs.relays[`relay${i}`] = readings.relays.relay16[`R${i}`] || false;
        }
      }
      // Handle 8-relay board
      if (readings.relays.relay8) {
        for (let i = 1; i <= 8; i++) {
          formatted.outputs.relays[`relay${i}`] = readings.relays.relay8[`R${i}`] || false;
        }
      }
    }
    
    // Reload board configs if empty (might have been loaded from wrong table)
    if (!boardConfigs || boardConfigs.length === 0) {
      try {
        const configStmt = db.metricsDb.prepare('SELECT config_data FROM board_configurations ORDER BY updated_at DESC LIMIT 1');
        const configRow = configStmt.get();
        if (configRow && configRow.config_data) {
          boardConfigs = JSON.parse(configRow.config_data);
        }
      } catch (err) {
        console.log('Could not reload board configs');
      }
    }
    
    // Map ALL configured inputs from board configs
    if (boardConfigs && boardConfigs.length > 0) {
      // Get user setpoint from database
      try {
        const setpointStmt = db.metricsDb.prepare('SELECT value FROM system_config WHERE key = ?');
        const setpointRow = setpointStmt.get('user_setpoint');
        formatted.inputs.setpoint = setpointRow ? parseFloat(setpointRow.value) : 70;
      } catch (err) {
        formatted.inputs.setpoint = 70;
      }
      
      // Process all configured inputs from all boards
      boardConfigs.forEach(board => {
        if (board.enabled && board.inputs && typeof board.inputs === 'object') {
          Object.entries(board.inputs).forEach(([key, input]) => {
            if (input && input.name && input.enabled !== false) {
              // Skip outdoor air temp from board - we'll use weather data
              if (input.name.toLowerCase().includes('outdoor air')) {
                return;
              }
              
              const channelKey = board.boardType === 'megabas' ? `AI${key}` : `CH${key}`;
              const rawValue = readings.inputs?.[channelKey];
              
              if (rawValue !== undefined && rawValue !== null) {
                // Create a sanitized key from the name
                const inputKey = input.name.toLowerCase()
                  .replace(/[^a-z0-9]+/g, '_')
                  .replace(/^_|_$/g, '');
                
                // Pass the full input config including inputType for proper conversion
                const convertedValue = convertValue(rawValue, {
                  type: input.inputType || input.type,
                  conversionType: input.conversionType,
                  scaling: input.scaling
                });
                
                // Debug logging for current/amp conversions
                if (input.conversionType === 'amps' || input.name.includes('Current')) {
                  console.log(`Current sensor ${input.name}: channel=${channelKey}, raw=${rawValue}V, converted=${convertedValue}A`);
                }
                
                formatted.inputs[inputKey] = convertedValue;
              }
            }
          });
        }
      });
      
      // Get outdoor temp from weather data
      try {
        const weatherStmt = db.weatherDb.prepare('SELECT temperature FROM current_weather ORDER BY timestamp DESC LIMIT 1');
        const weatherRow = weatherStmt.get();
        if (weatherRow && weatherRow.temperature) {
          formatted.inputs.outdoor_air_temp = weatherRow.temperature;
          console.log('Using weather outdoor temp:', weatherRow.temperature);
        }
      } catch (err) {
        console.log('Could not get weather data for outdoor temp');
      }
      
      // Add output labels from board configs
      boardConfigs.forEach(board => {
        if (board.enabled && board.outputs && typeof board.outputs === 'object') {
          if (board.boardType === 'megabas') {
            Object.entries(board.outputs).forEach(([key, output]) => {
              if (output && output.name) {
                if (key <= 4) {
                  // Triacs 1-4
                  formatted.labels.triacs[`triac${key}`] = output.name;
                } else {
                  // Analog outputs 5-8 map to ao1-4
                  formatted.labels.analog[`ao${key - 4}`] = output.name;
                }
              }
            });
          }
        }
      });
    } else {
      // No config - use defaults
      formatted.inputs = {
        setpoint: 70,
        space: readings.inputs?.CH1 || readings.inputs?.AI1 || 72,
        supply: readings.inputs?.CH2 || readings.inputs?.AI2 || 55,
        amps: readings.inputs?.CH6 || readings.inputs?.AI6 || 0
      };
    }
    
    res.json(formatted);
  } catch (error) {
    logger.error('Get current readings error:', error);
    res.status(500).json({ error: 'Failed to get current board readings' });
  }
});

// Get historical board data for trends
app.get('/api/boards/historical-data', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 8;

    // Query the NexusControllerMetrics table directly
    const sql = `
      SELECT
        timestamp,
        setpoint,
        tower_loop_supply_temp,
        tower_loop_return_temp,
        hp_supply_temp,
        hp_return_temp,
        outdoor_air_temp,
        tower_1_vfd_current_l1,
        tower_1_vfd_current_l3,
        tower_2_vfd_current_l1,
        tower_2_vfd_current_l3,
        tower_3_vfd_current_l1,
        tower_3_vfd_current_l3,
        pump_1_current,
        pump_2_current,
        pump_3_current,
        vfd_current_7,
        vfd_current_8,
        triac1,
        triac2,
        triac3,
        triac4
      FROM NexusControllerMetrics
      WHERE datetime(timestamp) > datetime('now', '-${hours} hours')
      ORDER BY timestamp ASC
    `;

    const stmt = db.metricsDb.prepare(sql);
    const rows = stmt.all();

    // Transform data to match the format expected by TrendGraph
    const transformedData = rows.map(row => {
      const point = {
        time: new Date(row.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/New_York'
        })
      };

      // Map database columns to TrendGraph data keys
      if (row.setpoint !== null) point.setpoint = row.setpoint;

      // Convert raw temperature values to Fahrenheit for 10K NTC sensors
      if (row.tower_loop_supply_temp !== null) {
        const rawValue = row.tower_loop_supply_temp;
        // Check if this looks like a raw resistance value (> 1000 ohms)
        if (rawValue > 1000) {
          // Standard 10K NTC thermistor conversion
          const resistance = rawValue;
          const R0 = 10000;  // 10K at 25°C
          const B = 3950;    // Beta coefficient
          const T0 = 298.15; // 25°C in Kelvin

          const T = 1 / ((1/T0) + (1/B) * Math.log(resistance/R0));
          const tempC = T - 273.15;
          point.supply = (tempC * 9/5) + 32;
        } else {
          point.supply = rawValue; // Already converted
        }
      }

      if (row.tower_loop_return_temp !== null) {
        const rawValue = row.tower_loop_return_temp;
        if (rawValue > 1000) {
          const resistance = rawValue;
          const R0 = 10000;
          const B = 3950;
          const T0 = 298.15;

          const T = 1 / ((1/T0) + (1/B) * Math.log(resistance/R0));
          const tempC = T - 273.15;
          point.return = (tempC * 9/5) + 32;
        } else {
          point.return = rawValue;
        }
      }

      if (row.hp_supply_temp !== null) {
        const rawValue = row.hp_supply_temp;
        if (rawValue > 1000) {
          const resistance = rawValue;
          const R0 = 10000;
          const B = 3950;
          const T0 = 298.15;

          const T = 1 / ((1/T0) + (1/B) * Math.log(resistance/R0));
          const tempC = T - 273.15;
          point.hpSupply = (tempC * 9/5) + 32;
        } else {
          point.hpSupply = rawValue;
        }
      }

      if (row.outdoor_air_temp !== null) point.oat = row.outdoor_air_temp;

      // Map current sensors
      if (row.tower_1_vfd_current_l1 !== null) point.amps1 = row.tower_1_vfd_current_l1;
      if (row.tower_2_vfd_current_l1 !== null) point.amps2 = row.tower_2_vfd_current_l1;
      if (row.tower_3_vfd_current_l1 !== null) point.amps3 = row.tower_3_vfd_current_l1;
      if (row.pump_1_current !== null) point.amps4 = row.pump_1_current;
      if (row.pump_2_current !== null) point.amps5 = row.pump_2_current;
      if (row.pump_3_current !== null) point.amps6 = row.pump_3_current;

      // Map triac states
      point.triac1 = row.triac1 ? 1 : 0;
      point.triac2 = row.triac2 ? 1 : 0;
      point.triac3 = row.triac3 ? 1 : 0;
      point.triac4 = row.triac4 ? 1 : 0;

      return point;
    });

    res.json(transformedData);
  } catch (error) {
    logger.error('Get historical data error:', error);
    res.status(500).json({ error: 'Failed to get historical board data' });
  }
});

// Setpoint API endpoints
app.get('/api/setpoint', async (req, res) => {
  try {
    // Try to get from database
    const setpointStmt = db.metricsDb.prepare(`
      SELECT value FROM system_config WHERE key = 'user_setpoint'
    `);
    const setpointRow = setpointStmt.get();

    const autoModeStmt = db.metricsDb.prepare(`
      SELECT value FROM system_config WHERE key = 'setpoint_auto_mode'
    `);
    const autoModeRow = autoModeStmt.get();

    res.json({
      setpoint: setpointRow ? parseFloat(setpointRow.value) : 70,
      autoMode: autoModeRow ? autoModeRow.value === '1' : false
    });
  } catch (error) {
    logger.error('Get setpoint error:', error);
    res.json({ setpoint: 70, autoMode: false }); // Return defaults on error
  }
});

app.post('/api/setpoint', async (req, res) => {
  try {
    const { setpoint, autoMode } = req.body;

    if (!setpoint || setpoint < 50 || setpoint > 90) {
      return res.status(400).json({ error: 'Invalid setpoint value' });
    }
    
    // Create table if not exists
    db.metricsDb.exec(`
      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    
    // Try to add updated_at column if it doesn't exist
    try {
      db.metricsDb.exec(`ALTER TABLE system_config ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
    } catch (e) {
      // Column already exists, ignore
    }
    
    // Save setpoint - use simpler query that works with or without updated_at
    const setpointStmt = db.metricsDb.prepare(`
      INSERT OR REPLACE INTO system_config (key, value)
      VALUES ('user_setpoint', ?)
    `);
    setpointStmt.run(setpoint.toString());

    // Save auto mode preference if provided
    if (autoMode !== undefined) {
      const autoModeStmt = db.metricsDb.prepare(`
        INSERT OR REPLACE INTO system_config (key, value)
        VALUES ('setpoint_auto_mode', ?)
      `);
      autoModeStmt.run(autoMode ? '1' : '0');
    }

    logger.info(`Setpoint updated to ${setpoint}°F, auto mode: ${autoMode}`);
    res.json({ success: true, setpoint, autoMode });
  } catch (error) {
    logger.error('Save setpoint error:', error);
    res.status(500).json({ error: 'Failed to save setpoint' });
  }
});

// Get logic execution results endpoint
app.get('/api/logic/results/:equipmentId', async (req, res) => {
  try {
    const { equipmentId } = req.params;
    
    // First ensure the table exists
    db.metricsDb.exec(`
      CREATE TABLE IF NOT EXISTS logic_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        equipment_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        inputs TEXT,
        outputs TEXT,
        activeLogic TEXT,
        activeTowers INTEGER,
        coolingDemand REAL,
        loopDeltaT REAL
      )
    `);
    
    // Get the latest execution results from the database
    const stmt = db.metricsDb.prepare(`
      SELECT * FROM logic_results 
      WHERE equipment_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 10
    `);
    
    const results = stmt.all(equipmentId) || [];
    
    // Parse JSON fields if they exist
    const parsedResults = results.map(row => {
      try {
        return {
          ...row,
          inputs: row.inputs ? JSON.parse(row.inputs) : {},
          outputs: row.outputs ? JSON.parse(row.outputs) : {}
        };
      } catch (e) {
        return row;
      }
    });
    
    res.json(parsedResults);
  } catch (error) {
    console.error('Get logic results error:', error);
    // Return empty array to avoid console spam
    res.json([]);
  }
});

// Socket.IO terminal handling
io.on('connection', (socket) => {
  logger.info(`Terminal connection established: ${socket.id}`);

  // Vibration monitoring WebSocket handlers
  socket.on('vibration-subscribe', async (sensorId) => {
    try {
      logger.info(`Client ${socket.id} subscribed to vibration updates for sensor: ${sensorId || 'all'}`);
      socket.join('vibration-updates');

      // Send initial reading from database (not hardware)
      if (sensorId) {
        const reading = vibrationMonitor.getLatestReading(sensorId);
        if (reading) {
          socket.emit('vibration-data', { [sensorId]: reading });
        } else {
          socket.emit('vibration-data', { [sensorId]: { sensor_id: sensorId, error: true, errorMessage: 'No data' } });
        }
      } else {
        // Get all readings from database
        const configs = vibrationMonitor.getConfigs();
        const readings = {};
        for (const config of configs) {
          const reading = vibrationMonitor.getLatestReading(config.sensor_id);
          if (reading) {
            readings[config.sensor_id] = reading;
          }
        }
        socket.emit('vibration-data', readings);
      }
    } catch (error) {
      logger.error('Vibration subscribe error:', error);
      socket.emit('vibration-error', error.message);
    }
  });

  socket.on('vibration-unsubscribe', () => {
    logger.info(`Client ${socket.id} unsubscribed from vibration updates`);
    socket.leave('vibration-updates');
  });

  socket.on('vibration-read', async (sensorId) => {
    try {
      // Don't try to read hardware - just get latest from database
      const reading = vibrationMonitor.getLatestReading(sensorId);
      if (reading) {
        socket.emit('vibration-data', { [sensorId]: reading });
        // Broadcast to all subscribed clients
        io.to('vibration-updates').emit('vibration-data', { [sensorId]: reading });
      } else {
        const errorReading = { sensor_id: sensorId, error: true, errorMessage: 'No data available' };
        socket.emit('vibration-data', { [sensorId]: errorReading });
      }
    } catch (error) {
      logger.error('Vibration read error:', error);
      socket.emit('vibration-error', error.message);
    }
  });

  socket.on('terminal-init', (data) => {
    try {
      const term = pty.spawn('bash', [], {
        name: 'xterm-256color',
        cols: data.cols || 80,
        rows: data.rows || 24,
        cwd: process.env.HOME,
        env: process.env
      });
      
      terminals[socket.id] = term;
      
      term.onData((output) => {
        socket.emit('terminal-output', output);
      });
      
      term.onExit(() => {
        logger.info(`Terminal process exited for ${socket.id}`);
        socket.emit('terminal-output', '\r\n[Process completed]\r\n');
      });
      
      // Send welcome message with branding
      const serial = process.env.CONTROLLER_SERIAL || 'AutomataNexusBms-XXXXXX';
      socket.emit('terminal-output', '\x1b[1;36m╔═══════════════════════════════════════════════════════╗\r\n');
      socket.emit('terminal-output', '\x1b[1;36m║     AutomataControls™ Neural Terminal v2.0           ║\r\n');
      socket.emit('terminal-output', `\x1b[1;36m║     Controller: ${serial.padEnd(38)}║\r\n`);
      socket.emit('terminal-output', '\x1b[1;36m║     © 2024 AutomataNexus, LLC. All Rights Reserved   ║\r\n');
      socket.emit('terminal-output', '\x1b[1;36m╚═══════════════════════════════════════════════════════╝\x1b[0m\r\n\r\n');
      
      logger.info(`Terminal initialized successfully for ${socket.id}`);
    } catch (error) {
      logger.error(`Failed to spawn terminal for ${socket.id}:`, error);
      socket.emit('terminal-output', `\r\n\x1b[1;31mError: Failed to initialize terminal\r\n${error.message}\x1b[0m\r\n`);
    }
  });
  
  socket.on('terminal-input', (data) => {
    if (terminals[socket.id]) {
      terminals[socket.id].write(data);
    }
  });
  
  socket.on('terminal-resize', (data) => {
    if (terminals[socket.id]) {
      terminals[socket.id].resize(data.cols, data.rows);
    }
  });
  
  socket.on('disconnect', () => {
    logger.info(`Terminal disconnected: ${socket.id}`);
    if (terminals[socket.id]) {
      terminals[socket.id].kill();
      delete terminals[socket.id];
    }
  });
});

// Serve the React app
// Catch-all route - serve React app for client-side routing
// But exclude Node-RED paths
app.get('*', (req, res) => {
  // Don't catch API paths, Node-RED paths or static files
  if (req.path.startsWith('/api/') ||
      req.path.startsWith('/vendor/') || 
      req.path.startsWith('/red/') || 
      req.path.startsWith('/icons/') || 
      req.path.startsWith('/locales/') || 
      req.path.startsWith('/settings') ||
      req.path.startsWith('/node-red') ||
      req.path.match(/\.(png|jpg|jpeg|gif|svg|ico|css|js|webp)$/i)) {
    res.status(404).send('Not found');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Terminal Socket.IO handlers moved to line 800

// Start server
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  logger.info(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     AutomataControls™ Remote Portal v2.0                     ║
║     AutomataNexusBms Controller Software                     ║
║                                                               ║
║     Server running on: http://${HOST}:${PORT}                    ║
║     Node-RED proxy: http://localhost:${PORT}/node-red            ║
║                                                               ║
║     © 2024 AutomataNexus, LLC. All Rights Reserved           ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});