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
    TOWER_3_AVAILABLE: false,            // Tower 3 DOWN FOR REPAIR - set to false for maintenance
    PUMP_1_AVAILABLE: true,              // Pump 1 available for operation
    PUMP_2_AVAILABLE: true,              // Pump 2 available for operation
    PUMP_3_AVAILABLE: true,              // Pump 3 available for operation

    // Control parameters
    LEAD_TOWER_ROTATION: 'weekly',       // Weekly lead tower rotation
    TARGET_SUPPLY_TEMP: 75.0,           // Default setpoint if database unavailable
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
    STAGE_1_DELTA_T: 10.0,              // Start lead tower at 10°F deltaT
    STAGE_2_DELTA_T: 20.0,              // Add lag tower 1 at 20°F deltaT
    STAGE_3_DELTA_T: 30.0,              // Add lag tower 2 at 30°F deltaT
    STAGE_4_DELTA_T: 35.0,              // All towers high speed at 35°F deltaT
    SHUTDOWN_DELTA_T: 10.0,             // Shutdown at 10°F below setpoint

    // VFD speed references (0-10V) - Now using PID control
    VFD_MIN_SPEED: 2.6,                 // ~26Hz (2.6V) - Minimum run speed
    VFD_MAX_SPEED: 4.8,                 // ~48Hz (4.8V) - Maximum speed for PID
    VFD_LOW_SPEED: 3.5,                 // Legacy - for manual override only
    VFD_MED_LOW_SPEED: 4.0,             // Legacy - for manual override only
    VFD_MED_SPEED: 4.3,                 // Legacy - for manual override only
    VFD_MED_HIGH_SPEED: 4.6,            // Legacy - for manual override only
    VFD_HIGH_SPEED: 4.8,                // Updated to match PID max

    // Timing delays (milliseconds)
    PUMP_START_DELAY: 10000,            // 10 seconds
    VALVE_OPEN_DELAY: 15000,            // 15 seconds
    FAN_START_DELAY: 30000,             // 30 seconds after pump
    VFD_RAMP_STEP_DELAY: 15000,         // 15 seconds between speed changes
    VFD_RAMP_DOWN_DELAY: 20000,         // 20 seconds for ramp down steps
};

