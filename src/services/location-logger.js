/**
 * Location Logger for AutomataNexus Remote Portal
 * Simple logger for local failover mode - doesn't need server database
 */

const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

function logLocationEquipment(locationId, equipmentId, type, message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${type}] Location: ${locationId}, Equipment: ${equipmentId}: ${message}\n`;
  
  // Console log for immediate visibility
  console.log(`[${type}] ${equipmentId}: ${message}`);
  
  // Also write to file for persistence
  const logFile = path.join(logDir, `equipment-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFile(logFile, logEntry, (err) => {
    if (err) console.error('Error writing to log file:', err);
  });
}

module.exports = {
  logLocationEquipment
};