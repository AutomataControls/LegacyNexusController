// ===============================================================================
// Automata Nexus AI - OPTIMIZED Cooling Tower Control Logic
// Neural Facility Intelligence Processing Infrastructure (PRODUCTION)
// ===============================================================================

/**
 * OPTIMIZED Cooling Tower Control Logic
 * 
 * 
 * @module CoolingTowerLogic
 * @version 2.0.0
 * @author AutomataNexus - Current Mechanical License #CM-2024-001
 * @date 2025-09-22
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

    // Safety bypass toggles
    BYPASS_EMERGENCY_STOP: false,
    BYPASS_WATER_LEVEL: false,
    BYPASS_VIBRATION_LIMITS: false,
    BYPASS_CURRENT_LIMITS: false,
    BYPASS_PUMP_STATUS: false,
    BYPASS_VFD_FAULTS: false,

    // Equipment Availability
    TOWER_1_AVAILABLE: true,
    TOWER_2_AVAILABLE: true,
    TOWER_3_AVAILABLE: false,  // Tower 3 DOWN FOR REPAIR
    PUMP_1_AVAILABLE: true,
    PUMP_2_AVAILABLE: true,
    PUMP_3_AVAILABLE: true,

    // Control parameters
    LEAD_TOWER_ROTATION: 'weekly',
    TARGET_SUPPLY_TEMP: 85.0,
    DEADBAND_TEMP: 1.0,

    // Limits
    VIBRATION_WARNING_LIMIT: 4.5,
    VIBRATION_CRITICAL_LIMIT: 7.1,
    VFD_CURRENT_WARNING: 40.0,
    VFD_CURRENT_CRITICAL: 45.0,
    PUMP_CURRENT_MIN: 5.0,
    PUMP_CURRENT_MAX: 45.0,

    // Staging thresholds (°F delta-T)
    STAGE_1_DELTA_T: 10.0,
    STAGE_2_DELTA_T: 20.0,
    STAGE_3_DELTA_T: 30.0,
    STAGE_4_DELTA_T: 35.0,

    // VFD speed references
    VFD_MIN_SPEED: 2.6,
    VFD_MAX_SPEED: 4.8,
    VFD_LOW_SPEED: 3.5,
    VFD_HIGH_SPEED: 4.8,

    // Timing delays (milliseconds)
    MINIMUM_RUNTIME_MS: 420000,      // 7 minutes
    MINIMUM_OFFTIME_MS: 180000,      // 3 minutes
    PUMP_CHANGEOVER_OVERLAP_MS: 5000, // 5 seconds
    WEEK_IN_MS: 7 * 24 * 60 * 60 * 1000
};

// Import PID controller if available
let pidControllerImproved;
try {
    pidControllerImproved = require('../../src/services/pid-controller').pidControllerImproved;
} catch (e) {
    console.log('[COOLING_TOWER] PID controller not available, using fallback control');
}

/**
 * Main cooling tower control function - OPTIMIZED
 */
function processCoolingTowerControl(data, uiCommands = {}, stateStorage = {}) {
    try {
        // Initialize state storage with clean structure
        initializeState(stateStorage);
        
        // Parse sensor data with validation
        const sensorData = parseSensorData(data, stateStorage);
        
        // Initialize control result
        const controlResult = initializeControlResult(sensorData);
        
        // Perform safety checks - return immediately if critical faults
        const safetyResult = performSafetyChecks(sensorData, controlResult);
        if (!safetyResult.safe) {
            return safetyResult.controlResult;
        }
        
        // Apply manual overrides first
        applyManualOverrides(uiCommands, controlResult);
        
        // Skip automatic control if system disabled or manual mode
        if (!controlResult.systemEnabled || controlResult.controlMode !== 'auto') {
            return controlResult;
        }
        
        // Automatic control sequence
        performLeadTowerRotation(stateStorage);
        const stagingDecision = calculateStaging(sensorData, stateStorage);
        controlPumps(sensorData, stateStorage, controlResult);
        controlTowers(stagingDecision, sensorData, stateStorage, controlResult);
        controlValves(sensorData, stateStorage, controlResult, uiCommands);
        controlHeaters(sensorData.temps.outdoor, controlResult);
        
        // Apply monitoring and warnings
        applyCurrentAndVibrationMonitoring(sensorData, controlResult);
        
        // Update control result with final values
        updateControlResultSummary(controlResult, stagingDecision, sensorData);
        
        console.log(`[COOLING_TOWER] Control processed: ΔT=${stagingDecision.deltaT.toFixed(1)}°F, Active=${stagingDecision.demandedTowers}, Lead=${stagingDecision.leadTower}, Demand=${stagingDecision.coolingDemand}%, OAT=${sensorData.temps.outdoor.toFixed(1)}°F`);
        
        return controlResult;
        
    } catch (error) {
        console.error(`[COOLING_TOWER] Error: ${error.message}`);
        return createSafeDefaultState(error);
    }
}

// ================== INITIALIZATION FUNCTIONS ==================

