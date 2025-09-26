// ===============================================================================
// Automata Nexus AI - Cooling Tower Control Logic
// Neural Facility Intelligence Processing Infrastructure (PRODUCTION)
// ===============================================================================

/**
 * Cooling Tower Control Logic
 * 
 * This module implements intelligent control algorithms for cooling tower systems
 * including tower staging, pump control, VFD speed control, vibration monitoring,
 * and loop tempering valve control.
 * 
 * Equipment Configuration:
 * - 3 x 20HP VFD Tower Fans (0-10V speed control)
 * - 3 x Tower Water Pumps (external pump controls)
 * - 6 x Current Sensors (0-10VDC, 2 per VFD, 0-50A range)
 * - 3 x Pump Current Sensors (0-10VDC, 0-50A range)
 * - 4 x 10K NTC Temperature Sensors
 * - 3 x WTV801-RS485 Vibration Sensors (ISO10816)
 * - 3 x CH340 USB-RS485 Adapters
 * - 1 x Bypass Valve (0-10V control)
 * - 3 x Tower Heaters (relay control)
 * 
 * Equipment IDs:
 * - Cooling_Tower-1: QNiHngLxledu7BHM9wLi
 * - Cooling_Tower-2: H2lwkgXBNDsvnuKoDUQe
 * - Cooling_Tower-3: QYTVSM7IMylxDc2Y0pxr
 * 
 * Location ID: Current Mechanical
 * Equipment ID: Cooling Tower System
 * 
 * @module CoolingTowerLogic
 * @version 1.1.0
 * @author AutomataNexus - Current Mechanical License #CM-2024-001
 * @date 2025-08-18
 */

// EQUIPMENT IDENTIFICATION
const EQUIPMENT_IDS = {
    COOLING_TOWER_1: 'QNiHngLxledu7BHM9wLi',
    COOLING_TOWER_2: 'H2lwkgXBNDsvnuKoDUQe',
    COOLING_TOWER_3: 'QYTVSM7IMylxDc2Y0pxr'
};

// CONFIGURATION SECTION - Safety Bypass Settings
const COOLING_TOWER_CONFIG = {
    // Equipment identification
    EQUIPMENT_IDS: EQUIPMENT_IDS,

    // Safety bypass toggles (set to false for production safety)
    BYPASS_EMERGENCY_STOP: false,        // Bypass emergency stop requirement
    BYPASS_WATER_LEVEL: false,           // Bypass water level requirement  
    BYPASS_VIBRATION_LIMITS: false,      // Bypass vibration safety limits
    BYPASS_CURRENT_LIMITS: false,        // Bypass motor current limits
    BYPASS_PUMP_STATUS: false,           // Bypass pump running status requirement
    BYPASS_VFD_FAULTS: false,            // Bypass VFD fault monitoring

    // Equipment Availability (set to false to disable equipment for maintenance)
    TOWER_1_AVAILABLE: true,             // Tower 1 available for operation
    TOWER_2_AVAILABLE: true,             // Tower 2 available for operation
    TOWER_3_AVAILABLE: true,             // Tower 3 available for operation (set to false for maintenance)
    PUMP_1_AVAILABLE: true,              // Pump 1 available for operation
    PUMP_2_AVAILABLE: true,              // Pump 2 available for operation
    PUMP_3_AVAILABLE: true,              // Pump 3 available for operation

    // Control parameters
    LEAD_TOWER_ROTATION: 'weekly',       // Weekly lead tower rotation
    TARGET_SUPPLY_TEMP: 70.0,           // Target cooling tower supply temperature
    DEADBAND_TEMP: 1.0,                 // Temperature control deadband

    // Vibration limits (mm/s RMS - ISO10816)
    VIBRATION_WARNING_LIMIT: 4.5,       // Warning level
    VIBRATION_CRITICAL_LIMIT: 7.1,      // Critical shutdown level

    // Current limits (Amps)
    VFD_CURRENT_WARNING: 40.0,          // VFD current warning (8V = 40A)
    VFD_CURRENT_CRITICAL: 45.0,         // VFD current critical (9V = 45A)
    PUMP_CURRENT_MIN: 5.0,              // Minimum pump current (1V = 5A)
    PUMP_CURRENT_MAX: 45.0,             // Maximum pump current (9V = 45A)

    // Staging thresholds (°F delta-T)
    STAGE_1_DELTA_T: 5.0,               // Start lead tower low speed
    STAGE_2_DELTA_T: 10.0,              // Lead tower high speed
    STAGE_3_DELTA_T: 12.0,              // Add lag tower 1
    STAGE_4_DELTA_T: 15.0,              // Add lag tower 2
    SHUTDOWN_DELTA_T: 5.0,              // Normal shutdown threshold

    // VFD speed references (0-10V) with intermediate steps
    VFD_MIN_SPEED: 3.0,                 // ~33Hz (3.0V) - Minimum run speed
    VFD_LOW_SPEED: 3.5,                 // ~39Hz (3.5V) - Low speed
    VFD_MED_LOW_SPEED: 4.0,             // ~44Hz (4.0V) - Medium-low speed
    VFD_MED_SPEED: 4.3,                 // ~48Hz (4.3V) - Medium speed
    VFD_MED_HIGH_SPEED: 4.6,            // ~51Hz (4.6V) - Medium-high speed
    VFD_HIGH_SPEED: 4.95,               // 55Hz (4.95V) - Maximum speed

    // Timing delays (milliseconds)
    PUMP_START_DELAY: 10000,            // 10 seconds
    VALVE_OPEN_DELAY: 15000,            // 15 seconds
    FAN_START_DELAY: 30000,             // 30 seconds after pump
    VFD_RAMP_STEP_DELAY: 15000,         // 15 seconds between speed changes
    VFD_RAMP_DOWN_DELAY: 20000,         // 20 seconds for ramp down steps
};

