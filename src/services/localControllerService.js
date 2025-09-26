#!/usr/bin/env node

/**
 * Local Controller Service - Standalone Process
 * Runs independently of the web portal to ensure continuous operation
 * Controls Sequent Microsystems boards directly when BMS failover occurs
 */

const LocalController = require('./localController');
const bmsMonitor = require('./bmsMonitor');
const path = require('path');

console.log('Starting Local Controller Service...');

// Initialize database manager (it's already a singleton)
const databaseManager = require('./databaseManager');
console.log('Connected to metrics database');

// Initialize local controller with database
const controller = new LocalController(databaseManager);

// Connect BMS monitor to controller
controller.setBmsMonitor(bmsMonitor);

// Start BMS monitoring
bmsMonitor.connect();

// Handle process signals
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  controller.stop();
  bmsMonitor.disconnect();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  controller.stop();
  bmsMonitor.disconnect();
  process.exit(0);
});

// Log status every minute
setInterval(() => {
  const status = controller.getStatus();
  console.log('Controller Status:', {
    running: status.running,
    equipmentCount: status.equipmentCount,
    bmsConnected: bmsMonitor.connected,
    usingLocalFiles: bmsMonitor.usingLocalFile
  });
}, 60000);

console.log('Local Controller Service started successfully');
console.log('Monitoring BMS at:', bmsMonitor.bmsIP);
console.log('Service will run continuously in background via PM2');