function initializeState(stateStorage) {
    // Unified state structure - no more scattered variables
    if (!stateStorage.towers) {
        stateStorage.towers = {
            leadTower: 1,
            lastRotationTime: Date.now(),
            runtimeTracking: { tower1: 0, tower2: 0, tower3: 0 },
            timers: {
                tower1: { startTime: null, stopTime: null },
                tower2: { startTime: null, stopTime: null },
                tower3: { startTime: null, stopTime: null }
            },
            speedRamping: {
                tower1: { currentSpeed: 0, targetSpeed: 0, lastChange: 0 },
                tower2: { currentSpeed: 0, targetSpeed: 0, lastChange: 0 },
                tower3: { currentSpeed: 0, targetSpeed: 0, lastChange: 0 }
            }
        };
    }
    
    if (!stateStorage.pumps) {
        stateStorage.pumps = {
            activePump: 1,
            lastRotationTime: Date.now(),
            runtimeTracking: { pump1: 0, pump2: 0, pump3: 0 },
            changeoverState: null, // null or { newPump, startTime }
            failoverCount: 0,
            lastFailoverTime: 0
        };
    }
    
    if (!stateStorage.pidStates) {
        stateStorage.pidStates = {
            tower1: { integral: 0, previousError: 0, lastOutput: COOLING_TOWER_CONFIG.VFD_MIN_SPEED },
            tower2: { integral: 0, previousError: 0, lastOutput: COOLING_TOWER_CONFIG.VFD_MIN_SPEED },
            tower3: { integral: 0, previousError: 0, lastOutput: COOLING_TOWER_CONFIG.VFD_MIN_SPEED },
            valve: { integral: 0, previousError: 0, lastOutput: 6.0 }
        };
    }
    
    if (!stateStorage.lastGoodTemps) {
        stateStorage.lastGoodTemps = {
            towerSupply: 85,
            towerReturn: 95,
            hpReturn: 85,
            hpSupply: 75
        };
    }
}

function parseSensorData(data, stateStorage) {
    return {
        // VFD Currents (already in amps)
        vfdCurrents: {
            tower1A: parseFloat(data.AI1 || 0),
            tower1B: parseFloat(data.AI2 || 0),
            tower2A: parseFloat(data.AI3 || 0),
            tower2B: parseFloat(data.AI4 || 0),
            tower3A: parseFloat(data.AI5 || 0),
            tower3B: parseFloat(data.AI6 || 0)
        },
        
        // Pump Currents
        pumpCurrents: {
            pump1: parseFloat(data.CH8 || 0),
            pump2: parseFloat(data.CH5 || 0),
            pump3: parseFloat(data.CH6 || 0)
        },
        
        // Temperatures with sanity checking - FINAL CORRECT ASSIGNMENTS
        temps: sanitizeTemperatures({
            towerSupply: parseFloat(data.CH10 || 75),   // CH10 = Tower Supply (to heat pumps)
            towerReturn: parseFloat(data.CH9 || 85),    // CH9 = Tower Return (from heat pumps)
            hpReturn: parseFloat(data.CH1 || 85),       // CH1 = HP Return (cooler, from HPs)
            hpSupply: parseFloat(data.CH2 || 75),       // CH2 = HP Supply (hotter, to HPs)
            outdoor: parseFloat(data.outdoorTemp || 75)
        }, stateStorage.lastGoodTemps),
        
        // Vibration levels
        vibration: {
            tower1: parseFloat(data.WTV801_1 || 0),
            tower2: parseFloat(data.WTV801_2 || 0),
            tower3: parseFloat(data.WTV801_3 || 0)
        },
        
        // User setpoint
        targetSetpoint: parseFloat(data.userSetpoint || data.targetSupplyTemp || 75)
    };
}

function sanitizeTemperatures(temps, lastGoodTemps) {
    const sanitized = {};
    
    // Sanity check each temperature (40-120°F range)
    Object.keys(temps).forEach(key => {
        const temp = temps[key];
        const lastGoodKey = key === 'towerSupply' ? 'towerSupply' :
                           key === 'towerReturn' ? 'towerReturn' :
                           key === 'hpReturn' ? 'hpReturn' :
                           key === 'hpSupply' ? 'hpSupply' : null;
        
        if (key === 'outdoor') {
            // Outdoor temp has wider acceptable range
            sanitized[key] = (temp >= -20 && temp <= 120) ? temp : 75;
        } else if (temp >= 40 && temp <= 120 && lastGoodKey) {
            sanitized[key] = temp;
            lastGoodTemps[lastGoodKey] = temp;
        } else if (lastGoodKey && lastGoodTemps[lastGoodKey]) {
            console.log(`[TEMP_SANITY] Bad ${key} reading: ${temp}°F - using last good: ${lastGoodTemps[lastGoodKey]}°F`);
            sanitized[key] = lastGoodTemps[lastGoodKey];
        } else {
            sanitized[key] = temp; // Use as-is if no validation available
        }
    });
    
    return sanitized;
}

function initializeControlResult(sensorData) {
    return {
        // Equipment identification
        equipmentIds: EQUIPMENT_IDS,

        // Building Automation HAT Outputs
        tower1VFDEnable: false,
        tower2VFDEnable: false,
        tower3VFDEnable: false,
        tower1FanSpeed: 0,
        tower2FanSpeed: 0,
        tower3FanSpeed: 0,
        bypassValvePosition: 2.0,
        temperingValvePosition: 2.0,

        // Pump Controls
        pump1Enable: false,
        pump2Enable: false,
        pump3Enable: false,

        // Isolation Valve Controls
        tower1IsolationValveOpen: false,
        tower1IsolationValveClose: false,
        tower2IsolationValveOpen: false,
        tower2IsolationValveClose: false,
        tower3IsolationValveOpen: false,
        tower3IsolationValveClose: false,

        // Heater Controls
        tower1HeaterEnable: false,
        tower2HeaterEnable: false,
        tower3HeaterEnable: false,

        // System status
        systemEnabled: true,
        emergencyStop: false,
        controlMode: 'auto',
        leadTower: 1,
        activeTowers: 0,
        coolingDemand: 0,

        // Sensor readings (copy from sensorData)
        ...flattenSensorData(sensorData),

        // Control state
        targetSupplyTemp: sensorData.targetSetpoint,
        loopDeltaT: sensorData.temps.hpSupply - sensorData.targetSetpoint,
        alarmStatus: 'normal',
        faultConditions: [],
        safetyBypasses: [],

        // Timestamps
        lastUpdate: new Date().toISOString(),
        controlTimestamp: Date.now()
    };
}

