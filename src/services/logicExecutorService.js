#!/usr/bin/env node

/**
 * Logic Executor Background Service
 * Runs independently of the web interface to execute equipment control logic
 * Persists through page refreshes, browser closes, and reboots
 */

const fs = require('fs').promises;
const path = require('path');
const LogicExecutor = require('./logicExecutor');

class LogicExecutorService {
  constructor() {
    this.executor = new LogicExecutor();
    this.configPath = path.join(__dirname, '../../data/logic_executor_config.json');
    this.resultsPath = path.join(__dirname, '../../data/logic_execution_results.json');
    this.running = false;
    this.config = null;
  }

  async loadConfiguration() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      console.log('[LogicExecutorService] Loaded configuration:', this.config);
      return true;
    } catch (error) {
      console.log('[LogicExecutorService] No configuration found or error loading:', error.message);
      return false;
    }
  }

  async saveConfiguration() {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
      console.log('[LogicExecutorService] Configuration saved');
    } catch (error) {
      console.error('[LogicExecutorService] Error saving configuration:', error);
    }
  }

  async saveResults(results) {
    try {
      // Load existing results
      let allResults = [];
      try {
        const existingData = await fs.readFile(this.resultsPath, 'utf8');
        allResults = JSON.parse(existingData);
      } catch (e) {
        // File doesn't exist yet
      }

      // Add new result
      allResults.push({
        ...results,
        timestamp: new Date().toISOString()
      });

      // Keep only last 100 results
      if (allResults.length > 100) {
        allResults = allResults.slice(-100);
      }

      // Save results
      await fs.writeFile(this.resultsPath, JSON.stringify(allResults, null, 2));
    } catch (error) {
      console.error('[LogicExecutorService] Error saving results:', error);
    }
  }

  async start() {
    console.log('[LogicExecutorService] Starting Logic Executor Service...');

    // Load configuration
    const configLoaded = await this.loadConfiguration();
    if (!configLoaded) {
      console.log('[LogicExecutorService] No configuration found. Service will wait for configuration.');
      // Check for configuration every 10 seconds
      setTimeout(() => this.start(), 10000);
      return;
    }

    // Check if execution is enabled
    if (!this.config.enabled || !this.config.autoRunEnabled) {
      console.log('[LogicExecutorService] Logic execution is disabled. Checking again in 10 seconds...');
      setTimeout(() => this.start(), 10000);
      return;
    }

    // Load board configurations
    await this.executor.loadBoardConfigs();

    // Load the logic file
    if (this.config.logicFilePath) {
      const loaded = await this.executor.loadLogicFile(this.config.logicFilePath);
      
      if (loaded) {
        console.log(`[LogicExecutorService] Logic file loaded: ${this.config.equipmentId}`);
        console.log(`[LogicExecutorService] Starting execution with ${this.config.pollingInterval}s interval`);
        
        this.running = true;
        
        // Execute immediately
        await this.executeLogicCycle();
        
        // Set up interval for periodic execution
        this.executionInterval = setInterval(async () => {
          await this.executeLogicCycle();
        }, this.config.pollingInterval * 1000);
        
      } else {
        console.error('[LogicExecutorService] Failed to load logic file');
        setTimeout(() => this.start(), 10000);
      }
    } else {
      console.log('[LogicExecutorService] No logic file configured');
      setTimeout(() => this.start(), 10000);
    }
  }

  async executeLogicCycle() {
    try {
      console.log(`[LogicExecutorService] Executing logic cycle at ${new Date().toISOString()}`);

      // Reload board configs every cycle in case they've been updated
      await this.executor.loadBoardConfigs();

      const result = await this.executor.executeLogicCycle();
      
      if (result) {
        // Save results for UI to display
        await this.saveResults(result);
        
        // Log key outputs
        if (result.outputs) {
          console.log('[LogicExecutorService] Outputs:', {
            tower1: result.outputs.tower1VFDEnable ? 'ON' : 'OFF',
            tower2: result.outputs.tower2VFDEnable ? 'ON' : 'OFF',
            tower3: result.outputs.tower3VFDEnable ? 'ON' : 'OFF',
            activeTowers: result.outputs.activeTowers,
            coolingDemand: result.outputs.coolingDemand
          });
        }
      }
    } catch (error) {
      console.error('[LogicExecutorService] Error in logic cycle:', error);
    }
  }

  async stop() {
    console.log('[LogicExecutorService] Stopping Logic Executor Service...');
    
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
    }
    
    this.running = false;
    this.executor.stopExecution();
  }

  // Watch for configuration changes
  async watchConfiguration() {
    const fs = require('fs');
    
    try {
      fs.watchFile(this.configPath, async (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
          console.log('[LogicExecutorService] Configuration changed, reloading...');
          
          // Stop current execution
          await this.stop();
          
          // Restart with new configuration
          await this.start();
        }
      });
    } catch (error) {
      console.error('[LogicExecutorService] Error watching configuration:', error);
    }
  }
}

// Handle process signals for graceful shutdown
process.on('SIGINT', async () => {
  console.log('[LogicExecutorService] Received SIGINT, shutting down gracefully...');
  await service.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[LogicExecutorService] Received SIGTERM, shutting down gracefully...');
  await service.stop();
  process.exit(0);
});

// Start the service
const service = new LogicExecutorService();
service.start();
service.watchConfiguration();

console.log('[LogicExecutorService] Logic Executor Service initialized');
console.log('[LogicExecutorService] Watching for configuration changes...');