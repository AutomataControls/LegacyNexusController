const http = require('http');

// Configuration
const PROCESSING_CONFIG = {
  locationName: "Peabody_Retirement",
  locationId: "0",
  equipmentType: "cooling_tower",
  zone: "Building_Controls",
  reportInterval: 45000, // 45 seconds
  validationUrl: "143.198.162.31",
  validationPort: 8200,
  validationPath: "/validate"
};

// Tower configurations
const towers = [
  { name: "Tower_1", id: "QNiHngLxledu7BHM9wLi" },
  { name: "Tower_2", id: "H2lwkgXBNDsvnuKoDUQe" },
  { name: "Tower_3", id: "QYTVSM7IMylxDc2Y0pxr" }
];

class ProcessingReporter {
  constructor() {
    this.isRunning = false;
    this.reportInterval = null;
  }

  // Get current sensor data from API (same as NodeRedReadings)
  getSensorData() {
    return new Promise((resolve, reject) => {
      http.get('http://localhost:8000/api/boards/current-readings', (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const boardData = JSON.parse(data);
            if (!boardData.inputs) {
              console.error('[ProcessingReporter] No input data available');
              resolve(null);
              return;
            }

            // Parse the data exactly like NodeRedReadings does
            const inputs = boardData.inputs;
            const sensorData = {
              setpoint: inputs.setpoint || 72,
              outdoorAirTemp: inputs.outdoor_air_temp || 0,
              hpLoopSupplyTemp: 0,
              hpLoopReturnTemp: 0,
              towerSupplyTemp: 0,
              towerReturnTemp: 0,
              pump1Current: 0,
              pump2Current: 0,
              pump3Current: 0,
              tower1VfdCurrentL1: 0,
              tower1VfdCurrentL3: 0,
              tower2VfdCurrentL1: 0,
              tower2VfdCurrentL3: 0,
              tower3VfdCurrentL1: 0,
              tower3VfdCurrentL3: 0,
              vfdCurrent7: 0,
              vfdCurrent8: 0
            };

            // Map all inputs based on their keys
            Object.entries(inputs).forEach(([key, value]) => {
              const keyLower = key.toLowerCase();
              const numValue = parseFloat(value);

              // Temperature sensors
              if (keyLower.includes('hp') && keyLower.includes('loop') && keyLower.includes('supply')) {
                sensorData.hpLoopSupplyTemp = numValue;
              } else if (keyLower.includes('hp') && keyLower.includes('loop') && keyLower.includes('return')) {
                sensorData.hpLoopReturnTemp = numValue;
              } else if (keyLower.includes('tower') && keyLower.includes('supply')) {
                sensorData.towerSupplyTemp = numValue;
              } else if (keyLower.includes('tower') && keyLower.includes('return')) {
                sensorData.towerReturnTemp = numValue;
              }
              // Current sensors
              else if (keyLower.includes('pump_1_current')) {
                sensorData.pump1Current = numValue;
              } else if (keyLower.includes('pump_2_current')) {
                sensorData.pump2Current = numValue;
              } else if (keyLower.includes('pump_3_current')) {
                sensorData.pump3Current = numValue;
              } else if (keyLower.includes('tower_1') && keyLower.includes('l1')) {
                sensorData.tower1VfdCurrentL1 = numValue;
              } else if (keyLower.includes('tower_1') && keyLower.includes('l3')) {
                sensorData.tower1VfdCurrentL3 = numValue;
              } else if (keyLower.includes('tower_2') && keyLower.includes('l1')) {
                // Apply baseline offset for Tower 2 L1: 2.01A
                sensorData.tower2VfdCurrentL1 = Math.max(0, numValue - 2.01);
              } else if (keyLower.includes('tower_2') && keyLower.includes('l3')) {
                // Apply baseline offset for Tower 2 L3: 3.865A
                sensorData.tower2VfdCurrentL3 = Math.max(0, numValue - 3.865);
              } else if (keyLower.includes('tower_3') && keyLower.includes('l1')) {
                // Apply baseline offset for Tower 3 L1: 3.255A
                sensorData.tower3VfdCurrentL1 = Math.max(0, numValue - 3.255);
              } else if (keyLower.includes('tower_3') && keyLower.includes('l3')) {
                // Apply baseline offset for Tower 3 L3: 7.685A
                sensorData.tower3VfdCurrentL3 = Math.max(0, numValue - 7.685);
              } else if (keyLower.includes('vfd') && keyLower.includes('7')) {
                sensorData.vfdCurrent7 = numValue;
              } else if (keyLower.includes('vfd') && keyLower.includes('8')) {
                sensorData.vfdCurrent8 = numValue;
              }
            });

            resolve(sensorData);
          } catch (error) {
            console.error('[ProcessingReporter] Error parsing board data:', error);
            resolve(null);
          }
        });
      }).on('error', (error) => {
        console.error('[ProcessingReporter] Error fetching board data:', error);
        resolve(null);
      });
    });
  }

  // Generate validation payload for a tower
  generateValidationPayload(towerName, equipmentId, data) {
    // Determine tower-specific VFD currents and pump current
    let vfdCurrentL1, vfdCurrentL3, pumpCurrent;

    switch(towerName) {
      case "Tower_1":
        vfdCurrentL1 = data.tower1VfdCurrentL1;
        vfdCurrentL3 = data.tower1VfdCurrentL3;
        pumpCurrent = data.pump1Current;
        break;
      case "Tower_2":
        vfdCurrentL1 = data.tower2VfdCurrentL1;
        vfdCurrentL3 = data.tower2VfdCurrentL3;
        pumpCurrent = data.pump2Current;
        break;
      case "Tower_3":
        vfdCurrentL1 = data.tower3VfdCurrentL1;
        vfdCurrentL3 = data.tower3VfdCurrentL3;
        pumpCurrent = data.pump3Current;
        break;
      default:
        vfdCurrentL1 = 0.0;
        vfdCurrentL3 = 0.0;
        pumpCurrent = 0.0;
    }

    const payload = {
      equipmentId: equipmentId,
      equipmentType: PROCESSING_CONFIG.equipmentType,
      timestamp: new Date().toISOString(),
      data: {
        location_id: parseInt(PROCESSING_CONFIG.locationId),
        system: towerName,
        location: "peabody",  // Must be lowercase
        // Cooling Tower specific data - only this tower's metrics
        Setpoint: data.setpoint,
        Outdoor_Air_Temp: data.outdoorAirTemp,
        HP_Loop_Supply_Temp: data.hpLoopSupplyTemp,
        HP_Loop_Return_Temp: data.hpLoopReturnTemp,
        Tower_Supply_Temp: data.towerSupplyTemp,
        Tower_Return_Temp: data.towerReturnTemp,
        Pump_Current: pumpCurrent,  // Only this tower's pump
        VFD_Current_L1: vfdCurrentL1,
        VFD_Current_L3: vfdCurrentL3,
        // Status fields
        Status: "running",
        CustomLogicEnabled: true,
        command_type: "metrics",
        source: "NeuralBms",
        zone: PROCESSING_CONFIG.zone
      }
    };

    return payload;
  }

  // Send data to validation proxy via HTTP
  sendToValidationProxy(payload, towerName) {
    return new Promise((resolve, reject) => {
      // Wrap payload in the format required by Peabody validation proxy
      const validationMessage = {
        location: "peabody",  // lowercase 'location'
        locationId: "0",      // lowercase 'locationId'
        equipment: [payload]  // lowercase 'equipment' as array
      };
      const postData = JSON.stringify(validationMessage);

      console.log(`[ProcessingReporter] Sending ${towerName} payload:`, JSON.stringify(validationMessage, null, 2).substring(0, 500));

      const options = {
        hostname: PROCESSING_CONFIG.validationUrl,
        port: PROCESSING_CONFIG.validationPort,
        path: PROCESSING_CONFIG.validationPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 8000
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            console.log(`[ProcessingReporter] ${towerName} data sent successfully`);
            resolve({ success: true, tower: towerName });
          } else {
            console.error(`[ProcessingReporter] Failed to send ${towerName} data: ${res.statusCode}`);
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error(`[ProcessingReporter] Error sending ${towerName} data:`, error.message);
        reject(error);
      });

      req.on('timeout', () => {
        console.error(`[ProcessingReporter] Request timeout for ${towerName}`);
        req.destroy();
        reject(new Error('Request timeout'));
      });

      // Write data to request body
      req.write(postData);
      req.end();
    });
  }

  // Send data for all towers
  async sendAllTowerData() {
    try {
      // Get current sensor data
      const sensorData = await this.getSensorData();

      if (!sensorData) {
        console.error('[ProcessingReporter] No sensor data available, skipping report');
        return;
      }

      console.log('[ProcessingReporter] Sending data to validation proxy...');

      // Send data for each tower separately
      for (const tower of towers) {
        try {
          const payload = this.generateValidationPayload(tower.name, tower.id, sensorData);
          await this.sendToValidationProxy(payload, tower.name);

          // Small delay between requests
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`[ProcessingReporter] Error sending ${tower.name} data:`, error.message);
          // Continue with other towers even if one fails
        }
      }

      console.log('[ProcessingReporter] Processing report cycle completed');
    } catch (error) {
      console.error('[ProcessingReporter] Error in sendAllTowerData:', error);
    }
  }

  // Start the reporting service
  start() {
    if (this.isRunning) {
      console.log('[ProcessingReporter] Already running');
      return;
    }

    console.log('[ProcessingReporter] Starting processing reporting service...');
    this.isRunning = true;

    // Send initial report
    this.sendAllTowerData();

    // Set up interval for periodic reporting
    this.reportInterval = setInterval(() => {
      this.sendAllTowerData();
    }, PROCESSING_CONFIG.reportInterval);

    console.log(`[ProcessingReporter] Reporting every ${PROCESSING_CONFIG.reportInterval / 1000} seconds to ${PROCESSING_CONFIG.validationUrl}:${PROCESSING_CONFIG.validationPort}`);
  }

  // Stop the reporting service
  stop() {
    if (!this.isRunning) {
      console.log('[ProcessingReporter] Not running');
      return;
    }

    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }

    this.isRunning = false;
    console.log('[ProcessingReporter] Stopped');
  }

  // Get service status
  getStatus() {
    return {
      running: this.isRunning,
      config: PROCESSING_CONFIG,
      towers: towers
    };
  }
}

// Create singleton instance
const processingReporter = new ProcessingReporter();

// Start the reporter automatically
processingReporter.start();

module.exports = processingReporter;