function flattenSensorData(sensorData) {
    return {
        // VFD Currents
        tower1VFDCurrentA: sensorData.vfdCurrents.tower1A,
        tower1VFDCurrentB: sensorData.vfdCurrents.tower1B,
        tower2VFDCurrentA: sensorData.vfdCurrents.tower2A,
        tower2VFDCurrentB: sensorData.vfdCurrents.tower2B,
        tower3VFDCurrentA: sensorData.vfdCurrents.tower3A,
        tower3VFDCurrentB: sensorData.vfdCurrents.tower3B,
        
        // Pump Currents
        pump1Current: sensorData.pumpCurrents.pump1,
        pump2Current: sensorData.pumpCurrents.pump2,
        pump3Current: sensorData.pumpCurrents.pump3,
        
        // Pump Status
        pump1Running: sensorData.pumpCurrents.pump1 > COOLING_TOWER_CONFIG.PUMP_CURRENT_MIN,
        pump2Running: sensorData.pumpCurrents.pump2 > COOLING_TOWER_CONFIG.PUMP_CURRENT_MIN,
        pump3Running: sensorData.pumpCurrents.pump3 > COOLING_TOWER_CONFIG.PUMP_CURRENT_MIN,
        
        // Temperatures
        towerLoopSupplyTemp: sensorData.temps.towerSupply,
        towerLoopReturnTemp: sensorData.temps.towerReturn,
        heatPumpReturnTemp: sensorData.temps.hpReturn,
        heatPumpSupplyTemp: sensorData.temps.hpSupply,
        outdoorTemp: sensorData.temps.outdoor,
        
        // Vibration
        tower1VibrationLevel: sensorData.vibration.tower1,
        tower2VibrationLevel: sensorData.vibration.tower2,
        tower3VibrationLevel: sensorData.vibration.tower3,
        tower1VibrationOK: sensorData.vibration.tower1 <= COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT,
        tower2VibrationOK: sensorData.vibration.tower2 <= COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT,
        tower3VibrationOK: sensorData.vibration.tower3 <= COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT
    };
}

// ================== SAFETY FUNCTIONS ==================

function performSafetyChecks(sensorData, controlResult) {
    const faultConditions = [];
    const safetyBypasses = [];
    
    // Vibration monitoring
    if (!COOLING_TOWER_CONFIG.BYPASS_VIBRATION_LIMITS) {
        Object.keys(sensorData.vibration).forEach(key => {
            const towerNum = key.replace('tower', '');
            const level = sensorData.vibration[key];
            if (level > COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT) {
                faultConditions.push(`TOWER${towerNum}_HIGH_VIBRATION_CRITICAL (ID: ${EQUIPMENT_IDS[`COOLING_TOWER_${towerNum}`]})`);
            }
        });
    } else {
        safetyBypasses.push('VIBRATION_LIMITS_BYPASSED');
    }
    
    // Current monitoring
    if (!COOLING_TOWER_CONFIG.BYPASS_CURRENT_LIMITS) {
        Object.keys(sensorData.vfdCurrents).forEach(key => {
            const current = sensorData.vfdCurrents[key];
            if (current > COOLING_TOWER_CONFIG.VFD_CURRENT_CRITICAL) {
                const towerNum = key.includes('tower1') ? '1' : key.includes('tower2') ? '2' : '3';
                faultConditions.push(`TOWER${towerNum}_CRITICAL_VFD_CURRENT (ID: ${EQUIPMENT_IDS[`COOLING_TOWER_${towerNum}`]})`);
            }
        });
        
        Object.keys(sensorData.pumpCurrents).forEach(key => {
            const current = sensorData.pumpCurrents[key];
            const pumpNum = key.replace('pump', '');
            if (current > COOLING_TOWER_CONFIG.PUMP_CURRENT_MAX) {
                faultConditions.push(`PUMP${pumpNum}_OVERCURRENT (Tower ID: ${EQUIPMENT_IDS[`COOLING_TOWER_${pumpNum}`]})`);
            }
        });
    } else {
        safetyBypasses.push('CURRENT_LIMITS_BYPASSED');
    }
    
    // Add other bypassed systems
    if (COOLING_TOWER_CONFIG.BYPASS_EMERGENCY_STOP) safetyBypasses.push('EMERGENCY_STOP_BYPASSED');
    if (COOLING_TOWER_CONFIG.BYPASS_WATER_LEVEL) safetyBypasses.push('WATER_LEVEL_BYPASSED');
    if (COOLING_TOWER_CONFIG.BYPASS_VFD_FAULTS) safetyBypasses.push('VFD_FAULTS_BYPASSED');
    
    controlResult.faultConditions = faultConditions;
    controlResult.safetyBypasses = safetyBypasses;
    
    // Emergency shutdown if critical faults
    if (faultConditions.length > 0) {
        controlResult.alarmStatus = 'critical';
        controlResult.systemEnabled = false;
        
        // Shutdown all equipment
        for (let i = 1; i <= 3; i++) {
            controlResult[`tower${i}VFDEnable`] = false;
            controlResult[`tower${i}FanSpeed`] = 0;
            controlResult[`tower${i}IsolationValveClose`] = true;
            controlResult[`tower${i}IsolationValveOpen`] = false;
        }
        
        console.log(`[COOLING_TOWER] EMERGENCY SHUTDOWN: ${faultConditions.join(', ')}`);
        return { safe: false, controlResult };
    }
    
    return { safe: true };
}

