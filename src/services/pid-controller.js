/**
 * PID Controller for AutomataNexus Remote Portal
 * This is the LOCAL PID controller used when in failover mode
 * PID parameters are stored in database and configurable via UI
 */

const Database = require('better-sqlite3');
const path = require('path');

// Connect to metrics database where PID configs are stored
const dbPath = path.join(__dirname, '../../data/metrics.db');
const db = new Database(dbPath);

// Create PID config table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS pid_config (
    equipment_id TEXT NOT NULL,
    controller_type TEXT NOT NULL,
    kp REAL DEFAULT 1.0,
    ki REAL DEFAULT 0.1,
    kd REAL DEFAULT 0.0,
    output_min REAL DEFAULT 0,
    output_max REAL DEFAULT 100,
    reverse_acting INTEGER DEFAULT 0,
    max_integral REAL DEFAULT 100,
    enabled INTEGER DEFAULT 1,
    PRIMARY KEY (equipment_id, controller_type)
  )
`);

// Get PID parameters from database or use defaults
function getPidParams(equipmentId, controllerType) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM pid_config 
      WHERE equipment_id = ? AND controller_type = ?
    `);
    const config = stmt.get(equipmentId, controllerType);
    
    if (config) {
      return {
        kp: config.kp,
        ki: config.ki,
        kd: config.kd,
        outputMin: config.output_min,
        outputMax: config.output_max,
        reverseActing: config.reverse_acting === 1,
        maxIntegral: config.max_integral,
        enabled: config.enabled === 1
      };
    }
  } catch (error) {
    console.error('Error reading PID config from database:', error);
  }
  
  // Return defaults based on controller type
  if (controllerType === 'heating') {
    return {
      kp: 2.8,
      ki: 0.14,
      kd: 0.02,
      outputMin: 0,
      outputMax: 100,
      reverseActing: true,
      maxIntegral: 15,
      enabled: true
    };
  } else if (controllerType === 'cooling') {
    return {
      kp: 11.7,
      ki: 4.65,
      kd: 0.01,
      outputMin: 0,
      outputMax: 100,
      reverseActing: false,
      maxIntegral: 20,
      enabled: true
    };
  } else {
    // Default for other types
    return {
      kp: 1.0,
      ki: 0.1,
      kd: 0.0,
      outputMin: 0,
      outputMax: 100,
      reverseActing: false,
      maxIntegral: 100,
      enabled: true
    };
  }
}

// Main PID controller function
function pidControllerImproved(params) {
  const { input, setpoint, pidParams, dt = 1, controllerType, pidState = {}, equipmentId } = params;
  
  // Get PID parameters from database if equipmentId provided
  let finalPidParams = pidParams;
  if (equipmentId && controllerType) {
    const dbParams = getPidParams(equipmentId, controllerType);
    // Merge database params with provided params (provided params take precedence)
    finalPidParams = { ...dbParams, ...pidParams };
  }
  
  // Initialize state if not provided
  if (!pidState.integral) pidState.integral = 0;
  if (!pidState.previousError) pidState.previousError = 0;
  if (!pidState.lastOutput) pidState.lastOutput = 0;
  
  // Calculate error
  const error = setpoint - input;
  
  // Proportional term
  const P = finalPidParams.kp * error;
  
  // Integral term with anti-windup
  pidState.integral += error * dt;
  const maxIntegral = finalPidParams.maxIntegral || 100;
  pidState.integral = Math.max(-maxIntegral, Math.min(maxIntegral, pidState.integral));
  const I = finalPidParams.ki * pidState.integral;
  
  // Derivative term
  const D = finalPidParams.kd * ((error - pidState.previousError) / dt);
  pidState.previousError = error;
  
  // Calculate raw output
  let output = P + I + D;
  
  // Apply reverse acting for heating valves (10V closed, 0V open)
  if (finalPidParams.reverseActing) {
    output = -output;
  }
  
  // Apply control type specific logic
  if (controllerType === 'heating') {
    // Heating: only output when below setpoint
    if (error < 0) output = 0;
  } else if (controllerType === 'cooling') {
    // Cooling: only output when above setpoint  
    if (error > 0) output = 0;
  }
  
  // Clamp output to configured limits
  output = Math.max(finalPidParams.outputMin || 0, Math.min(finalPidParams.outputMax || 100, output));
  
  // Store last output
  pidState.lastOutput = output;
  
  return {
    output: output,
    pidState: pidState,
    error: error,
    P: P,
    I: I,
    D: D
  };
}

// Save PID config to database (called from UI)
function savePidConfig(equipmentId, controllerType, params) {
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO pid_config 
      (equipment_id, controller_type, kp, ki, kd, output_min, output_max, reverse_acting, max_integral, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      equipmentId,
      controllerType,
      params.kp,
      params.ki,
      params.kd,
      params.outputMin || 0,
      params.outputMax || 100,
      params.reverseActing ? 1 : 0,
      params.maxIntegral || 100,
      params.enabled !== false ? 1 : 0
    );
    
    return true;
  } catch (error) {
    console.error('Error saving PID config:', error);
    return false;
  }
}

module.exports = {
  pidControllerImproved,
  getPidParams,
  savePidConfig
};