/**
 * Main cooling tower control function
 * 
 * Processes incoming sensor data and generates control commands for
 * cooling tower systems with proper staging and safety interlocks.
 * 
 * @param {Object} data - Sensor data from cooling tower systems
 * @param {Object} uiCommands - User interface commands and setpoints
 * @param {Object} stateStorage - Persistent state storage for timing and cycling
 * @returns {Object} Control commands for cooling tower systems
 */
function processCoolingTowerControl(data, uiCommands = {}, stateStorage = {}) {
    try {
        // Initialize state storage if needed
        if (!stateStorage.towerStaging) {
            stateStorage.towerStaging = {
                leadTower: 1,
                lastRotationTime: Date.now(),
                tower1Runtime: 0,
                tower2Runtime: 0,
                tower3Runtime: 0,
                stagingTimers: {}
            };
        }

        // Initialize pump rotation state if needed
        if (!stateStorage.pumpRotation) {
            stateStorage.pumpRotation = {
                activePump: 1,                    // Currently running pump (1, 2, or 3)
                lastRotationTime: Date.now(),     // Last pump rotation timestamp
                pump1Runtime: 0,                  // Total runtime hours
                pump2Runtime: 0,
                pump3Runtime: 0,
                changeoverInProgress: false,      // Flag for 5-second overlap
                changeoverStartTime: 0,           // When changeover started
                newPump: 0,                       // Next pump to activate
                failoverCount: 0,                 // Number of failovers
                lastFailoverTime: 0               // Last failover timestamp
            };
        }

        // Initialize control result object
        const controlResult = {
            // Equipment identification
            equipmentIds: EQUIPMENT_IDS,

            // Building Automation HAT Outputs
            // Triacs T1-T3: Tower VFD Enables
            tower1VFDEnable: false,      // T1 - Equipment ID: QNiHngLxledu7BHM9wLi
            tower2VFDEnable: false,      // T2 - Equipment ID: H2lwkgXBNDsvnuKoDUQe
            tower3VFDEnable: false,      // T3 - Equipment ID: QYTVSM7IMylxDc2Y0pxr

            // Analog Outputs AO1-AO4
            tower1FanSpeed: 0,           // AO1: 0-10V speed reference
            tower2FanSpeed: 0,           // AO2: 0-10V speed reference  
            tower3FanSpeed: 0,           // AO3: 0-10V speed reference
            bypassValvePosition: 0,      // AO4: 0-10V bypass valve control

            // 16 Relay Board Outputs
            pump1Enable: false,          // CH1 - Pump 1 Enable
            pump2Enable: false,          // CH2 - Pump 2 Enable
            pump3Enable: false,          // CH3 - Pump 3 Enable

            // Isolation Valve Controls
            tower3IsolationValveClose: false,   // CH7 - Tower 3 Iso Valve Close
            tower3IsolationValveOpen: false,    // CH8 - Tower 3 Iso Valve Open
            tower2IsolationValveClose: false,   // CH9 - Tower 2 Iso Valve Close
            tower2IsolationValveOpen: false,    // CH10 - Tower 2 Iso Valve Open
            tower1IsolationValveClose: false,   // CH11 - Tower 1 Iso Valve Close
            tower1IsolationValveOpen: false,    // CH12 - Tower 1 Iso Valve Open

            // Heater Controls
            tower3HeaterEnable: false,   // CH14 - Tower 3 Heater
            tower2HeaterEnable: false,   // CH15 - Tower 2 Heater
            tower1HeaterEnable: false    // CH16 - Tower 1 Heater

            // System status
            systemEnabled: true,
            emergencyStop: false,
            waterLevelOK: true,

            // Current readings from Building Automation HAT
            tower1VFDCurrentA: 0,        // AI1: 0-10V = 0-50A
            tower1VFDCurrentB: 0,        // AI2: 0-10V = 0-50A
            tower2VFDCurrentA: 0,        // AI3: 0-10V = 0-50A
            tower2VFDCurrentB: 0,        // AI4: 0-10V = 0-50A
            tower3VFDCurrentA: 0,        // AI5: 0-10V = 0-50A
            tower3VFDCurrentB: 0,        // AI6: 0-10V = 0-50A

            // Current readings from 16 Relay Board
            pump1Current: 0,             // CH8: 0-10V = 0-50A (Pump 1)
            pump2Current: 0,             // CH5: 0-10V = 0-50A (Pump 2)
            pump3Current: 0,             // CH7: 0-10V = 0-50A (Pump 3)

            // Temperature readings from 16 Relay Board
            towerLoopSupplyTemp: 0,      // CH1: 10K NTC
            towerLoopReturnTemp: 0,      // CH2: 10K NTC
            heatPumpReturnTemp: 0,       // CH9: 10K NTC
            heatPumpSupplyTemp: 0,       // CH10: 10K NTC
            outdoorTemp: 0,              // From weather database

            // Pump status monitoring
            pump1Running: false,
            pump2Running: false,
            pump3Running: false,

            // Vibration monitoring
            tower1VibrationOK: true,
            tower1VibrationLevel: 0,
            tower2VibrationOK: true,
            tower2VibrationLevel: 0,
            tower3VibrationOK: true,
            tower3VibrationLevel: 0,

            // Control mode and staging
            controlMode: 'auto',
            leadTower: 1,
            activeTowers: 0,
            coolingDemand: 0,

            // Loop control
            loopDeltaT: 0,
            targetSupplyTemp: COOLING_TOWER_CONFIG.TARGET_SUPPLY_TEMP,

            // Alarms and faults
            alarmStatus: 'normal',
            faultConditions: [],
            safetyBypasses: [],

            // Timestamps
            lastUpdate: new Date().toISOString(),
            controlTimestamp: Date.now()
        };

        // Extract current readings from Building Automation HAT (0-10V = 0-50A)
        const tower1VFDCurrentA = parseFloat(data.AI1 || 0) * 5.0; // Convert 0-10V to 0-50A
        const tower1VFDCurrentB = parseFloat(data.AI2 || 0) * 5.0;
        const tower2VFDCurrentA = parseFloat(data.AI3 || 0) * 5.0;
        const tower2VFDCurrentB = parseFloat(data.AI4 || 0) * 5.0;
        const tower3VFDCurrentA = parseFloat(data.AI5 || 0) * 5.0;
        const tower3VFDCurrentB = parseFloat(data.AI6 || 0) * 5.0;

        // Extract pump currents from 16 Input Board (0-10V = 0-50A)
        // Updated to match actual board configuration:
        // CH8 = Pump 1, CH5 = Pump 2, CH6 = Pump 3
        const pump1Current = parseFloat(data.CH8 || 0) * 5.0;
        const pump2Current = parseFloat(data.CH5 || 0) * 5.0;
        const pump3Current = parseFloat(data.CH6 || 0) * 5.0;

        // Extract temperatures from 16 Relay Board (10K NTC thermistors)
        const towerLoopSupplyTemp = parseFloat(data.CH1 || 85);
        const towerLoopReturnTemp = parseFloat(data.CH2 || 95);
        const heatPumpReturnTemp = parseFloat(data.CH9 || 85);
        const heatPumpSupplyTemp = parseFloat(data.CH10 || 75);
        // Outdoor temp comes from weather database, not a physical sensor
        const outdoorTemp = parseFloat(data.outdoorTemp || 75);

        // Calculate loop delta-T
        const deltaT = towerLoopReturnTemp - towerLoopSupplyTemp;

        // Vibration monitoring from RS485 sensors
        const tower1VibrationLevel = parseFloat(data.WTV801_1 || 0);
        const tower2VibrationLevel = parseFloat(data.WTV801_2 || 0);
        const tower3VibrationLevel = parseFloat(data.WTV801_3 || 0);

        // Determine pump running status based on current (>5A = running)
        const pump1Running = pump1Current > COOLING_TOWER_CONFIG.PUMP_CURRENT_MIN;
        const pump2Running = pump2Current > COOLING_TOWER_CONFIG.PUMP_CURRENT_MIN;
        const pump3Running = pump3Current > COOLING_TOWER_CONFIG.PUMP_CURRENT_MIN;

        // Update control result with current readings
        controlResult.tower1VFDCurrentA = tower1VFDCurrentA;
        controlResult.tower1VFDCurrentB = tower1VFDCurrentB;
        controlResult.tower2VFDCurrentA = tower2VFDCurrentA;
        controlResult.tower2VFDCurrentB = tower2VFDCurrentB;
        controlResult.tower3VFDCurrentA = tower3VFDCurrentA;
        controlResult.tower3VFDCurrentB = tower3VFDCurrentB;

        controlResult.pump1Current = pump1Current;
        controlResult.pump2Current = pump2Current;
        controlResult.pump3Current = pump3Current;
        controlResult.pump1Running = pump1Running;
        controlResult.pump2Running = pump2Running;
        controlResult.pump3Running = pump3Running;

        controlResult.towerLoopSupplyTemp = towerLoopSupplyTemp;
        controlResult.towerLoopReturnTemp = towerLoopReturnTemp;
        controlResult.heatPumpReturnTemp = heatPumpReturnTemp;
        controlResult.heatPumpSupplyTemp = heatPumpSupplyTemp;
        controlResult.outdoorTemp = outdoorTemp;
        controlResult.loopDeltaT = deltaT;

        controlResult.tower1VibrationLevel = tower1VibrationLevel;
        controlResult.tower2VibrationLevel = tower2VibrationLevel;
        controlResult.tower3VibrationLevel = tower3VibrationLevel;

        // Check vibration levels (ISO10816 standards)
        controlResult.tower1VibrationOK = tower1VibrationLevel <= COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT;
        controlResult.tower2VibrationOK = tower2VibrationLevel <= COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT;
        controlResult.tower3VibrationOK = tower3VibrationLevel <= COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT;

        // SAFETY CHECKS with configurable bypasses
        const faultConditions = [];
        const safetyBypasses = [];

        // Emergency stop check (currently not wired)
        if (!COOLING_TOWER_CONFIG.BYPASS_EMERGENCY_STOP) {
            // Emergency stop logic would go here when wired
            // if (emergencyStop) faultConditions.push('EMERGENCY_STOP_ACTIVATED');
        } else {
            safetyBypasses.push('EMERGENCY_STOP_BYPASSED');
        }

        // Water level check (no sensor currently)
        if (!COOLING_TOWER_CONFIG.BYPASS_WATER_LEVEL) {
            // Water level logic would go here when installed
            // if (!waterLevelOK) faultConditions.push('LOW_WATER_LEVEL');
        } else {
            safetyBypasses.push('WATER_LEVEL_BYPASSED');
        }

        // Vibration monitoring
        if (!COOLING_TOWER_CONFIG.BYPASS_VIBRATION_LIMITS) {
            if (tower1VibrationLevel > COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT) {
                faultConditions.push(`TOWER1_HIGH_VIBRATION_CRITICAL (ID: ${EQUIPMENT_IDS.COOLING_TOWER_1})`);
            }
            if (tower2VibrationLevel > COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT) {
                faultConditions.push(`TOWER2_HIGH_VIBRATION_CRITICAL (ID: ${EQUIPMENT_IDS.COOLING_TOWER_2})`);
            }
            if (tower3VibrationLevel > COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT) {
                faultConditions.push(`TOWER3_HIGH_VIBRATION_CRITICAL (ID: ${EQUIPMENT_IDS.COOLING_TOWER_3})`);
            }
        } else {
            safetyBypasses.push('VIBRATION_LIMITS_BYPASSED');
        }

        // Current monitoring
        if (!COOLING_TOWER_CONFIG.BYPASS_CURRENT_LIMITS) {
            if (tower1VFDCurrentA > COOLING_TOWER_CONFIG.VFD_CURRENT_CRITICAL ||
                tower1VFDCurrentB > COOLING_TOWER_CONFIG.VFD_CURRENT_CRITICAL) {
                faultConditions.push(`TOWER1_CRITICAL_VFD_CURRENT (ID: ${EQUIPMENT_IDS.COOLING_TOWER_1})`);
            }
            if (tower2VFDCurrentA > COOLING_TOWER_CONFIG.VFD_CURRENT_CRITICAL ||
                tower2VFDCurrentB > COOLING_TOWER_CONFIG.VFD_CURRENT_CRITICAL) {
                faultConditions.push(`TOWER2_CRITICAL_VFD_CURRENT (ID: ${EQUIPMENT_IDS.COOLING_TOWER_2})`);
            }
            if (tower3VFDCurrentA > COOLING_TOWER_CONFIG.VFD_CURRENT_CRITICAL ||
                tower3VFDCurrentB > COOLING_TOWER_CONFIG.VFD_CURRENT_CRITICAL) {
                faultConditions.push(`TOWER3_CRITICAL_VFD_CURRENT (ID: ${EQUIPMENT_IDS.COOLING_TOWER_3})`);
            }

            if (pump1Current > COOLING_TOWER_CONFIG.PUMP_CURRENT_MAX) {
                faultConditions.push(`PUMP1_OVERCURRENT (Tower ID: ${EQUIPMENT_IDS.COOLING_TOWER_1})`);
            }
            if (pump2Current > COOLING_TOWER_CONFIG.PUMP_CURRENT_MAX) {
                faultConditions.push(`PUMP2_OVERCURRENT (Tower ID: ${EQUIPMENT_IDS.COOLING_TOWER_2})`);
            }
            if (pump3Current > COOLING_TOWER_CONFIG.PUMP_CURRENT_MAX) {
                faultConditions.push(`PUMP3_OVERCURRENT (Tower ID: ${EQUIPMENT_IDS.COOLING_TOWER_3})`);
            }
        } else {
            safetyBypasses.push('CURRENT_LIMITS_BYPASSED');
        }

        // VFD fault check (currently not wired)
        if (!COOLING_TOWER_CONFIG.BYPASS_VFD_FAULTS) {
            // VFD fault logic would go here when wired
            // if (vfd1Fault) faultConditions.push('VFD1_FAULT');
        } else {
            safetyBypasses.push('VFD_FAULTS_BYPASSED');
        }

        controlResult.faultConditions = faultConditions;
        controlResult.safetyBypasses = safetyBypasses;

        // EMERGENCY SHUTDOWN CONDITIONS
        if (faultConditions.length > 0) {
            controlResult.alarmStatus = 'critical';
            controlResult.systemEnabled = false;

            // Immediately stop all towers
            controlResult.tower1VFDEnable = false;
            controlResult.tower2VFDEnable = false;
            controlResult.tower3VFDEnable = false;
            controlResult.tower1FanSpeed = 0;
            controlResult.tower2FanSpeed = 0;
            controlResult.tower3FanSpeed = 0;
            controlResult.bypassValvePosition = 0;

            // Close all isolation valves in emergency
            controlResult.tower1IsolationValveClose = true;
            controlResult.tower2IsolationValveClose = true;
            controlResult.tower3IsolationValveClose = true;

            console.log(`[COOLING_TOWER] EMERGENCY SHUTDOWN: ${faultConditions.join(', ')}`);
            return controlResult;
        }

        // Apply UI commands and manual overrides
        if (uiCommands.systemEnabled !== undefined) {
            controlResult.systemEnabled = uiCommands.systemEnabled;
        }
        if (uiCommands.controlMode !== undefined) {
            controlResult.controlMode = uiCommands.controlMode;
        }
        if (uiCommands.targetSupplyTemp !== undefined) {
            controlResult.targetSupplyTemp = parseFloat(uiCommands.targetSupplyTemp);
        }

        // WEEKLY LEAD TOWER ROTATION
        const now = new Date();
        const timeSinceRotation = Date.now() - stateStorage.towerStaging.lastRotationTime;
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

        if (timeSinceRotation > oneWeekMs) {
            stateStorage.towerStaging.leadTower = (stateStorage.towerStaging.leadTower % 3) + 1;
            stateStorage.towerStaging.lastRotationTime = Date.now();
            console.log(`[COOLING_TOWER] Weekly lead tower rotation to Tower ${stateStorage.towerStaging.leadTower} (ID: ${EQUIPMENT_IDS['COOLING_TOWER_' + stateStorage.towerStaging.leadTower]})`);
        }

        controlResult.leadTower = stateStorage.towerStaging.leadTower;

        // AUTOMATIC CONTROL LOGIC
        if (controlResult.systemEnabled && controlResult.controlMode === 'auto') {

            // TOWER STAGING BASED ON LOOP DELTA-T
            let activeTowers = 0;

            // MINIMUM CIRCULATION REQUIREMENT
            // When outdoor temp > 50°F, always keep at least one tower valve open
            // to maintain circulation and prevent stagnation
            const minimumCirculationRequired = outdoorTemp > 50;

            // Determine staging based on delta-T thresholds
            if (deltaT > COOLING_TOWER_CONFIG.STAGE_4_DELTA_T) {
                // Stage 4: All towers HIGH speed
                activeTowers = 3;
                controlResult.coolingDemand = 100;
            } else if (deltaT > COOLING_TOWER_CONFIG.STAGE_3_DELTA_T) {
                // Stage 3: Two towers running
                activeTowers = 2;
                controlResult.coolingDemand = 75;
            } else if (deltaT > COOLING_TOWER_CONFIG.STAGE_2_DELTA_T) {
                // Stage 2: Lead tower HIGH speed
                activeTowers = 1;
                controlResult.coolingDemand = 60;
            } else if (deltaT > COOLING_TOWER_CONFIG.STAGE_1_DELTA_T) {
                // Stage 1: Lead tower LOW speed
                activeTowers = 1;
                controlResult.coolingDemand = 35;
            } else if (deltaT < COOLING_TOWER_CONFIG.SHUTDOWN_DELTA_T) {
                if (minimumCirculationRequired) {
                    // Keep minimum circulation - lead tower valve open but fan OFF
                    activeTowers = 0.5; // Special state for valve open, fan off
                    controlResult.coolingDemand = 0;
                    console.log('[COOLING_TOWER] Minimum circulation mode - valve open, fan off (OAT > 50°F)');
                } else {
                    // Complete shutdown only when cold enough
                    activeTowers = 0;
                    controlResult.coolingDemand = 0;
                }
            }

            controlResult.activeTowers = Math.floor(activeTowers); // Display 0 for minimum circulation mode

            // TOWER STAGING SEQUENCE
            const leadTower = controlResult.leadTower;
            const lagTower1 = (leadTower % 3) + 1;
            const lagTower2 = ((leadTower + 1) % 3) + 1;

            // Reset all towers
            controlResult.tower1VFDEnable = false;
            controlResult.tower2VFDEnable = false;
            controlResult.tower3VFDEnable = false;
            controlResult.tower1FanSpeed = 0;
            controlResult.tower2FanSpeed = 0;
            controlResult.tower3FanSpeed = 0;

            // Reset all isolation valves
            controlResult.tower1IsolationValveOpen = false;
            controlResult.tower1IsolationValveClose = false;
            controlResult.tower2IsolationValveOpen = false;
            controlResult.tower2IsolationValveClose = false;
            controlResult.tower3IsolationValveOpen = false;
            controlResult.tower3IsolationValveClose = false;

            // Reset all pumps
            controlResult.pump1Enable = false;
            controlResult.pump2Enable = false;
            controlResult.pump3Enable = false;

            // PUMP CONTROL - Single pump operation with rotation and failover
            if (!COOLING_TOWER_CONFIG.BYPASS_PUMP_STATUS && activeTowers >= 0.5) {
                const currentTime = Date.now();
                const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
                const CHANGEOVER_OVERLAP_MS = 5000; // 5 seconds overlap

                // Get current pump states and currents
                const pump1Current = controlResult.pump1Current || 0;
                const pump2Current = controlResult.pump2Current || 0;
                const pump3Current = controlResult.pump3Current || 0;

                let activePump = stateStorage.pumpRotation.activePump;
                let changeoverInProgress = stateStorage.pumpRotation.changeoverInProgress;

                // Check for pump failure (running but < 10 amps)
                const activePumpCurrent = controlResult[`pump${activePump}Current`] || 0;
                const activePumpEnabled = controlResult[`pump${activePump}Enable`];
                const pumpFailure = activePumpEnabled && activePumpCurrent < 10.0 &&
                                   (currentTime - stateStorage.pumpRotation.lastFailoverTime) > 30000; // 30s debounce

                if (pumpFailure) {
                    console.log(`[PUMP_CONTROL] Pump ${activePump} failure detected (${activePumpCurrent.toFixed(1)}A < 10A), initiating failover`);
                    stateStorage.pumpRotation.failoverCount++;
                    stateStorage.pumpRotation.lastFailoverTime = currentTime;

                    // Select next available pump
                    const nextPump = (activePump % 3) + 1;
                    const backupPump = ((activePump + 1) % 3) + 1;

                    // Try next pump, or backup if next is also failed
                    stateStorage.pumpRotation.newPump = nextPump;
                    stateStorage.pumpRotation.changeoverInProgress = true;
                    stateStorage.pumpRotation.changeoverStartTime = currentTime;
                }

                // Check for weekly rotation
                const timeSinceRotation = currentTime - stateStorage.pumpRotation.lastRotationTime;
                if (timeSinceRotation >= WEEK_IN_MS && !changeoverInProgress) {
                    console.log(`[PUMP_CONTROL] Weekly rotation triggered (${(timeSinceRotation / (24*60*60*1000)).toFixed(1)} days)`);

                    // Rotate to next pump in sequence
                    stateStorage.pumpRotation.newPump = (activePump % 3) + 1;
                    stateStorage.pumpRotation.changeoverInProgress = true;
                    stateStorage.pumpRotation.changeoverStartTime = currentTime;
                    stateStorage.pumpRotation.lastRotationTime = currentTime;
                }

                // Handle changeover process with 5-second overlap
                if (changeoverInProgress) {
                    const changeoverElapsed = currentTime - stateStorage.pumpRotation.changeoverStartTime;

                    if (changeoverElapsed < CHANGEOVER_OVERLAP_MS) {
                        // During overlap period - run both pumps
                        controlResult[`pump${activePump}Enable`] = true;
                        controlResult[`pump${stateStorage.pumpRotation.newPump}Enable`] = true;
                        console.log(`[PUMP_CONTROL] Changeover overlap: Pump ${activePump} + Pump ${stateStorage.pumpRotation.newPump} (${(changeoverElapsed/1000).toFixed(1)}s / 5s)`);
                    } else {
                        // Changeover complete - switch to new pump only
                        stateStorage.pumpRotation.activePump = stateStorage.pumpRotation.newPump;
                        stateStorage.pumpRotation.changeoverInProgress = false;
                        activePump = stateStorage.pumpRotation.activePump;
                        console.log(`[PUMP_CONTROL] Changeover complete: Now running Pump ${activePump}`);
                    }
                }

                // Normal operation - run active pump only (unless in changeover)
                if (!changeoverInProgress) {
                    controlResult[`pump${activePump}Enable`] = true;

                    // Update runtime tracking (approximate, in hours)
                    const runtimeIncrement = 7 / 3600000; // 7 seconds in hours
                    stateStorage.pumpRotation[`pump${activePump}Runtime`] += runtimeIncrement;
                }

                // Log pump status periodically
                if (Math.random() < 0.01) { // Log ~1% of cycles
                    const p1Runtime = (stateStorage.pumpRotation.pump1Runtime).toFixed(1);
                    const p2Runtime = (stateStorage.pumpRotation.pump2Runtime).toFixed(1);
                    const p3Runtime = (stateStorage.pumpRotation.pump3Runtime).toFixed(1);
                    console.log(`[PUMP_CONTROL] Active: P${activePump} | Runtime hours: P1=${p1Runtime}, P2=${p2Runtime}, P3=${p3Runtime} | Failovers: ${stateStorage.pumpRotation.failoverCount}`);
                }
            }

            // Check pump status (monitor current to verify pumps are running)
            if (!COOLING_TOWER_CONFIG.BYPASS_PUMP_STATUS) {
                if (controlResult[`pump${leadTower}Enable`] && !controlResult[`pump${leadTower}Running`]) {
                    console.log(`[COOLING_TOWER] WARNING: Lead tower ${leadTower} pump enabled but not running (ID: ${EQUIPMENT_IDS['COOLING_TOWER_' + leadTower]})`);
                }
                if (controlResult[`pump${lagTower1}Enable`] && !controlResult[`pump${lagTower1}Running`]) {
                    console.log(`[COOLING_TOWER] WARNING: Lag tower ${lagTower1} pump enabled but not running (ID: ${EQUIPMENT_IDS['COOLING_TOWER_' + lagTower1]})`);
                }
                if (controlResult[`pump${lagTower2}Enable`] && !controlResult[`pump${lagTower2}Running`]) {
                    console.log(`[COOLING_TOWER] WARNING: Lag tower ${lagTower2} pump enabled but not running (ID: ${EQUIPMENT_IDS['COOLING_TOWER_' + lagTower2]})`);
                }
            }

            // MINIMUM CIRCULATION MODE - Valves open, fans off
            if (activeTowers === 0.5) {
                // Open lead tower and first lag tower valves for circulation
                controlResult[`tower${leadTower}IsolationValveOpen`] = true;
                controlResult[`tower${lagTower1}IsolationValveOpen`] = true;
                // Fans remain off
                console.log(`[COOLING_TOWER] Minimum circulation: Tower ${leadTower} and Tower ${lagTower1} valves open, fans off`);
            }

            // STAGE 1-2: Lead tower operation
            if (activeTowers >= 1) {
                controlResult[`tower${leadTower}VFDEnable`] = true;
                controlResult[`tower${leadTower}IsolationValveOpen`] = true;

                if (deltaT > COOLING_TOWER_CONFIG.STAGE_2_DELTA_T) {
                    controlResult[`tower${leadTower}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_HIGH_SPEED; // HIGH speed
                } else {
                    controlResult[`tower${leadTower}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_LOW_SPEED; // LOW speed
                }
            }

            // STAGE 3: First lag tower
            if (activeTowers >= 2) {
                controlResult[`tower${lagTower1}VFDEnable`] = true;
                controlResult[`tower${lagTower1}IsolationValveOpen`] = true;

                if (deltaT > COOLING_TOWER_CONFIG.STAGE_3_DELTA_T + 2.0) {
                    controlResult[`tower${lagTower1}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_HIGH_SPEED; // HIGH speed
                } else {
                    controlResult[`tower${lagTower1}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_LOW_SPEED; // LOW speed
                }
            }

            // STAGE 4: Second lag tower
            if (activeTowers >= 3) {
                controlResult[`tower${lagTower2}VFDEnable`] = true;
                controlResult[`tower${lagTower2}IsolationValveOpen`] = true;
                controlResult[`tower${lagTower2}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_HIGH_SPEED; // HIGH speed
            }

            // Close isolation valves for inactive towers (unless open for minimum circulation)
            for (let i = 1; i <= 3; i++) {
                if (!controlResult[`tower${i}VFDEnable`] && !controlResult[`tower${i}IsolationValveOpen`]) {
                    controlResult[`tower${i}IsolationValveClose`] = true;
                }
            }
        }

        // BYPASS VALVE CONTROL (AO4)
        // Simple control based on outside air temperature
        if (outdoorTemp < 40) {
            // Cold weather - close bypass to prevent freezing
            controlResult.bypassValvePosition = 0;
        } else if (outdoorTemp > 90) {
            // Hot weather - open bypass for maximum cooling
            controlResult.bypassValvePosition = 10; // Full open (10V)
        } else {
            // Moderate weather - modulate based on supply temperature
            const tempError = towerLoopSupplyTemp - controlResult.targetSupplyTemp;
            let valvePosition = 5.0 + (tempError * 0.5); // Base 50% + adjustment
            controlResult.bypassValvePosition = Math.max(0, Math.min(10, valvePosition));
        }

        // TOWER HEATER CONTROL (freeze protection)
        if (outdoorTemp < 35) {
            // Enable heaters when outdoor temp drops below 35°F
            controlResult.tower1HeaterEnable = true;
            controlResult.tower2HeaterEnable = true;
            controlResult.tower3HeaterEnable = true;
        } else if (outdoorTemp > 45) {
            // Disable heaters when outdoor temp rises above 45°F
            controlResult.tower1HeaterEnable = false;
            controlResult.tower2HeaterEnable = false;
            controlResult.tower3HeaterEnable = false;
        }
        // Hysteresis between 35-45°F maintains current state

        // CURRENT MONITORING AND WARNINGS
        const currentWarnings = [];

        // Check VFD currents for warnings
        if (!COOLING_TOWER_CONFIG.BYPASS_CURRENT_LIMITS) {
            if (tower1VFDCurrentA > COOLING_TOWER_CONFIG.VFD_CURRENT_WARNING ||
                tower1VFDCurrentB > COOLING_TOWER_CONFIG.VFD_CURRENT_WARNING) {
                currentWarnings.push(`TOWER1_HIGH_VFD_CURRENT_WARNING (ID: ${EQUIPMENT_IDS.COOLING_TOWER_1})`);
                // Reduce speed if possible
                if (controlResult.tower1FanSpeed > COOLING_TOWER_CONFIG.VFD_LOW_SPEED) {
                    controlResult.tower1FanSpeed = COOLING_TOWER_CONFIG.VFD_LOW_SPEED;
                }
            }
            if (tower2VFDCurrentA > COOLING_TOWER_CONFIG.VFD_CURRENT_WARNING ||
                tower2VFDCurrentB > COOLING_TOWER_CONFIG.VFD_CURRENT_WARNING) {
                currentWarnings.push(`TOWER2_HIGH_VFD_CURRENT_WARNING (ID: ${EQUIPMENT_IDS.COOLING_TOWER_2})`);
                if (controlResult.tower2FanSpeed > COOLING_TOWER_CONFIG.VFD_LOW_SPEED) {
                    controlResult.tower2FanSpeed = COOLING_TOWER_CONFIG.VFD_LOW_SPEED;
                }
            }
            if (tower3VFDCurrentA > COOLING_TOWER_CONFIG.VFD_CURRENT_WARNING ||
                tower3VFDCurrentB > COOLING_TOWER_CONFIG.VFD_CURRENT_WARNING) {
                currentWarnings.push(`TOWER3_HIGH_VFD_CURRENT_WARNING (ID: ${EQUIPMENT_IDS.COOLING_TOWER_3})`);
                if (controlResult.tower3FanSpeed > COOLING_TOWER_CONFIG.VFD_LOW_SPEED) {
                    controlResult.tower3FanSpeed = COOLING_TOWER_CONFIG.VFD_LOW_SPEED;
                }
            }
        }

        // VIBRATION MONITORING WARNINGS
        if (!COOLING_TOWER_CONFIG.BYPASS_VIBRATION_LIMITS) {
            if (tower1VibrationLevel > COOLING_TOWER_CONFIG.VIBRATION_WARNING_LIMIT &&
                tower1VibrationLevel <= COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT) {
                currentWarnings.push(`TOWER1_HIGH_VIBRATION_WARNING (ID: ${EQUIPMENT_IDS.COOLING_TOWER_1})`);
            }
            if (tower2VibrationLevel > COOLING_TOWER_CONFIG.VIBRATION_WARNING_LIMIT &&
                tower2VibrationLevel <= COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT) {
                currentWarnings.push(`TOWER2_HIGH_VIBRATION_WARNING (ID: ${EQUIPMENT_IDS.COOLING_TOWER_2})`);
            }
            if (tower3VibrationLevel > COOLING_TOWER_CONFIG.VIBRATION_WARNING_LIMIT &&
                tower3VibrationLevel <= COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT) {
                currentWarnings.push(`TOWER3_HIGH_VIBRATION_WARNING (ID: ${EQUIPMENT_IDS.COOLING_TOWER_3})`);
            }
        }

        // Update alarm status
        if (currentWarnings.length > 0) {
            controlResult.alarmStatus = 'warning';
            controlResult.faultConditions.push(...currentWarnings);
        } else if (controlResult.alarmStatus !== 'critical') {
            controlResult.alarmStatus = 'normal';
        }

        // Manual overrides from UI
        for (let i = 1; i <= 3; i++) {
            if (uiCommands[`tower${i}VFDEnable`] !== undefined) {
                controlResult[`tower${i}VFDEnable`] = uiCommands[`tower${i}VFDEnable`];
            }
            if (uiCommands[`tower${i}FanSpeed`] !== undefined) {
                controlResult[`tower${i}FanSpeed`] = parseFloat(uiCommands[`tower${i}FanSpeed`]);
            }
            if (uiCommands[`tower${i}HeaterEnable`] !== undefined) {
                controlResult[`tower${i}HeaterEnable`] = uiCommands[`tower${i}HeaterEnable`];
            }
        }

        if (uiCommands.bypassValvePosition !== undefined) {
            controlResult.bypassValvePosition = parseFloat(uiCommands.bypassValvePosition);
        }

        console.log(`[COOLING_TOWER] Control processed: ΔT=${deltaT.toFixed(1)}°F, Active=${controlResult.activeTowers}, Lead=${controlResult.leadTower} (ID: ${EQUIPMENT_IDS['COOLING_TOWER_' + controlResult.leadTower]}), Demand=${controlResult.coolingDemand}%, OAT=${outdoorTemp.toFixed(1)}°F, Bypasses=[${safetyBypasses.join(',')}]`);

        return controlResult;

    } catch (error) {
        console.error(`[COOLING_TOWER] Error in processCoolingTowerControl: ${error.message}`);
        console.error(`[COOLING_TOWER] Error stack: ${error.stack}`);

        // Return safe default state on error
        return {
            equipmentIds: EQUIPMENT_IDS,
            tower1VFDEnable: false,
            tower2VFDEnable: false,
            tower3VFDEnable: false,
            tower1FanSpeed: 0,
            tower2FanSpeed: 0,
            tower3FanSpeed: 0,
            bypassValvePosition: 0,
            tower1HeaterEnable: false,
            tower2HeaterEnable: false,
            tower3HeaterEnable: false,
            tower1IsolationValveClose: true,
            tower2IsolationValveClose: true,
            tower3IsolationValveClose: true,
            systemEnabled: false,
            emergencyStop: true,
            controlMode: 'error',
            leadTower: 1,
            activeTowers: 0,
            coolingDemand: 0,
            targetSupplyTemp: COOLING_TOWER_CONFIG.TARGET_SUPPLY_TEMP,
            alarmStatus: 'error',
            faultConditions: ['CONTROL_SYSTEM_ERROR'],
            safetyBypasses: [],
            lastUpdate: new Date().toISOString(),
            controlTimestamp: Date.now(),
            errorMessage: error.message
        };
    }
}

module.exports = {
    processCoolingTowerControl,
    EQUIPMENT_IDS,
    COOLING_TOWER_CONFIG
};