// ================== STAGING AND CONTROL FUNCTIONS ==================

function performLeadTowerRotation(stateStorage) {
    const timeSinceRotation = Date.now() - stateStorage.towers.lastRotationTime;
    
    if (timeSinceRotation > COOLING_TOWER_CONFIG.WEEK_IN_MS) {
        let nextTower = stateStorage.towers.leadTower;
        let attempts = 0;
        
        do {
            nextTower = (nextTower % 3) + 1;
            attempts++;
        } while (!COOLING_TOWER_CONFIG[`TOWER_${nextTower}_AVAILABLE`] && attempts < 3);
        
        if (COOLING_TOWER_CONFIG[`TOWER_${nextTower}_AVAILABLE`]) {
            stateStorage.towers.leadTower = nextTower;
            stateStorage.towers.lastRotationTime = Date.now();
            console.log(`[COOLING_TOWER] Weekly lead tower rotation to Tower ${nextTower} (ID: ${EQUIPMENT_IDS[`COOLING_TOWER_${nextTower}`]})`);
        }
    }
}

function calculateStaging(sensorData, stateStorage) {
    const deltaT = sensorData.temps.hpSupply - sensorData.targetSetpoint;
    
    let demandedTowers = 0;
    let coolingDemand = 0;
    
    // Check if any tower is currently running
    const anyTowerRunning = isAnyTowerCurrentlyRunning(stateStorage);
    
    // Critical shutdown conditions
    if (deltaT < -15 || sensorData.temps.hpSupply < 65 || sensorData.temps.towerSupply < 50) {
        demandedTowers = 0;
        coolingDemand = 0;
        console.log(`[COOLING_TOWER] SHUTDOWN: DeltaT=${deltaT.toFixed(1)}°F, HP=${sensorData.temps.hpSupply.toFixed(1)}°F, Tower=${sensorData.temps.towerSupply.toFixed(1)}°F`);
    }
    // Continue operation if already running
    else if (anyTowerRunning && deltaT >= -5) {
        demandedTowers = Math.max(1, getCurrentlyRunningTowerCount(stateStorage));
        coolingDemand = Math.max(28, Math.min(100, 28 + (deltaT * 3)));
        console.log(`[COOLING_TOWER] Continuing operation - deltaT=${deltaT.toFixed(1)}°F, demand=${coolingDemand}%`);
    }
    // Start operation based on staging thresholds
    else if (deltaT >= COOLING_TOWER_CONFIG.STAGE_1_DELTA_T) {
        if (deltaT >= COOLING_TOWER_CONFIG.STAGE_4_DELTA_T) {
            demandedTowers = 3;
            coolingDemand = 100;
            console.log(`[COOLING_TOWER] Stage 4 - deltaT=${deltaT.toFixed(1)}°F, 3 towers at high speed`);
        } else if (deltaT >= COOLING_TOWER_CONFIG.STAGE_3_DELTA_T) {
            demandedTowers = 3;
            coolingDemand = 75;
            console.log(`[COOLING_TOWER] Stage 3 - deltaT=${deltaT.toFixed(1)}°F, 3 towers running`);
        } else if (deltaT >= COOLING_TOWER_CONFIG.STAGE_2_DELTA_T) {
            demandedTowers = 2;
            coolingDemand = 60;
            console.log(`[COOLING_TOWER] Stage 2 - deltaT=${deltaT.toFixed(1)}°F, 2 towers running`);
        } else {
            demandedTowers = 1;
            coolingDemand = Math.max(28, Math.min(50, 28 + ((deltaT - 10) * 2)));
            console.log(`[COOLING_TOWER] Stage 1 - deltaT=${deltaT.toFixed(1)}°F, lead tower at ${coolingDemand}% demand`);
        }
    } else {
        console.log(`[COOLING_TOWER] Below start threshold - deltaT=${deltaT.toFixed(1)}°F < ${COOLING_TOWER_CONFIG.STAGE_1_DELTA_T}°F, towers OFF`);
    }
    
    return {
        demandedTowers,
        coolingDemand,
        deltaT,
        leadTower: stateStorage.towers.leadTower,
        lagTowers: [(stateStorage.towers.leadTower % 3) + 1, ((stateStorage.towers.leadTower + 1) % 3) + 1]
    };
}

function isAnyTowerCurrentlyRunning(stateStorage) {
    return stateStorage.towers.timers.tower1.startTime !== null ||
           stateStorage.towers.timers.tower2.startTime !== null ||
           stateStorage.towers.timers.tower3.startTime !== null;
}

