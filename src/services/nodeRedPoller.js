/*
 * Node-RED Data Poller
 * Fetches data from Node-RED and stores it in the database
 */

const axios = require('axios');
const logger = require('winston');

class NodeRedPoller {
  constructor(databaseManager) {
    this.db = databaseManager;
    this.pollInterval = 30000; // 30 seconds
    this.nodeRedUrl = 'http://localhost:1880/api/readings';
    this.isPolling = false;
    this.pollTimer = null;
    this.alarmMonitor = null;
  }
  
  setAlarmMonitor(alarmMonitor) {
    this.alarmMonitor = alarmMonitor;
  }

  async fetchAndStore() {
    try {
      // Fetch data from Node-RED
      const response = await axios.get(this.nodeRedUrl, {
        timeout: 5000
      });
      
      const data = response.data;
      
      // Validate data
      if (data && data.inputs && data.outputs) {
        // Store in database
        await this.db.insertNodeRedReadings(data);
        console.log('Node-RED readings stored successfully');
        
        // Check alarms if monitor is set
        if (this.alarmMonitor) {
          this.alarmMonitor.checkThresholds(data);
        }
      }
    } catch (error) {
      console.error('Error polling Node-RED:', error.message);
    }
  }

  start() {
    if (this.isPolling) {
      console.log('Node-RED poller already running');
      return;
    }

    this.isPolling = true;
    console.log('Starting Node-RED data poller...');
    
    // Initial fetch
    this.fetchAndStore();
    
    // Set up interval
    this.pollTimer = setInterval(() => {
      this.fetchAndStore();
    }, this.pollInterval);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
    console.log('Node-RED poller stopped');
  }
}

module.exports = NodeRedPoller;