// Import PID controller if available
let pidControllerImproved;
try {
    pidControllerImproved = require('../../src/services/pid-controller').pidControllerImproved;
} catch (e) {
    console.log('[COOLING_TOWER] PID controller not available, using fallback control');
}

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
                stagingTimers: {},
                vfdRampTimers: {}  // Track VFD ramping
            };
        }

        // Initialize valve PID state if needed
        if (!stateStorage.valvePidState) {
            stateStorage.valvePidState = {
                integral: 0,
                previousError: 0,
                lastOutput: 6.0  // Start at middle of 2-10V range
            };
        }

        // Initialize tower VFD PID states
        if (!stateStorage.tower1PidState) {
            stateStorage.tower1PidState = {
                integral: 0,
                previousError: 0,
                lastOutput: COOLING_TOWER_CONFIG.VFD_MIN_SPEED
            };
        }
        if (!stateStorage.tower2PidState) {
            stateStorage.tower2PidState = {
                integral: 0,
                previousError: 0,
                lastOutput: COOLING_TOWER_CONFIG.VFD_MIN_SPEED
            };
        }
        if (!stateStorage.tower3PidState) {
            stateStorage.tower3PidState = {
                integral: 0,
                previousError: 0,
                lastOutput: COOLING_TOWER_CONFIG.VFD_MIN_SPEED
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
            temperingValvePosition: 0,   // CH4: 0-10V tempering valve control (16-relay board)

            // 16 Relay Board Outputs
            pump1Enable: false,          // CH1 - Pump 1 Enable
            pump2Enable: false,          // CH2 - Pump 2 Enable
            pump3Enable: false,          // CH3 - Pump 3 Enable

            // Isolation Valve Controls (corrected channel assignments)
            tower3IsolationValveClose: false,   // CH7 - Tower 3 Iso Valve Close
            tower3IsolationValveOpen: false,    // CH8 - Tower 3 Iso Valve Open
            tower2IsolationValveClose: false,   // CH9 - Tower 2 Iso Valve Close
            tower2IsolationValveOpen: false,    // CH10 - Tower 2 Iso Valve Open
            tower1IsolationValveClose: false,   // CH11 - Tower 1 Iso Valve Close
            tower1IsolationValveOpen: false,    // CH12 - Tower 1 Iso Valve Open

            // Heater Controls
            tower3HeaterEnable: false,   // CH14 - Tower 3 Heater Enable
            tower2HeaterEnable: false,   // CH15 - Tower 2 Heater Enable
            tower1HeaterEnable: false,   // CH16 - Tower 1 Heater Enable

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

        // Extract current readings from Building Automation HAT (already converted to amps)
        const tower1VFDCurrentA = parseFloat(data.AI1 || 0); // Already in amps
        const tower1VFDCurrentB = parseFloat(data.AI2 || 0);
        const tower2VFDCurrentA = parseFloat(data.AI3 || 0);
        const tower2VFDCurrentB = parseFloat(data.AI4 || 0);
        const tower3VFDCurrentA = parseFloat(data.AI5 || 0);
        const tower3VFDCurrentB = parseFloat(data.AI6 || 0);

        // Extract pump currents from 16 Relay Board (already converted to amps)
        // Updated to match actual board configuration:
        // CH8 = Pump 1, CH5 = Pump 2, CH6 = Pump 3
        const pump1Current = parseFloat(data.CH8 || 0); // Already in amps
        const pump2Current = parseFloat(data.CH5 || 0);
        const pump3Current = parseFloat(data.CH6 || 0);

        // Extract temperatures from 16 Relay Board (10K NTC thermistors)
        // SANITY CHECK: Reject obviously bad readings and use last known good value
        let towerLoopSupplyTemp = parseFloat(data.CH1 || 85);
        let towerLoopReturnTemp = parseFloat(data.CH2 || 95);
        let heatPumpReturnTemp = parseFloat(data.CH9 || 85);
        let heatPumpSupplyTemp = parseFloat(data.CH10 || 75);

        // Initialize last known good values if not present
        if (!stateStorage.lastGoodTemps) {
            stateStorage.lastGoodTemps = {
                towerSupply: 85,
                towerReturn: 95,
                hpReturn: 85,
                hpSupply: 75
            };
        }

        // Sanity check each temperature (reasonable range 40-120°F for cooling towers)
        if (towerLoopSupplyTemp < 40 || towerLoopSupplyTemp > 120) {
            console.log(`[TEMP_SANITY] Bad tower supply reading: ${towerLoopSupplyTemp}°F - using last good: ${stateStorage.lastGoodTemps.towerSupply}°F`);
            towerLoopSupplyTemp = stateStorage.lastGoodTemps.towerSupply;
        } else {
            stateStorage.lastGoodTemps.towerSupply = towerLoopSupplyTemp;
        }

        if (towerLoopReturnTemp < 40 || towerLoopReturnTemp > 120) {
            console.log(`[TEMP_SANITY] Bad tower return reading: ${towerLoopReturnTemp}°F - using last good: ${stateStorage.lastGoodTemps.towerReturn}°F`);
            towerLoopReturnTemp = stateStorage.lastGoodTemps.towerReturn;
        } else {
            stateStorage.lastGoodTemps.towerReturn = towerLoopReturnTemp;
        }

        if (heatPumpReturnTemp < 40 || heatPumpReturnTemp > 120) {
            console.log(`[TEMP_SANITY] Bad HP return reading: ${heatPumpReturnTemp}°F - using last good: ${stateStorage.lastGoodTemps.hpReturn}°F`);
            heatPumpReturnTemp = stateStorage.lastGoodTemps.hpReturn;
        } else {
            stateStorage.lastGoodTemps.hpReturn = heatPumpReturnTemp;
        }

        if (heatPumpSupplyTemp < 40 || heatPumpSupplyTemp > 120) {
            console.log(`[TEMP_SANITY] Bad HP supply reading: ${heatPumpSupplyTemp}°F - using last good: ${stateStorage.lastGoodTemps.hpSupply}°F`);
            heatPumpSupplyTemp = stateStorage.lastGoodTemps.hpSupply;
        } else {
            stateStorage.lastGoodTemps.hpSupply = heatPumpSupplyTemp;
        }

        // Outdoor temp comes from weather database, not a physical sensor
        const outdoorTemp = parseFloat(data.outdoorTemp || 75);

        // Get the user's setpoint from database (passed in data)
        // The logic executor should pass this from the database
        const targetSetpoint = parseFloat(data.userSetpoint || uiCommands.targetSupplyTemp || 75);

        // Calculate delta-T: HP Loop Supply Temp minus User Setpoint
        // This tells us how far above setpoint we are (positive = need cooling)
        const deltaT = heatPumpSupplyTemp - targetSetpoint;

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
        controlResult.targetSupplyTemp = targetSetpoint;

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
        // targetSupplyTemp is now set earlier from database/UI/default

        // WEEKLY LEAD TOWER ROTATION
        const now = new Date();
        const timeSinceRotation = Date.now() - stateStorage.towerStaging.lastRotationTime;
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

        if (timeSinceRotation > oneWeekMs) {
            // Find next available tower for rotation
            let nextTower = stateStorage.towerStaging.leadTower;
            let attempts = 0;
            do {
                nextTower = (nextTower % 3) + 1;
                attempts++;
            } while (!COOLING_TOWER_CONFIG[`TOWER_${nextTower}_AVAILABLE`] && attempts < 3);

            if (COOLING_TOWER_CONFIG[`TOWER_${nextTower}_AVAILABLE`]) {
                stateStorage.towerStaging.leadTower = nextTower;
                stateStorage.towerStaging.lastRotationTime = Date.now();
                console.log(`[COOLING_TOWER] Weekly lead tower rotation to Tower ${stateStorage.towerStaging.leadTower} (ID: ${EQUIPMENT_IDS['COOLING_TOWER_' + stateStorage.towerStaging.leadTower]})`);
            } else {
                console.log(`[COOLING_TOWER] Cannot rotate - no available towers`);
            }
        }

        controlResult.leadTower = stateStorage.towerStaging.leadTower;

        // Initialize flags to track which towers are blocked by minimum OFF time
        // This needs to be outside the auto control block so it's available for runtime enforcement
        const towersBlockedByOffTime = {};

        // Check OFF time status for ALL towers - this must happen regardless of control mode
        // to ensure proper cycling protection
        for (let i = 1; i <= 3; i++) {
            const shutdownKey = `tower${i}ShutdownTime`;
            if (stateStorage[shutdownKey]) {
                const timeSinceShutdown = (Date.now() - stateStorage[shutdownKey]) / 1000;
                if (timeSinceShutdown < 180) {
                    towersBlockedByOffTime[i] = true;
                    console.log(`[COOLING_TOWER] Tower ${i} in OFF time cooldown: ${(180 - timeSinceShutdown).toFixed(0)}s remaining`);
                }
            }
        }

        // AUTOMATIC CONTROL LOGIC
        if (controlResult.systemEnabled && controlResult.controlMode === 'auto') {

            // TOWER STAGING BASED ON LOOP DELTA-T
            let activeTowers = 0;

            // MINIMUM CIRCULATION REQUIREMENT
            // When outdoor temp > 50°F, always keep at least one tower valve open
            // to maintain circulation and prevent stagnation
            const minimumCirculationRequired = outdoorTemp > 50;

            // Determine staging based on delta-T thresholds
            // CRITICAL: Tower only starts when 10°F ABOVE setpoint
            // Once started, it tries to maintain setpoint

            // Check if any tower is currently running (check actual hardware state)
            const anyTowerRunning = controlResult.tower1VFDEnable || controlResult.tower2VFDEnable || controlResult.tower3VFDEnable ||
                                   (stateStorage.tower1StartupTime || stateStorage.tower2StartupTime || stateStorage.tower3StartupTime);

            // SHUTDOWN CONDITIONS - Only shut off if one of these critical conditions is met
            // Temperature sanity checking already done above, so these are valid readings
            if (deltaT < -15 || heatPumpSupplyTemp < 65 || towerLoopSupplyTemp < 50) {
                // Critical shutdown conditions met
                activeTowers = 0;
                controlResult.coolingDemand = 0;
                if (deltaT < -15) {
                    console.log(`[COOLING_TOWER] SHUTDOWN: DeltaT ${deltaT.toFixed(1)}°F is below -15°F threshold`);
                } else if (heatPumpSupplyTemp < 65) {
                    console.log(`[COOLING_TOWER] SHUTDOWN: HP Supply ${heatPumpSupplyTemp.toFixed(1)}°F is below 65°F minimum`);
                } else if (towerLoopSupplyTemp < 50) {
                    console.log(`[COOLING_TOWER] SHUTDOWN: Tower Supply ${towerLoopSupplyTemp.toFixed(1)}°F is below 50°F minimum`);
                }
            } else if (anyTowerRunning) {
                // Tower is running and no shutdown conditions met - KEEP RUNNING
                activeTowers = 1; // At minimum keep one tower running
                controlResult.coolingDemand = 28; // Minimum speed
                console.log(`[COOLING_TOWER] Continuing operation - deltaT=${deltaT.toFixed(1)}°F, HP=${heatPumpSupplyTemp.toFixed(1)}°F, Tower=${towerLoopSupplyTemp.toFixed(1)}°F`);
            } else if (deltaT < COOLING_TOWER_CONFIG.STAGE_1_DELTA_T) {
                // No towers running and below start threshold - stay OFF
                activeTowers = 0;
                controlResult.coolingDemand = 0;
                console.log(`[COOLING_TOWER] Below start threshold - deltaT=${deltaT.toFixed(1)}°F < ${COOLING_TOWER_CONFIG.STAGE_1_DELTA_T}°F, towers OFF`);
            } else if (deltaT >= COOLING_TOWER_CONFIG.STAGE_4_DELTA_T) {
                // Stage 4: 35°F+ above setpoint - All towers HIGH speed
                activeTowers = 3;
                controlResult.coolingDemand = 100;
                console.log(`[COOLING_TOWER] Stage 4 - deltaT=${deltaT.toFixed(1)}°F, 3 towers at high speed`);
            } else if (deltaT >= COOLING_TOWER_CONFIG.STAGE_3_DELTA_T) {
                // Stage 3: 30°F+ above setpoint - Add lag tower 2
                activeTowers = 3;
                controlResult.coolingDemand = 75;
                console.log(`[COOLING_TOWER] Stage 3 - deltaT=${deltaT.toFixed(1)}°F, 3 towers running`);
            } else if (deltaT >= COOLING_TOWER_CONFIG.STAGE_2_DELTA_T) {
                // Stage 2: 20°F+ above setpoint - Add lag tower 1
                activeTowers = 2;
                controlResult.coolingDemand = 60;
                console.log(`[COOLING_TOWER] Stage 2 - deltaT=${deltaT.toFixed(1)}°F, 2 towers running`);
            } else if (deltaT >= COOLING_TOWER_CONFIG.STAGE_1_DELTA_T) {
                // Stage 1: 10°F+ above setpoint - start cooling
                activeTowers = 1;
                // Adjust speed based on how far from setpoint
                if (deltaT > 15) {
                    controlResult.coolingDemand = 50; // Moderate speed
                } else if (deltaT > 10) {
                    controlResult.coolingDemand = 35; // Low speed
                } else {
                    controlResult.coolingDemand = 28; // Minimum speed
                }
                console.log(`[COOLING_TOWER] Stage 1 - deltaT=${deltaT.toFixed(1)}°F, lead tower at ${controlResult.coolingDemand}% demand`);
            }

            controlResult.activeTowers = Math.floor(activeTowers); // Display 0 for minimum circulation mode

            // Debug tower assignments
            console.log(`[TOWER_DEBUG] deltaT=${deltaT.toFixed(1)}°F, activeTowers=${activeTowers}, lead=${controlResult.leadTower}, lag1=${(controlResult.leadTower % 3) + 1}, lag2=${((controlResult.leadTower + 1) % 3) + 1}`);

            // TOWER STAGING SEQUENCE
            const leadTower = controlResult.leadTower;
            const lagTower1 = (leadTower % 3) + 1;
            const lagTower2 = ((leadTower + 1) % 3) + 1;

            // CRITICAL FIX: Check minimum OFF time before allowing restart
            // THEN Initialize startup timers IMMEDIATELY when towers should be enabled
            if (activeTowers >= 1 && COOLING_TOWER_CONFIG[`TOWER_${leadTower}_AVAILABLE`]) {
                // Check if tower is blocked by OFF time
                if (towersBlockedByOffTime[leadTower]) {
                    activeTowers = 0; // Prevent tower from starting
                    console.log(`[COOLING_TOWER] Tower ${leadTower} BLOCKED - still in 3-minute OFF time cooldown`);
                } else {
                    // Tower can start - initialize startup timer if needed
                    const startupKey = `tower${leadTower}StartupTime`;
                    const shutdownKey = `tower${leadTower}ShutdownTime`;
                    if (!stateStorage[startupKey]) {
                        stateStorage[startupKey] = Date.now();
                        delete stateStorage[shutdownKey]; // Clear shutdown timer when starting
                        console.log(`[STARTUP_TIMER] Tower ${leadTower} INITIALIZED - 7-minute minimum runtime started`);
                    }
                }
            }
            if (activeTowers >= 2 && COOLING_TOWER_CONFIG[`TOWER_${lagTower1}_AVAILABLE`]) {
                // Check if tower is blocked by OFF time
                if (towersBlockedByOffTime[lagTower1]) {
                    activeTowers = Math.min(activeTowers, 1); // Limit to 1 tower
                    console.log(`[COOLING_TOWER] Tower ${lagTower1} BLOCKED - still in 3-minute OFF time cooldown`);
                } else {
                    // Tower can start - initialize startup timer if needed
                    const startupKey = `tower${lagTower1}StartupTime`;
                    const shutdownKey = `tower${lagTower1}ShutdownTime`;
                    if (!stateStorage[startupKey]) {
                        stateStorage[startupKey] = Date.now();
                        delete stateStorage[shutdownKey];
                        console.log(`[STARTUP_TIMER] Tower ${lagTower1} INITIALIZED - 7-minute minimum runtime started`);
                    }
                }
            }
            if (activeTowers >= 3 && COOLING_TOWER_CONFIG[`TOWER_${lagTower2}_AVAILABLE`]) {
                // Check if tower is blocked by OFF time
                if (towersBlockedByOffTime[lagTower2]) {
                    activeTowers = Math.min(activeTowers, 2); // Limit to 2 towers
                    console.log(`[COOLING_TOWER] Tower ${lagTower2} BLOCKED - still in 3-minute OFF time cooldown`);
                } else {
                    // Tower can start - initialize startup timer if needed
                    const startupKey = `tower${lagTower2}StartupTime`;
                    const shutdownKey = `tower${lagTower2}ShutdownTime`;
                    if (!stateStorage[startupKey]) {
                        stateStorage[startupKey] = Date.now();
                        delete stateStorage[shutdownKey];
                        console.log(`[STARTUP_TIMER] Tower ${lagTower2} INITIALIZED - 7-minute minimum runtime started`);
                    }
                }
            }

            // Reset all towers
            controlResult.tower1VFDEnable = false;
            controlResult.tower2VFDEnable = false;
            controlResult.tower3VFDEnable = false;
            controlResult.tower1FanSpeed = 0;
            controlResult.tower2FanSpeed = 0;
            controlResult.tower3FanSpeed = 0;

            // Reset all pumps
            controlResult.pump1Enable = false;
            controlResult.pump2Enable = false;
            controlResult.pump3Enable = false;

            // Reset all isolation valves
            controlResult.tower1IsolationValveOpen = false;
            controlResult.tower1IsolationValveClose = false;
            controlResult.tower2IsolationValveOpen = false;
            controlResult.tower2IsolationValveClose = false;
            controlResult.tower3IsolationValveOpen = false;
            controlResult.tower3IsolationValveClose = false;

            // PUMP CONTROL - Single pump operation with rotation and failover
            // CRITICAL: Always run at least one pump for circulation, even when no towers are cooling
            if (!COOLING_TOWER_CONFIG.BYPASS_PUMP_STATUS) {
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

                    // Find next available pump
                    let nextPump = activePump;
                    let attempts = 0;
                    do {
                        nextPump = (nextPump % 3) + 1;
                        attempts++;
                    } while (!COOLING_TOWER_CONFIG[`PUMP_${nextPump}_AVAILABLE`] && attempts < 3);

                    if (COOLING_TOWER_CONFIG[`PUMP_${nextPump}_AVAILABLE`]) {
                        stateStorage.pumpRotation.newPump = nextPump;
                        stateStorage.pumpRotation.changeoverInProgress = true;
                        stateStorage.pumpRotation.changeoverStartTime = currentTime;
                    } else {
                        console.log(`[PUMP_CONTROL] No available pumps for failover!`);
                    }
                }

                // Check for weekly rotation
                const timeSinceRotation = currentTime - stateStorage.pumpRotation.lastRotationTime;
                if (timeSinceRotation >= WEEK_IN_MS && !changeoverInProgress) {
                    console.log(`[PUMP_CONTROL] Weekly rotation triggered (${(timeSinceRotation / (24*60*60*1000)).toFixed(1)} days)`);

                    // Find next available pump for rotation
                    let nextPump = activePump;
                    let attempts = 0;
                    do {
                        nextPump = (nextPump % 3) + 1;
                        attempts++;
                    } while (!COOLING_TOWER_CONFIG[`PUMP_${nextPump}_AVAILABLE`] && attempts < 3);

                    if (COOLING_TOWER_CONFIG[`PUMP_${nextPump}_AVAILABLE`] && nextPump !== activePump) {
                        stateStorage.pumpRotation.newPump = nextPump;
                        stateStorage.pumpRotation.changeoverInProgress = true;
                        stateStorage.pumpRotation.changeoverStartTime = currentTime;
                        stateStorage.pumpRotation.lastRotationTime = currentTime;
                    } else {
                        console.log(`[PUMP_CONTROL] Cannot rotate - no other available pumps`);
                    }
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

            // CRITICAL FIX: Reset PID states when towers should be OFF
            if (activeTowers === 0) {
                // Reset all PID states when no towers should run
                stateStorage.tower1PidState.lastOutput = 0;
                stateStorage.tower1PidState.integral = 0;
                stateStorage.tower2PidState.lastOutput = 0;
                stateStorage.tower2PidState.integral = 0;
                stateStorage.tower3PidState.lastOutput = 0;
                stateStorage.tower3PidState.integral = 0;

                // DO NOT clear startup timers here - let the minimum runtime enforcement handle it
                console.log(`[COOLING_TOWER] All towers OFF request - PID states reset (startup timers preserved for minimum runtime check)`);
            }

            // MINIMUM CIRCULATION MODE (valve open, fan off, pump on)
            if (activeTowers === 0.5) {
                // Need at least 2 valves open for flow path (supply and return)
                // Open lead tower and first lag tower valves for circulation but fans OFF
                controlResult[`tower${leadTower}IsolationValveOpen`] = true;
                controlResult[`tower${leadTower}VFDEnable`] = false;
                controlResult[`tower${leadTower}FanSpeed`] = 0;
                // Pump control handled by main pump rotation logic above

                controlResult[`tower${lagTower1}IsolationValveOpen`] = true;
                controlResult[`tower${lagTower1}VFDEnable`] = false;
                controlResult[`tower${lagTower1}FanSpeed`] = 0;

                console.log(`[COOLING_TOWER] Towers ${leadTower} & ${lagTower1} valves open for minimum circulation (no cooling)`);
            }
            // STAGE 1-2: Lead tower operation (if available and not blocked by OFF time)
            else if (activeTowers >= 1 && COOLING_TOWER_CONFIG[`TOWER_${leadTower}_AVAILABLE`] && !towersBlockedByOffTime[leadTower]) {
                controlResult[`tower${leadTower}VFDEnable`] = true;
                controlResult[`tower${leadTower}IsolationValveOpen`] = true;

                // Use PID controller for VFD speed control
                // Target is to maintain setpoint temperature
                const pidState = leadTower === 1 ? stateStorage.tower1PidState :
                                leadTower === 2 ? stateStorage.tower2PidState :
                                stateStorage.tower3PidState;

                if (pidControllerImproved) {
                    // PID configuration for tower VFD - retrieved from database
                    const pidParams = {
                        equipmentId: 'cooling_tower',
                        controllerType: `tower${leadTower}_vfd`
                    };

                    // Use persistent startup timer in stateStorage
                    const startupKey = `tower${leadTower}StartupTime`;
                    const timeSinceStartup = stateStorage[startupKey] ? (Date.now() - stateStorage[startupKey]) / 1000 : 0;

                    if (timeSinceStartup < 420) {  // 7 minutes = 420 seconds
                        // ABSOLUTE FORCE minimum speed during startup - NO EXCEPTIONS
                        controlResult[`tower${leadTower}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
                        console.log(`[COOLING_TOWER] Tower ${leadTower} STARTUP: FORCING ${COOLING_TOWER_CONFIG.VFD_MIN_SPEED}V for ${(420 - timeSinceStartup).toFixed(0)}s more`);
                    } else if (Math.abs(deltaT) < 2) {
                        // CRITICAL: If we're within 2°F of setpoint, STAY at minimum speed
                        controlResult[`tower${leadTower}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
                        console.log(`[COOLING_TOWER] Tower ${leadTower} MAINTAINING: DeltaT=${deltaT.toFixed(1)}°F, staying at MIN ${COOLING_TOWER_CONFIG.VFD_MIN_SPEED}V`);
                    } else {
                        // After startup, use PID control
                        console.log(`[PID_DEBUG] Tower ${leadTower} - Starting PID calculation`);
                        console.log(`[PID_DEBUG] Input Temp: ${heatPumpSupplyTemp}°F, Setpoint: ${targetSetpoint}°F, DeltaT: ${deltaT.toFixed(1)}°F`);
                        console.log(`[PID_DEBUG] PID State Before: integral=${pidState.integral}, lastOutput=${pidState.lastOutput}`);

                        // For cooling: setpoint is target temp, input is actual temp
                        // PID will output MORE when actual > setpoint (needs cooling)
                        const pidResult = pidControllerImproved({
                            input: heatPumpSupplyTemp,      // actual temperature
                            setpoint: targetSetpoint,       // setpoint temperature
                            pidParams: {},                  // Will load from DB based on equipmentId/controllerType
                            dt: 15,                         // 15 second sample time
                            controllerType: `tower${leadTower}_vfd`,
                            pidState: pidState,
                            equipmentId: 'cooling_tower'
                        });

                        console.log(`[PID_DEBUG] PID Result: output=${pidResult.output.toFixed(2)}V`);
                        console.log(`[PID_DEBUG] PID State After: integral=${pidState.integral}, lastOutput=${pidState.lastOutput}`);

                        controlResult[`tower${leadTower}FanSpeed`] = pidResult.output;
                        console.log(`[COOLING_TOWER] Tower ${leadTower} PID: Setpoint=${targetSetpoint}°F, Actual=${heatPumpSupplyTemp.toFixed(1)}°F, Output=${pidResult.output.toFixed(2)}V`);
                    }
                } else {
                    // Fallback if PID not available - simple proportional control
                    // MUST RESPECT STARTUP PERIOD JUST LIKE PID
                    console.log(`[FALLBACK] Tower ${leadTower} using fallback control - PID not available`);

                    // Use persistent startup timer in stateStorage
                    const startupKey = `tower${leadTower}StartupTime`;
                    const timeSinceStartup = stateStorage[startupKey] ? (Date.now() - stateStorage[startupKey]) / 1000 : 0;

                    if (timeSinceStartup < 420) {  // 7 minutes = 420 seconds
                        // ABSOLUTE FORCE minimum during startup - NO EXCEPTIONS
                        controlResult[`tower${leadTower}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
                        pidState.lastOutput = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;  // Track this!
                        console.log(`[FALLBACK] Tower ${leadTower} STARTUP: FORCING ${COOLING_TOWER_CONFIG.VFD_MIN_SPEED}V for ${(420 - timeSinceStartup).toFixed(0)}s more`);
                    } else {
                        // After startup, modulate speed based on deltaT
                        let speed = pidState.lastOutput || COOLING_TOWER_CONFIG.VFD_MIN_SPEED;

                        // SMOOTH MODULATION - adjust speed gradually
                        if (deltaT > 2) {
                            // Need more cooling - increase speed slowly
                            speed = Math.min(speed + 0.1, COOLING_TOWER_CONFIG.VFD_MAX_SPEED);
                        } else if (deltaT < -2) {
                            // Too much cooling - decrease speed slowly
                            speed = Math.max(speed - 0.1, COOLING_TOWER_CONFIG.VFD_MIN_SPEED);
                        }
                        // If between -2 and +2, maintain current speed

                        controlResult[`tower${leadTower}FanSpeed`] = speed;
                        pidState.lastOutput = speed;  // Track for next cycle
                        console.log(`[FALLBACK] Tower ${leadTower} MODULATING: deltaT=${deltaT.toFixed(1)}°F, Speed=${speed.toFixed(2)}V (was ${(pidState.lastOutput || 0).toFixed(2)}V)`);
                    }
                }
            }

            // STAGE 3: First lag tower (if available and not blocked by OFF time)
            if (activeTowers >= 2 && COOLING_TOWER_CONFIG[`TOWER_${lagTower1}_AVAILABLE`] && !towersBlockedByOffTime[lagTower1]) {
                controlResult[`tower${lagTower1}VFDEnable`] = true;
                controlResult[`tower${lagTower1}IsolationValveOpen`] = true;

                // Apply same coolingDemand-based speed calculation to lag tower 1
                let lag1TargetSpeed = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;

                // When two towers run, split the demand
                // Both run at similar speeds for balance
                if (controlResult.coolingDemand <= 28) {
                    lag1TargetSpeed = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;  // 2.8V minimum
                } else {
                    // Use same scaling as lead tower
                    const scaledDemand = (controlResult.coolingDemand - 28) / 72;
                    lag1TargetSpeed = 2.8 + (scaledDemand * 2.15);
                    lag1TargetSpeed = Math.min(lag1TargetSpeed, COOLING_TOWER_CONFIG.VFD_HIGH_SPEED);
                }

                // Implement ramping with timing control for lag tower 1
                const lag1CurrentSpeed = controlResult[`tower${lagTower1}FanSpeed`] || 0;
                const lag1RampKey = `tower${lagTower1}Ramp`;
                const lag1Now = Date.now();

                if (!stateStorage.towerStaging.vfdRampTimers[lag1RampKey]) {
                    stateStorage.towerStaging.vfdRampTimers[lag1RampKey] = {
                        lastChange: 0,
                        currentSpeed: lag1CurrentSpeed
                    };
                }

                const lag1RampTimer = stateStorage.towerStaging.vfdRampTimers[lag1RampKey];

                // CRITICAL FIX: ALWAYS start at minimum speed when tower turns on
                if (lag1RampTimer.currentSpeed === 0 || lag1RampTimer.currentSpeed < COOLING_TOWER_CONFIG.VFD_MIN_SPEED) {
                    lag1RampTimer.currentSpeed = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
                    lag1RampTimer.lastChange = lag1Now; // Reset timer to prevent immediate ramp
                    console.log(`[COOLING_TOWER] Tower ${lagTower1} starting at minimum ${COOLING_TOWER_CONFIG.VFD_MIN_SPEED}V`);
                }
                const lag1TimeSinceLastChange = lag1Now - lag1RampTimer.lastChange;
                const lag1RampDelay = lag1TargetSpeed > lag1RampTimer.currentSpeed ?
                    COOLING_TOWER_CONFIG.VFD_RAMP_STEP_DELAY :
                    COOLING_TOWER_CONFIG.VFD_RAMP_DOWN_DELAY;

                if (lag1TimeSinceLastChange >= lag1RampDelay) {
                    // Step towards target speed
                    if (Math.abs(lag1TargetSpeed - lag1RampTimer.currentSpeed) > 0.1) {
                        const step = lag1TargetSpeed > lag1RampTimer.currentSpeed ? 0.3 : -0.3;
                        const newSpeed = lag1RampTimer.currentSpeed + step;

                        // Clamp to target
                        if ((step > 0 && newSpeed > lag1TargetSpeed) || (step < 0 && newSpeed < lag1TargetSpeed)) {
                            controlResult[`tower${lagTower1}FanSpeed`] = lag1TargetSpeed;
                            lag1RampTimer.currentSpeed = lag1TargetSpeed;
                        } else {
                            controlResult[`tower${lagTower1}FanSpeed`] = newSpeed;
                            lag1RampTimer.currentSpeed = newSpeed;
                        }

                        lag1RampTimer.lastChange = lag1Now;
                        console.log(`[COOLING_TOWER] Ramping tower ${lagTower1}: ${lag1RampTimer.currentSpeed.toFixed(1)}V → ${lag1TargetSpeed.toFixed(1)}V (ΔT=${deltaT.toFixed(1)}°F)`);
                    } else {
                        controlResult[`tower${lagTower1}FanSpeed`] = lag1TargetSpeed;
                        lag1RampTimer.currentSpeed = lag1TargetSpeed;
                    }
                } else {
                    // Maintain current speed during ramp delay
                    controlResult[`tower${lagTower1}FanSpeed`] = lag1RampTimer.currentSpeed;
                }
            }

            // STAGE 4: Second lag tower (if available and not blocked by OFF time)
            if (activeTowers >= 3 && COOLING_TOWER_CONFIG[`TOWER_${lagTower2}_AVAILABLE`] && !towersBlockedByOffTime[lagTower2]) {
                console.log(`[TOWER_DEBUG] Enabling tower ${lagTower2} as second lag (stage 4, deltaT=${deltaT.toFixed(1)}°F)`);
                controlResult[`tower${lagTower2}VFDEnable`] = true;
                controlResult[`tower${lagTower2}IsolationValveOpen`] = true;
                // Apply same coolingDemand-based speed calculation to lag tower 2
                let lag2TargetSpeed = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;

                // When three towers run at Stage 4 (100% demand), run at high speed
                if (controlResult.coolingDemand <= 28) {
                    lag2TargetSpeed = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;  // 2.8V minimum
                } else {
                    // Use same scaling as other towers
                    const scaledDemand = (controlResult.coolingDemand - 28) / 72;
                    lag2TargetSpeed = 2.8 + (scaledDemand * 2.15);
                    lag2TargetSpeed = Math.min(lag2TargetSpeed, COOLING_TOWER_CONFIG.VFD_HIGH_SPEED);
                }

                // Implement ramping with timing control for lag tower 2
                const lag2CurrentSpeed = controlResult[`tower${lagTower2}FanSpeed`] || 0;
                const lag2RampKey = `tower${lagTower2}Ramp`;
                const lag2Now = Date.now();

                if (!stateStorage.towerStaging.vfdRampTimers[lag2RampKey]) {
                    stateStorage.towerStaging.vfdRampTimers[lag2RampKey] = {
                        lastChange: 0,
                        currentSpeed: lag2CurrentSpeed
                    };
                }

                const lag2RampTimer = stateStorage.towerStaging.vfdRampTimers[lag2RampKey];

                // CRITICAL FIX: ALWAYS start at minimum speed when tower turns on
                if (lag2RampTimer.currentSpeed === 0 || lag2RampTimer.currentSpeed < COOLING_TOWER_CONFIG.VFD_MIN_SPEED) {
                    lag2RampTimer.currentSpeed = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
                    lag2RampTimer.lastChange = lag2Now; // Reset timer to prevent immediate ramp
                    console.log(`[COOLING_TOWER] Tower ${lagTower2} starting at minimum ${COOLING_TOWER_CONFIG.VFD_MIN_SPEED}V`);
                }
                const lag2TimeSinceLastChange = lag2Now - lag2RampTimer.lastChange;
                const lag2RampDelay = lag2TargetSpeed > lag2RampTimer.currentSpeed ?
                    COOLING_TOWER_CONFIG.VFD_RAMP_STEP_DELAY :
                    COOLING_TOWER_CONFIG.VFD_RAMP_DOWN_DELAY;

                if (lag2TimeSinceLastChange >= lag2RampDelay) {
                    // Step towards target speed
                    if (Math.abs(lag2TargetSpeed - lag2RampTimer.currentSpeed) > 0.1) {
                        const step = lag2TargetSpeed > lag2RampTimer.currentSpeed ? 0.3 : -0.3;
                        const newSpeed = lag2RampTimer.currentSpeed + step;

                        // Clamp to target
                        if ((step > 0 && newSpeed > lag2TargetSpeed) || (step < 0 && newSpeed < lag2TargetSpeed)) {
                            controlResult[`tower${lagTower2}FanSpeed`] = lag2TargetSpeed;
                            lag2RampTimer.currentSpeed = lag2TargetSpeed;
                        } else {
                            controlResult[`tower${lagTower2}FanSpeed`] = newSpeed;
                            lag2RampTimer.currentSpeed = newSpeed;
                        }

                        lag2RampTimer.lastChange = lag2Now;
                        console.log(`[COOLING_TOWER] Ramping tower ${lagTower2}: ${lag2RampTimer.currentSpeed.toFixed(1)}V → ${lag2TargetSpeed.toFixed(1)}V (ΔT=${deltaT.toFixed(1)}°F)`);
                    } else {
                        controlResult[`tower${lagTower2}FanSpeed`] = lag2TargetSpeed;
                        lag2RampTimer.currentSpeed = lag2TargetSpeed;
                    }
                } else {
                    // Maintain current speed during ramp delay
                    controlResult[`tower${lagTower2}FanSpeed`] = lag2RampTimer.currentSpeed;
                }
            }

            // Close isolation valves for inactive towers
            for (let i = 1; i <= 3; i++) {
                if (!controlResult[`tower${i}VFDEnable`]) {
                    controlResult[`tower${i}IsolationValveClose`] = true;
                }
            }
        }

        // VALVE CONTROL WITH PID CONTROLLER
        // Only active when outdoor temperature is below 42°F
        // All valves are normally closed, direct acting (2V=closed, 10V=open)
        // Tempering valves inject warm water into HP (condenser) loop to prevent freezing
        // Bypass valve on megabas AO4 (2-10V range)
        // When cold: Tempering valves open to mix warm water into HP loop
        // When warm (>42°F): All valves closed (2V) - no mixing needed

        let bypassPosition = 2.0; // Default closed (no bypass)
        let valveControlActive = false;

        // Check if manual override is active
        const manualOverride = uiCommands.bypassValvePosition !== undefined || uiCommands.temperingValvePosition !== undefined;

        // Only activate valve control when outdoor temp is below 42°F
        if (outdoorTemp < 42) {
            valveControlActive = true;

            if (!manualOverride && controlResult.systemEnabled && pidControllerImproved) {
                // Use PID controller to maintain HP loop temperature in cold weather
                // Monitor HP supply/return temps to prevent freezing
                const hpLoopTemp = (heatPumpSupplyTemp + heatPumpReturnTemp) / 2; // Average HP loop temp
                const pidResult = pidControllerImproved({
                    input: hpLoopTemp,
                    setpoint: 45.0,  // Maintain HP loop above 45°F for freeze protection
                    pidParams: {
                        kp: 2.5,
                        ki: 0.15,
                        kd: 0.05,
                        outputMin: 2.0,  // Minimum 2V (valve closed)
                        outputMax: 10.0, // Maximum 10V (valve fully open)
                        reverseActing: false,  // Direct acting - all valves 2V=closed, 10V=open
                        maxIntegral: 50
                    },
                    dt: 7, // 7 second control loop
                    controllerType: 'valve_control',
                    pidState: stateStorage.valvePidState,
                    equipmentId: 'cooling_tower'
                });

                // PID output controls tempering valve position (2-10V range)
                // All valves are direct acting: 2V=closed, 10V=open
                let temperingPosition = pidResult.output;

                // In very cold weather, ensure adequate tempering
                if (outdoorTemp < 35) {
                    // Very cold - ensure tempering is at least 60% open (6.8V minimum)
                    temperingPosition = Math.max(temperingPosition, 6.8);
                } else if (outdoorTemp < 40) {
                    // Cold - ensure tempering is at least 40% open (5.2V minimum)
                    temperingPosition = Math.max(temperingPosition, 5.2);
                }

                // In cold weather, bypass can modulate along with tempering
                // Or keep bypass closed if only tempering is needed
                bypassPosition = 2.0;  // Keep bypass closed

                // Set tempering valve based on PID output
                controlResult.temperingValvePosition = temperingPosition;

                // Smooth the valve movement to prevent hunting
                const lastTempering = stateStorage.valvePidState.lastOutput || 5.0;
                const maxChange = 0.4; // Max 0.4V change per cycle
                if (Math.abs(temperingPosition - lastTempering) > maxChange) {
                    temperingPosition = lastTempering + (temperingPosition > lastTempering ? maxChange : -maxChange);
                }
                controlResult.temperingValvePosition = temperingPosition;

                // Update PID state
                stateStorage.valvePidState = pidResult.pidState;
                stateStorage.valvePidState.lastOutput = temperingPosition;

                // Log PID details periodically when active
                if (Math.random() < 0.02) { // Log ~2% of cycles
                    console.log(`[PID_VALVE] ACTIVE (OAT=${outdoorTemp.toFixed(1)}°F<42°F) HP Loop Temp: ${hpLoopTemp.toFixed(1)}°F, Target: 45°F, Error: ${pidResult.error.toFixed(1)}°F`);
                    console.log(`[PID_VALVE] P=${pidResult.P.toFixed(2)}, I=${pidResult.I.toFixed(2)}, D=${pidResult.D.toFixed(2)}, Tempering=${temperingPosition.toFixed(1)}V (${((temperingPosition-2)/8*100).toFixed(0)}% open)`);
                }
            } else if (!pidControllerImproved) {
                // Fallback to simple control if PID not available
                // All valves direct acting: 2V=closed, 10V=open
                bypassPosition = 2.0;  // Keep bypass closed
                if (outdoorTemp < 35) {
                    // Very cold weather - open tempering valve 70% (7.6V)
                    controlResult.temperingValvePosition = 7.6;
                } else {
                    // Cold weather (35-42°F) - open tempering valve 50% (6V)
                    controlResult.temperingValvePosition = 6.0;
                }
            } else if (!controlResult.systemEnabled) {
                // System disabled but cold - still provide freeze protection
                bypassPosition = 2.0;  // Keep bypass closed
                controlResult.temperingValvePosition = 6.0; // Open tempering 50% for freeze protection
            }
        } else {
            // Outdoor temp >= 42°F - No valve control needed
            // All valves closed (2V) - no mixing or tempering needed
            bypassPosition = 2.0;  // Bypass closed (2V)
            controlResult.temperingValvePosition = 2.0;  // Tempering closed (2V)

            // Reset PID state when not in use
            if (stateStorage.valvePidState) {
                stateStorage.valvePidState.integral = 0;
                stateStorage.valvePidState.lastOutput = 2.0;
            }

            // Log when valve control becomes inactive
            if (Math.random() < 0.005) { // Log occasionally
                console.log(`[VALVE_CONTROL] INACTIVE - OAT=${outdoorTemp.toFixed(1)}°F >= 42°F, bypass closed (2V), tempering closed (2V)`);
            }
        }

        // Ensure positions stay within 2-10V range
        bypassPosition = Math.max(2.0, Math.min(10.0, bypassPosition));

        // Set bypass valve position (2-10V on AO4)
        controlResult.bypassValvePosition = bypassPosition;

        // Ensure tempering valve position is set and within range
        if (controlResult.temperingValvePosition === undefined) {
            controlResult.temperingValvePosition = 2.0;  // Default closed
        }
        controlResult.temperingValvePosition = Math.max(2.0, Math.min(10.0, controlResult.temperingValvePosition));

        // Log valve positions periodically for debugging
        if (Math.random() < 0.01) { // Log ~1% of cycles
            const bypassPercent = ((bypassPosition - 2) / 8 * 100).toFixed(0);
            const temperingPercent = ((controlResult.temperingValvePosition - 2) / 8 * 100).toFixed(0);
            const status = valveControlActive ? 'ACTIVE' : 'INACTIVE';
            console.log(`[VALVE_CONTROL] ${status} - Bypass: ${bypassPosition.toFixed(1)}V (${bypassPercent}% open), Tempering: ${controlResult.temperingValvePosition.toFixed(1)}V (${temperingPercent}% open), OAT=${outdoorTemp.toFixed(1)}°F`);
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

        // Manual overrides - allow independent control of valves
        // All valves are direct acting: 2V=closed, 10V=open
        if (uiCommands.bypassValvePosition !== undefined) {
            let manualBypass = parseFloat(uiCommands.bypassValvePosition);
            // Ensure manual control stays within 2-10V range
            controlResult.bypassValvePosition = Math.max(2.0, Math.min(10.0, manualBypass));
        }
        if (uiCommands.temperingValvePosition !== undefined) {
            let manualTempering = parseFloat(uiCommands.temperingValvePosition);
            // Ensure manual control stays within 2-10V range
            controlResult.temperingValvePosition = Math.max(2.0, Math.min(10.0, manualTempering));
        }

        // ENFORCE 7-MINUTE MINIMUM RUNTIME (ONLY WHEN COOLING)
        // Once a tower starts FOR COOLING, it must run for at least 7 minutes before it can be shut down
        // But if we're BELOW setpoint (negative deltaT), allow immediate shutdown for energy savings
        for (let i = 1; i <= 3; i++) {
            // CRITICAL: Skip minimum runtime enforcement if tower is blocked by OFF time
            if (towersBlockedByOffTime[i]) {
                // This tower is in its minimum OFF time period - DO NOT force it ON
                console.log(`[COOLING_TOWER] Tower ${i} blocked by minimum OFF time - skipping runtime check`);
                controlResult[`tower${i}VFDEnable`] = false;
                controlResult[`tower${i}FanSpeed`] = 0;
                controlResult[`tower${i}IsolationValveClose`] = true;
                controlResult[`tower${i}IsolationValveOpen`] = false;
                continue;
            }

            const startupKey = `tower${i}StartupTime`;
            const wantsToBeEnabled = controlResult[`tower${i}VFDEnable`] || false;

            // If tower has a startup timer and logic wants to turn it off
            if (!wantsToBeEnabled && stateStorage[startupKey]) {
                const timeSinceStartup = (Date.now() - stateStorage[startupKey]) / 1000;

                // CRITICAL: ALWAYS enforce 7-minute minimum runtime once a tower starts
                // This prevents short-cycling which damages equipment
                if (timeSinceStartup < 420) {
                    // Tower hasn't run for 7 minutes yet - FORCE it to stay ON
                    console.log(`[COOLING_TOWER] Tower ${i} MINIMUM RUNTIME: Forcing ON for ${(420 - timeSinceStartup).toFixed(0)}s more (preventing short-cycle damage)`);
                    controlResult[`tower${i}VFDEnable`] = true;
                    controlResult[`tower${i}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
                    controlResult[`tower${i}IsolationValveOpen`] = true;
                    controlResult[`tower${i}IsolationValveClose`] = false;
                } else {
                    // Tower has run for 7+ minutes - check if we should actually shut down
                    // Get current deltaT to check shutdown conditions
                    const currentDeltaT = controlResult.heatPumpSupplyTemp - controlResult.targetSupplyTemp;

                    // Only shut down if we're REALLY below the shutdown threshold (-15°F)
                    // OR if HP supply is below 65°F (too cold to run)
                    if (currentDeltaT < -15 || controlResult.heatPumpSupplyTemp < 65) {
                        // Conditions warrant shutdown - clear startup timer and set shutdown timer
                        delete stateStorage[startupKey];
                        const shutdownKey = `tower${i}ShutdownTime`;
                        stateStorage[shutdownKey] = Date.now();
                        console.log(`[COOLING_TOWER] Tower ${i} completed 7-minute runtime AND conditions warrant shutdown (deltaT=${currentDeltaT.toFixed(1)}°F) - shutting down, 3-minute cooldown started`);
                    } else {
                        // Conditions still require cooling - keep tower running!
                        delete stateStorage[startupKey]; // Clear the startup timer since we're past minimum
                        console.log(`[COOLING_TOWER] Tower ${i} completed 7-minute minimum runtime but still needed (deltaT=${currentDeltaT.toFixed(1)}°F) - continuing operation`);
                        // FORCE the tower to stay ON since conditions don't warrant shutdown
                        controlResult[`tower${i}VFDEnable`] = true;
                        controlResult[`tower${i}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
                        controlResult[`tower${i}IsolationValveOpen`] = true;
                        controlResult[`tower${i}IsolationValveClose`] = false;
                    }
                }
            }
        }

        // CRITICAL FIX: If VFD speed is below minimum, turn it OFF completely
        // VFDs cannot run below minimum speed, so they must be OFF (0V)
        // EXCEPTION: Allow 2.6V during startup period (first 7 minutes)
        for (let i = 1; i <= 3; i++) {
            if (controlResult[`tower${i}FanSpeed`] > 0 && controlResult[`tower${i}FanSpeed`] < COOLING_TOWER_CONFIG.VFD_MIN_SPEED) {
                // Check if tower is in startup period (first 7 minutes)
                const startupKey = `tower${i}StartupTime`;
                const isInStartup = stateStorage[startupKey] &&
                    ((Date.now() - stateStorage[startupKey]) / 1000) < 420; // 7 minutes

                if (!isInStartup) {
                    console.log(`[COOLING_TOWER] Tower ${i} speed ${controlResult[`tower${i}FanSpeed`].toFixed(2)}V is below minimum ${COOLING_TOWER_CONFIG.VFD_MIN_SPEED}V - turning OFF`);
                    controlResult[`tower${i}FanSpeed`] = 0;
                    controlResult[`tower${i}VFDEnable`] = false;
                } else {
                    console.log(`[COOLING_TOWER] Tower ${i} STARTUP: Allowing ${controlResult[`tower${i}FanSpeed`].toFixed(2)}V (below normal minimum)`);
                }
            }
        }

        console.log(`[COOLING_TOWER] Control processed: ΔT=${deltaT.toFixed(1)}°F, Active=${controlResult.activeTowers}, Lead=${controlResult.leadTower} (ID: ${EQUIPMENT_IDS['COOLING_TOWER_' + controlResult.leadTower]}), Demand=${controlResult.coolingDemand}%, OAT=${controlResult.outdoorTemp.toFixed(1)}°F, Bypasses=[${safetyBypasses.join(',')}]`);

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