function getCurrentlyRunningTowerCount(stateStorage) {
    let count = 0;
    if (stateStorage.towers.timers.tower1.startTime) count++;
    if (stateStorage.towers.timers.tower2.startTime) count++;
    if (stateStorage.towers.timers.tower3.startTime) count++;
    return count;
}

function controlTowers(stagingDecision, sensorData, stateStorage, controlResult) {
    const { demandedTowers, coolingDemand, leadTower, lagTowers } = stagingDecision;
    
    // Reset all towers first
    for (let i = 1; i <= 3; i++) {
        controlResult[`tower${i}VFDEnable`] = false;
        controlResult[`tower${i}FanSpeed`] = 0;
        controlResult[`tower${i}IsolationValveOpen`] = false;
        controlResult[`tower${i}IsolationValveClose`] = true;
    }
    
    // Determine which towers to enable
    const towersToEnable = [];
    if (demandedTowers >= 1) towersToEnable.push(leadTower);
    if (demandedTowers >= 2) towersToEnable.push(lagTowers[0]);
    if (demandedTowers >= 3) towersToEnable.push(lagTowers[1]);
    
    // Enable towers that are available and not blocked by timing constraints
    towersToEnable.forEach(towerNum => {
        if (canEnableTower(towerNum, stateStorage)) {
            enableTower(towerNum, coolingDemand, sensorData, stateStorage, controlResult);
        } else {
            console.log(`[COOLING_TOWER] Tower ${towerNum} blocked or unavailable`);
        }
    });
    
    // Enforce minimum runtime requirements
    enforceMinimumRuntimes(sensorData, stateStorage, controlResult);
    
    // Update control result summary
    controlResult.leadTower = leadTower;
    controlResult.activeTowers = demandedTowers;
    controlResult.coolingDemand = coolingDemand;
}

function canEnableTower(towerNum, stateStorage) {
    // Check availability
    if (!COOLING_TOWER_CONFIG[`TOWER_${towerNum}_AVAILABLE`]) {
        return false;
    }
    
    // Check minimum OFF time
    const timer = stateStorage.towers.timers[`tower${towerNum}`];
    if (timer.stopTime) {
        const timeSinceStop = (Date.now() - timer.stopTime) / 1000;
        if (timeSinceStop < 180) { // 3-minute minimum OFF time
            console.log(`[COOLING_TOWER] Tower ${towerNum} in OFF time cooldown: ${(180 - timeSinceStop).toFixed(0)}s remaining`);
            return false;
        }
    }
    
    return true;
}

function enableTower(towerNum, coolingDemand, sensorData, stateStorage, controlResult) {
    controlResult[`tower${towerNum}VFDEnable`] = true;
    controlResult[`tower${towerNum}IsolationValveOpen`] = true;
    controlResult[`tower${towerNum}IsolationValveClose`] = false;
    
    // Initialize startup timer if not already running
    const timer = stateStorage.towers.timers[`tower${towerNum}`];
    if (!timer.startTime) {
        timer.startTime = Date.now();
        timer.stopTime = null;
        console.log(`[COOLING_TOWER] Tower ${towerNum} startup timer initialized - 7-minute minimum runtime started`);
    }
    
    // Calculate and apply speed
    const speed = calculateTowerSpeed(towerNum, coolingDemand, sensorData, stateStorage);
    controlResult[`tower${towerNum}FanSpeed`] = speed;
}

function calculateTowerSpeed(towerNum, coolingDemand, sensorData, stateStorage) {
    const timer = stateStorage.towers.timers[`tower${towerNum}`];
    const pidState = stateStorage.pidStates[`tower${towerNum}`];
    const rampState = stateStorage.towers.speedRamping[`tower${towerNum}`];
    
    // During first 7 minutes, force minimum speed
    if (timer.startTime) {
        const timeSinceStartup = (Date.now() - timer.startTime) / 1000;
        if (timeSinceStartup < 420) { // 7 minutes
            console.log(`[COOLING_TOWER] Tower ${towerNum} STARTUP: FORCING ${COOLING_TOWER_CONFIG.VFD_MIN_SPEED}V for ${(420 - timeSinceStartup).toFixed(0)}s more`);
            return COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
        }
    }
    
    // If very close to setpoint, maintain minimum speed
    if (Math.abs(sensorData.temps.hpSupply - sensorData.targetSetpoint) < 2) {
        console.log(`[COOLING_TOWER] Tower ${towerNum} MAINTAINING: Within 2°F of setpoint, staying at MIN ${COOLING_TOWER_CONFIG.VFD_MIN_SPEED}V`);
        return COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
    }
    
    let targetSpeed = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
    
    // Use PID controller if available
    if (pidControllerImproved) {
        try {
            const pidResult = pidControllerImproved({
                input: sensorData.temps.hpSupply,
                setpoint: sensorData.targetSetpoint,
                pidParams: {},
                dt: 15,
                controllerType: `tower${towerNum}_vfd`,
                pidState: pidState,
                equipmentId: 'cooling_tower'
            });
            
            targetSpeed = pidResult.output;
            console.log(`[COOLING_TOWER] Tower ${towerNum} PID: Setpoint=${sensorData.targetSetpoint}°F, Actual=${sensorData.temps.hpSupply.toFixed(1)}°F, Output=${targetSpeed.toFixed(2)}V`);
        } catch (e) {
            console.log(`[COOLING_TOWER] Tower ${towerNum} PID error, using fallback: ${e.message}`);
            targetSpeed = calculateFallbackSpeed(coolingDemand, pidState);
        }
    } else {
        // Fallback control
        targetSpeed = calculateFallbackSpeed(coolingDemand, pidState);
    }
    
    // Apply ramping to prevent sudden speed changes
    return applySpeedRamping(targetSpeed, rampState);
}

