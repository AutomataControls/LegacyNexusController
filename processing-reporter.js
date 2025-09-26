#!/usr/bin/env node

// Processing Reporter Service - Standalone process for PM2
console.log('[Processing-Reporter] Starting Processing Reporter Service...');

// Load the processing reporter module
const processingReporter = require('./src/services/processingReporter');

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[Processing-Reporter] Received SIGINT, shutting down gracefully...');
  processingReporter.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Processing-Reporter] Received SIGTERM, shutting down gracefully...');
  processingReporter.stop();
  process.exit(0);
});

// Keep the process alive
process.stdin.resume();

console.log('[Processing-Reporter] Service is running. Press Ctrl+C to stop.');