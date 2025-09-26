#!/usr/bin/env node

// BMS Reporter Service - Standalone process for PM2
console.log('[BMS-Reporter] Starting BMS Reporter Service...');

// Load the BMS reporter module
const bmsReporter = require('./src/services/bmsReporter');

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[BMS-Reporter] Received SIGINT, shutting down gracefully...');
  bmsReporter.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[BMS-Reporter] Received SIGTERM, shutting down gracefully...');
  bmsReporter.stop();
  process.exit(0);
});

// Keep the process alive
process.stdin.resume();

console.log('[BMS-Reporter] Service is running. Press Ctrl+C to stop.');