function calculateFallbackSpeed(coolingDemand, pidState) {
    // Simple proportional control based on cooling demand
    let speed = pidState.lastOutput || COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
    
    if (coolingDemand > 50) {
        speed = Math.min(speed + 0.1, COOLING_TOWER_CONFIG.VFD_MAX_SPEED);
    } else if (coolingDemand < 30) {
        speed = Math.max(speed - 0.1, COOLING_TOWER_CONFIG.VFD_MIN_SPEED);
    }
    
    pidState.lastOutput = speed;
    return speed;
}

function applySpeedRamping(targetSpeed, rampState) {
    const now = Date.now();
    const timeSinceLastChange = now - rampState.lastChange;
    const minRampTime = 15000; // 15 seconds between changes
    
    // Initialize if first run
    if (rampState.currentSpeed === 0) {
        rampState.currentSpeed = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
        rampState.lastChange = now;
    }
    
    // Check if enough time has passed for next ramp step
    if (timeSinceLastChange >= minRampTime) {
        const maxStep = 0.3; // Max 0.3V change per step
        const difference = targetSpeed - rampState.currentSpeed;
        
        if (Math.abs(difference) > 0.1) {
            const step = Math.sign(difference) * Math.min(Math.abs(difference), maxStep);
            rampState.currentSpeed += step;
            rampState.lastChange = now;
        }
    }
    
    rampState.targetSpeed = targetSpeed;
    return Math.max(COOLING_TOWER_CONFIG.VFD_MIN_SPEED, Math.min(COOLING_TOWER_CONFIG.VFD_MAX_SPEED, rampState.currentSpeed));
}

