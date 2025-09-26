const http = require('http');
const databaseManager = require('./databaseManager');
const vibrationMonitor = require('./vibrationMonitor');

// Configuration
const BMS_CONFIG = {
  locationName: "Peabody_Retirement",
  locationId: "0",
  equipmentType: "cooling_tower",
  zone: "Building_Controls",
  reportInterval: 45000, // 45 seconds
  influxUrl: "143.198.162.31",
  influxPort: 8181,
  influxPath: "/api/v3/write_lp",
  database: "Locations",
  precision: "nanosecond"
};

// Tower configurations
const towers = [
  { name: "Tower_1", id: "QNiHngLxledu7BHM9wLi" },
  { name: "Tower_2", id: "H2lwkgXBNDsvnuKoDUQe" },
  { name: "Tower_3", id: "QYTVSM7IMylxDc2Y0pxr" }
];

class BMSReporter {
  constructor() {
    this.isRunning = false;
    this.reportInterval = null;
  }

  // Get current sensor data from API (same as NodeRedReadings)
  async getSensorData() {
    return new Promise(async (resolve, reject) => {
      http.get('http://localhost:8000/api/boards/current-readings', (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', async () => {
          try {
            const boardData = JSON.parse(data);
            if (!boardData.inputs) {
              console.error('[BMSReporter] No input data available');
              resolve(null);
              return;
            }

      // Parse the data exactly like NodeRedReadings does
      const inputs = boardData.inputs;
      const outputs = boardData.outputs || {};
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
        vfdCurrent8: 0,
        // VFD speeds from analog outputs (0-100%)
        tower1VfdSpeed: (outputs.analog && outputs.analog.ao1) || 0,
        tower2VfdSpeed: (outputs.analog && outputs.analog.ao2) || 0,
        tower3VfdSpeed: (outputs.analog && outputs.analog.ao3) || 0,
        // Vibration sensor data (will be populated separately)
        tower1VibrationVelocity: 0,
        tower1VibrationTemp: 0,
        tower1VibrationZone: 'Unknown',
        tower1VibrationStatus: 'Unknown',
        tower2VibrationVelocity: 0,
        tower2VibrationTemp: 0,
        tower2VibrationZone: 'Unknown',
        tower2VibrationStatus: 'Unknown',
        tower3VibrationVelocity: 0,
        tower3VibrationTemp: 0,
        tower3VibrationZone: 'Unknown',
        tower3VibrationStatus: 'Unknown'
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

      // Try to get vibration sensor data for Tower 1
      try {
        // Get the latest reading directly from database
        const vibQuery = databaseManager.metricsDb.prepare(`
          SELECT velocity_mms, temperature_f, iso_zone, alert_level
          FROM vibration_readings
          WHERE sensor_id = 'tower1'
          ORDER BY timestamp DESC
          LIMIT 1
        `);
        const vibrationData = vibQuery.get();
        if (vibrationData) {
          sensorData.tower1VibrationVelocity = vibrationData.velocity_mms || 0;
          sensorData.tower1VibrationTemp = vibrationData.temperature_f || 0;
          sensorData.tower1VibrationZone = vibrationData.iso_zone || 'Unknown';
          sensorData.tower1VibrationStatus = vibrationData.alert_level || 'Unknown';
          console.log('[BMSReporter] Tower 1 vibration: ' + vibrationData.velocity_mms.toFixed(2) + ' mm/s');
        }
      } catch (err) {
        console.log('[BMSReporter] Could not get Tower 1 vibration data:', err.message);
      }

      // Tower 2 and 3 sensors not connected yet
      // Will add when sensors are installed

            resolve(sensorData);
          } catch (error) {
            console.error('[BMSReporter] Error parsing board data:', error);
            resolve(null);
          }
        });
      }).on('error', (error) => {
        console.error('[BMSReporter] Error fetching board data:', error);
        resolve(null);
      });
    });
  }

  // Generate InfluxDB line protocol for a tower
  generateLineProtocol(towerName, equipmentId, data) {
    // Determine tower-specific VFD currents and speed
    let vfdCurrentL1, vfdCurrentL3, vfdSpeed;
    let pumpCurrent;
    let vibrationVelocity, vibrationTemp, vibrationZone, vibrationStatus;

    switch(towerName) {
      case "Tower_1":
        vfdCurrentL1 = data.tower1VfdCurrentL1;
        vfdCurrentL3 = data.tower1VfdCurrentL3;
        vfdSpeed = data.tower1VfdSpeed;
        pumpCurrent = data.pump1Current; // Pump 1 pairs with Tower 1
        vibrationVelocity = data.tower1VibrationVelocity;
        vibrationTemp = data.tower1VibrationTemp;
        vibrationZone = data.tower1VibrationZone;
        vibrationStatus = data.tower1VibrationStatus;
        break;
      case "Tower_2":
        vfdCurrentL1 = data.tower2VfdCurrentL1;
        vfdCurrentL3 = data.tower2VfdCurrentL3;
        vfdSpeed = data.tower2VfdSpeed;
        pumpCurrent = data.pump2Current; // Pump 2 pairs with Tower 2
        vibrationVelocity = data.tower2VibrationVelocity;
        vibrationTemp = data.tower2VibrationTemp;
        vibrationZone = data.tower2VibrationZone;
        vibrationStatus = data.tower2VibrationStatus;
        break;
      case "Tower_3":
        vfdCurrentL1 = data.tower3VfdCurrentL1;
        vfdCurrentL3 = data.tower3VfdCurrentL3;
        vfdSpeed = data.tower3VfdSpeed;
        pumpCurrent = data.pump3Current; // Pump 3 pairs with Tower 3
        vibrationVelocity = data.tower3VibrationVelocity;
        vibrationTemp = data.tower3VibrationTemp;
        vibrationZone = data.tower3VibrationZone;
        vibrationStatus = data.tower3VibrationStatus;
        break;
      default:
        vfdCurrentL1 = 0.0;
        vfdCurrentL3 = 0.0;
        vfdSpeed = 0.0;
        pumpCurrent = 0.0;
        vibrationVelocity = 0.0;
        vibrationTemp = 0.0;
        vibrationZone = 'Unknown';
        vibrationStatus = 'Unknown';
    }

    // Build line protocol string - only send tower-specific data + shared temps
    const lineProtocol = `metrics,` +
      `location=${BMS_CONFIG.locationName},` +
      `system=${towerName},` +
      `equipment_type=${BMS_CONFIG.equipmentType},` +
      `location_id=${BMS_CONFIG.locationId},` +
      `equipmentId=${equipmentId},` +
      `zone=${BMS_CONFIG.zone} ` +
      `Setpoint=${data.setpoint.toFixed(1)},` +
      `Outdoor_Air_Temp=${data.outdoorAirTemp.toFixed(1)},` +
      `HP_Loop_Supply_Temp=${data.hpLoopSupplyTemp.toFixed(1)},` +
      `HP_Loop_Return_Temp=${data.hpLoopReturnTemp.toFixed(1)},` +
      `Tower_Supply_Temp=${data.towerSupplyTemp.toFixed(1)},` +
      `Tower_Return_Temp=${data.towerReturnTemp.toFixed(1)},` +
      `Pump_Current=${pumpCurrent.toFixed(1)},` +
      `VFD_Current_L1=${vfdCurrentL1.toFixed(1)},` +
      `VFD_Current_L3=${vfdCurrentL3.toFixed(1)},` +
      `VFD_Speed=${vfdSpeed.toFixed(1)},` +
      `Vibration_Velocity=${vibrationVelocity.toFixed(2)},` +
      `Vibration_Temp=${vibrationTemp.toFixed(1)},` +
      `Vibration_Zone="${vibrationZone}",` +
      `Vibration_Status="${vibrationStatus}"`;

    return lineProtocol;
  }

  // Send data to InfluxDB via HTTP
  sendToInfluxDB(lineProtocol, towerName) {
    return new Promise((resolve, reject) => {
      const postData = lineProtocol;

      const options = {
        hostname: BMS_CONFIG.influxUrl,
        port: BMS_CONFIG.influxPort,
        path: `${BMS_CONFIG.influxPath}?db=${BMS_CONFIG.database}&precision=${BMS_CONFIG.precision}`,
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 204 || res.statusCode === 200) {
            console.log(`[BMSReporter] ${towerName} data sent successfully`);
            resolve({ success: true, tower: towerName });
          } else {
            console.error(`[BMSReporter] Failed to send ${towerName} data: ${res.statusCode}`);
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error(`[BMSReporter] Error sending ${towerName} data:`, error.message);
        reject(error);
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
        console.error('[BMSReporter] No sensor data available, skipping report');
        return;
      }

      console.log('[BMSReporter] Sending data to BMS server...');

      // Send data for each tower
      for (const tower of towers) {
        try {
          const lineProtocol = this.generateLineProtocol(tower.name, tower.id, sensorData);
          await this.sendToInfluxDB(lineProtocol, tower.name);

          // Small delay between requests
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`[BMSReporter] Error sending ${tower.name} data:`, error.message);
          // Continue with other towers even if one fails
        }
      }

      console.log('[BMSReporter] BMS report cycle completed');
    } catch (error) {
      console.error('[BMSReporter] Error in sendAllTowerData:', error);
    }
  }

  // Start the reporting service
  start() {
    if (this.isRunning) {
      console.log('[BMSReporter] Already running');
      return;
    }

    console.log('[BMSReporter] Starting BMS reporting service...');
    this.isRunning = true;

    // Send initial report
    this.sendAllTowerData();

    // Set up interval for periodic reporting
    this.reportInterval = setInterval(() => {
      this.sendAllTowerData();
    }, BMS_CONFIG.reportInterval);

    console.log(`[BMSReporter] Reporting every ${BMS_CONFIG.reportInterval / 1000} seconds to ${BMS_CONFIG.influxUrl}`);
  }

  // Stop the reporting service
  stop() {
    if (!this.isRunning) {
      console.log('[BMSReporter] Not running');
      return;
    }

    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }

    this.isRunning = false;
    console.log('[BMSReporter] Stopped');
  }

  // Get service status
  getStatus() {
    return {
      running: this.isRunning,
      config: BMS_CONFIG,
      towers: towers,
      lastReport: this.lastReport || null
    };
  }
}

// Create singleton instance
const bmsReporter = new BMSReporter();

// Start the reporter automatically
bmsReporter.start();

module.exports = bmsReporter;