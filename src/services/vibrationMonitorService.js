const VibrationMonitor = require('./vibrationMonitor');
const databaseManager = require('./databaseManager');

console.log('[VibrationMonitorService] Starting vibration monitoring service...');

// Create vibration monitor instance
const vibrationMonitor = new VibrationMonitor(databaseManager);

// Start polling for tower1 sensor specifically
vibrationMonitor.startPolling('tower1', 15000);

// Restart polling every 5 minutes if it stops
setInterval(() => {
  // Check if tower1 is still polling
  if (!vibrationMonitor.pollingIntervals.has('tower1')) {
    console.log('[VibrationMonitorService] Restarting tower1 polling...');
    vibrationMonitor.startPolling('tower1', 15000);
  }
}, 5 * 60 * 1000); // Every 5 minutes

console.log('[VibrationMonitorService] Vibration monitoring service started');

// Keep the process alive
process.on('SIGINT', () => {
  console.log('[VibrationMonitorService] Shutting down vibration monitoring...');
  vibrationMonitor.stopAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[VibrationMonitorService] Shutting down vibration monitoring...');
  vibrationMonitor.stopAll();
  process.exit(0);
});