function enforceMinimumRuntimes(sensorData, stateStorage, controlResult) {
    const deltaT = sensorData.temps.hpSupply - sensorData.targetSetpoint;
    
    for (let i = 1; i <= 3; i++) {
        const timer = stateStorage.towers.timers[`tower${i}`];
        
        // If tower has startup timer but control logic wants it off
        if (timer.startTime && !controlResult[`tower${i}VFDEnable`]) {
            const runtimeSeconds = (Date.now() - timer.startTime) / 1000;
            
            if (runtimeSeconds < 420) { // 7-minute minimum not met
                console.log(`[COOLING_TOWER] Tower ${i} MINIMUM RUNTIME: Forcing ON for ${(420 - runtimeSeconds).toFixed(0)}s more`);
                controlResult[`tower${i}VFDEnable`] = true;
                controlResult[`tower${i}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
                controlResult[`tower${i}IsolationValveOpen`] = true;
                controlResult[`tower${i}IsolationValveClose`] = false;
            } else if (deltaT < -10) { // Allow shutdown only if well below setpoint
                console.log(`[COOLING_TOWER] Tower ${i} completed minimum runtime, conditions allow shutdown`);
                timer.startTime = null;
                timer.stopTime = Date.now();
            } else {
                // Keep running - conditions still require cooling
                console.log(`[COOLING_TOWER] Tower ${i} completed minimum runtime but still needed (deltaT=${deltaT.toFixed(1)}°F)`);
                controlResult[`tower${i}VFDEnable`] = true;
                controlResult[`tower${i}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_MIN_SPEED;
                controlResult[`tower${i}IsolationValveOpen`] = true;
                controlResult[`tower${i}IsolationValveClose`] = false;
            }
        }
    }
}

function controlPumps(sensorData, stateStorage, controlResult) {
    if (COOLING_TOWER_CONFIG.BYPASS_PUMP_STATUS) {
        // Simple operation if pump monitoring bypassed
        controlResult.pump1Enable = true;
        return;
    }
    
    const currentTime = Date.now();
    const pumpState = stateStorage.pumps;
    
    // Handle pump changeover if in progress
    if (pumpState.changeoverState) {
        const elapsed = currentTime - pumpState.changeoverState.startTime;
        
        if (elapsed < COOLING_TOWER_CONFIG.PUMP_CHANGEOVER_OVERLAP_MS) {
            // During overlap - run both pumps
            controlResult[`pump${pumpState.activePump}Enable`] = true;
            controlResult[`pump${pumpState.changeoverState.newPump}Enable`] = true;
            console.log(`[PUMP_CONTROL] Changeover overlap: Pump ${pumpState.activePump} + Pump ${pumpState.changeoverState.newPump}`);
        } else {
            // Changeover complete
            pumpState.activePump = pumpState.changeoverState.newPump;
            pumpState.changeoverState = null;
            console.log(`[PUMP_CONTROL] Changeover complete: Now running Pump ${pumpState.activePump}`);
        }
    }
    
    // Check for pump failure - use sensorData instead of controlResult
    checkPumpFailure(sensorData, pumpState, controlResult, currentTime);
    
    // Check for weekly rotation
    checkPumpRotation(pumpState, currentTime);
    
    // Enable active pump (or both during changeover)
    if (!pumpState.changeoverState) {
        controlResult[`pump${pumpState.activePump}Enable`] = true;
    }
    
    // Update runtime tracking
    updatePumpRuntime(pumpState);
}

function checkPumpFailure(sensorData, pumpState, controlResult, currentTime) {
    // Get current directly from sensorData instead of controlResult
    const activePumpCurrent = sensorData.pumpCurrents[`pump${pumpState.activePump}`] || 0;
    const timeSinceLastFailover = currentTime - pumpState.lastFailoverTime;
    
    // Check for failure (pump should be enabled but current is low)
    const shouldBeRunning = controlResult[`pump${pumpState.activePump}Enable`] || 
                           (!pumpState.changeoverState && !COOLING_TOWER_CONFIG.BYPASS_PUMP_STATUS);
    
    if (shouldBeRunning && 
        activePumpCurrent < 10.0 && 
        timeSinceLastFailover > 30000) { // 30s debounce
        
        console.log(`[PUMP_CONTROL] Pump ${pumpState.activePump} failure detected (${activePumpCurrent.toFixed(1)}A < 10A)`);
        
        // Find next available pump
        const nextPump = findNextAvailablePump(pumpState.activePump);
        if (nextPump && COOLING_TOWER_CONFIG[`PUMP_${nextPump}_AVAILABLE`]) {
            pumpState.changeoverState = {
                newPump: nextPump,
                startTime: currentTime
            };
            pumpState.failoverCount++;
            pumpState.lastFailoverTime = currentTime;
        }
    }
}

function checkPumpRotation(pumpState, currentTime) {
    const timeSinceRotation = currentTime - pumpState.lastRotationTime;
    
    if (timeSinceRotation >= COOLING_TOWER_CONFIG.WEEK_IN_MS && !pumpState.changeoverState) {
        const nextPump = findNextAvailablePump(pumpState.activePump);
        
        if (nextPump && nextPump !== pumpState.activePump) {
            console.log(`[PUMP_CONTROL] Weekly rotation from Pump ${pumpState.activePump} to Pump ${nextPump}`);
            pumpState.changeoverState = {
                newPump: nextPump,
                startTime: currentTime
            };
            pumpState.lastRotationTime = currentTime;
        }
    }
}

function findNextAvailablePump(currentPump) {
    let nextPump = currentPump;
    let attempts = 0;
    
    do {
        nextPump = (nextPump % 3) + 1;
        attempts++;
    } while (!COOLING_TOWER_CONFIG[`PUMP_${nextPump}_AVAILABLE`] && attempts < 3);
    
    return COOLING_TOWER_CONFIG[`PUMP_${nextPump}_AVAILABLE`] ? nextPump : null;
}

function updatePumpRuntime(pumpState) {
    const runtimeIncrement = 7 / 3600000; // 7 seconds in hours
    pumpState.runtimeTracking[`pump${pumpState.activePump}`] += runtimeIncrement;
}

function controlValves(sensorData, stateStorage, controlResult, uiCommands) {
    // Manual override takes precedence
    if (uiCommands.bypassValvePosition !== undefined) {
        controlResult.bypassValvePosition = Math.max(2.0, Math.min(10.0, parseFloat(uiCommands.bypassValvePosition)));
    }
    if (uiCommands.temperingValvePosition !== undefined) {
        controlResult.temperingValvePosition = Math.max(2.0, Math.min(10.0, parseFloat(uiCommands.temperingValvePosition)));
        return;
    }
    
    // Automatic valve control only when outdoor temp < 42°F
    if (sensorData.temps.outdoor >= 42) {
        // Warm weather - all valves closed
        controlResult.bypassValvePosition = 2.0;
        controlResult.temperingValvePosition = 2.0;
        
        // Reset PID state
        stateStorage.pidStates.valve.integral = 0;
        stateStorage.pidStates.valve.lastOutput = 2.0;
        return;
    }
    
    // Cold weather - use PID for tempering valve
    const hpLoopTemp = (sensorData.temps.hpSupply + sensorData.temps.hpReturn) / 2;
    
    if (pidControllerImproved && controlResult.systemEnabled) {
        try {
            const pidResult = pidControllerImproved({
                input: hpLoopTemp,
                setpoint: 45.0,
                pidParams: {
                    kp: 2.5,
                    ki: 0.15,
                    kd: 0.05,
                    outputMin: 2.0,
                    outputMax: 10.0,
                    reverseActing: false,
                    maxIntegral: 50
                },
                dt: 7,
                controllerType: 'valve_control',
                pidState: stateStorage.pidStates.valve,
                equipmentId: 'cooling_tower'
            });
            
            let temperingPosition = pidResult.output;
            
            // Minimum tempering based on outdoor temp
            if (sensorData.temps.outdoor < 35) {
                temperingPosition = Math.max(temperingPosition, 6.8); // 60% minimum
            } else if (sensorData.temps.outdoor < 40) {
                temperingPosition = Math.max(temperingPosition, 5.2); // 40% minimum
            }
            
            // Smooth movement
            const lastPosition = stateStorage.pidStates.valve.lastOutput || 5.0;
            const maxChange = 0.4;
            if (Math.abs(temperingPosition - lastPosition) > maxChange) {
                temperingPosition = lastPosition + (temperingPosition > lastPosition ? maxChange : -maxChange);
            }
            
            controlResult.temperingValvePosition = temperingPosition;
            stateStorage.pidStates.valve.lastOutput = temperingPosition;
            
        } catch (e) {
            console.log(`[VALVE_CONTROL] PID error, using fallback: ${e.message}`);
            applyFallbackValveControl(sensorData.temps.outdoor, controlResult);
        }
    } else {
        applyFallbackValveControl(sensorData.temps.outdoor, controlResult);
    }
    
    // Bypass valve stays closed in cold weather
    controlResult.bypassValvePosition = 2.0;
}

function applyFallbackValveControl(outdoorTemp, controlResult) {
    if (outdoorTemp < 35) {
        controlResult.temperingValvePosition = 7.6; // 70% open
    } else {
        controlResult.temperingValvePosition = 6.0; // 50% open
    }
}

function controlHeaters(outdoorTemp, controlResult) {
    if (outdoorTemp < 35) {
        // Enable heaters when very cold
        controlResult.tower1HeaterEnable = true;
        controlResult.tower2HeaterEnable = true;
        controlResult.tower3HeaterEnable = true;
    } else if (outdoorTemp > 45) {
        // Disable heaters when warm
        controlResult.tower1HeaterEnable = false;
        controlResult.tower2HeaterEnable = false;
        controlResult.tower3HeaterEnable = false;
    }
    // Hysteresis between 35-45°F maintains current state
}

// ================== MONITORING AND OVERRIDE FUNCTIONS ==================

function applyCurrentAndVibrationMonitoring(sensorData, controlResult) {
    const warnings = [];
    
    // VFD current warnings
    if (!COOLING_TOWER_CONFIG.BYPASS_CURRENT_LIMITS) {
        Object.keys(sensorData.vfdCurrents).forEach(key => {
            const current = sensorData.vfdCurrents[key];
            if (current > COOLING_TOWER_CONFIG.VFD_CURRENT_WARNING && 
                current <= COOLING_TOWER_CONFIG.VFD_CURRENT_CRITICAL) {
                const towerNum = key.includes('tower1') ? '1' : key.includes('tower2') ? '2' : '3';
                warnings.push(`TOWER${towerNum}_HIGH_VFD_CURRENT_WARNING (ID: ${EQUIPMENT_IDS[`COOLING_TOWER_${towerNum}`]})`);
                
                // Reduce speed if possible
                if (controlResult[`tower${towerNum}FanSpeed`] > COOLING_TOWER_CONFIG.VFD_LOW_SPEED) {
                    controlResult[`tower${towerNum}FanSpeed`] = COOLING_TOWER_CONFIG.VFD_LOW_SPEED;
                }
            }
        });
    }
    
    // Vibration warnings
    if (!COOLING_TOWER_CONFIG.BYPASS_VIBRATION_LIMITS) {
        Object.keys(sensorData.vibration).forEach(key => {
            const level = sensorData.vibration[key];
            const towerNum = key.replace('tower', '');
            if (level > COOLING_TOWER_CONFIG.VIBRATION_WARNING_LIMIT && 
                level <= COOLING_TOWER_CONFIG.VIBRATION_CRITICAL_LIMIT) {
                warnings.push(`TOWER${towerNum}_HIGH_VIBRATION_WARNING (ID: ${EQUIPMENT_IDS[`COOLING_TOWER_${towerNum}`]})`);
            }
        });
    }
    
    // Update alarm status
    if (warnings.length > 0) {
        controlResult.alarmStatus = 'warning';
        controlResult.faultConditions.push(...warnings);
    }
}

function applyManualOverrides(uiCommands, controlResult) {
    // System level overrides
    if (uiCommands.systemEnabled !== undefined) {
        controlResult.systemEnabled = uiCommands.systemEnabled;
    }
    if (uiCommands.controlMode !== undefined) {
        controlResult.controlMode = uiCommands.controlMode;
    }
    
    // Tower overrides
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
}

function updateControlResultSummary(controlResult, stagingDecision, sensorData) {
    controlResult.leadTower = stagingDecision.leadTower;
    controlResult.activeTowers = stagingDecision.demandedTowers;
    controlResult.coolingDemand = stagingDecision.coolingDemand;
    controlResult.loopDeltaT = stagingDecision.deltaT;
    controlResult.targetSupplyTemp = sensorData.targetSetpoint;
    
    // Ensure VFDs below minimum are turned off
    for (let i = 1; i <= 3; i++) {
        if (controlResult[`tower${i}FanSpeed`] > 0 && 
            controlResult[`tower${i}FanSpeed`] < COOLING_TOWER_CONFIG.VFD_MIN_SPEED) {
            controlResult[`tower${i}FanSpeed`] = 0;
            controlResult[`tower${i}VFDEnable`] = false;
        }
    }
}

function createSafeDefaultState(error) {
    return {
        equipmentIds: EQUIPMENT_IDS,
        tower1VFDEnable: false,
        tower2VFDEnable: false,
        tower3VFDEnable: false,
        tower1FanSpeed: 0,
        tower2FanSpeed: 0,
        tower3FanSpeed: 0,
        bypassValvePosition: 2.0,
        temperingValvePosition: 2.0,
        pump1Enable: false,
        pump2Enable: false,
        pump3Enable: false,
        tower1IsolationValveClose: true,
        tower2IsolationValveClose: true,
        tower3IsolationValveClose: true,
        tower1HeaterEnable: false,
        tower2HeaterEnable: false,
        tower3HeaterEnable: false,
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

module.exports = {
    processCoolingTowerControl,
    EQUIPMENT_IDS,
    COOLING_TOWER_CONFIG
};
