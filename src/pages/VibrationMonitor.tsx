import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  Settings,
  Trash2,
  Save,
  Plus,
  Power,
  RefreshCw,
  Thermometer,
  Eye,
  EyeOff,
  Edit2,
  Check,
  X,
  Target
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import '../styles/vibration-monitor.css';

interface VibrationSensor {
  sensor_id: string;
  equipment_name: string;
  port: string;
  modbus_id: number;
  baud_rate: number;
  alert_threshold_mms: number;
  enabled: boolean;
  baseline_velocity?: number;
  baseline_timestamp?: string;
}

interface VibrationReading {
  sensor_id: string;
  temperature_f?: number;
  velocity_mms?: number;
  velocity_x?: number;
  velocity_y?: number;
  velocity_z?: number;
  iso_zone?: string;
  alert_level?: string;
  timestamp: number;
  error?: boolean;
  errorMessage?: string;
}

const VibrationMonitor: React.FC = () => {
  const [sensors, setSensors] = useState<VibrationSensor[]>([]);
  const [readings, setReadings] = useState<Map<string, VibrationReading>>(new Map());
  const [historicalData, setHistoricalData] = useState<Map<string, any[]>>(new Map());
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const [showGraphs, setShowGraphs] = useState<Map<string, boolean>>(new Map());
  const [editingName, setEditingName] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [selectedSensor, setSelectedSensor] = useState<string | null>(null);
  const [showRelative, setShowRelative] = useState<Map<string, boolean>>(new Map());
  const [pendingThresholdUpdates, setPendingThresholdUpdates] = useState<Map<string, number>>(new Map());

  // ISO 10816-3 Zone thresholds
  const ISO_ZONES = {
    A: { max: 2.8, color: '#10b981', label: 'Good' },
    B: { max: 7.1, color: '#f59e0b', label: 'Acceptable' },
    C: { max: 11.0, color: '#ef4444', label: 'Unsatisfactory' },
    D: { max: Infinity, color: '#dc2626', label: 'Unacceptable' }
  };

  // Fetch sensor configurations
  const fetchSensors = useCallback(async () => {
    try {
      const response = await fetch('/api/vibration/configs');
      if (!response.ok) {
        console.error('Failed to fetch sensors:', response.status);
        return;
      }
      const data = await response.json();

      // Ensure data is an array
      const sensorsArray = Array.isArray(data) ? data : [];
      setSensors(sensorsArray);

      // Initialize graph visibility
      const graphVisibility = new Map();
      sensorsArray.forEach((sensor: VibrationSensor) => {
        graphVisibility.set(sensor.sensor_id, true);
      });
      setShowGraphs(graphVisibility);
    } catch (error) {
      console.error('Error fetching sensors:', error);
    }
  }, []);

  // Fetch available ports
  const fetchPorts = useCallback(async () => {
    try {
      const response = await fetch('/api/vibration/ports');
      if (!response.ok) return;
      const data = await response.json();
      setAvailablePorts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching ports:', error);
    }
  }, []);

  // Fetch current readings
  const fetchReadings = useCallback(async () => {
    try {
      console.log('Fetching vibration readings...');
      const response = await fetch('/api/vibration/readings');
      if (!response.ok) {
        console.warn('Vibration readings not available:', response.status);
        return;
      }
      const data = await response.json();
      console.log('Received readings:', data);

      const readingsMap = new Map();
      // Handle both object and array formats
      if (typeof data === 'object' && !Array.isArray(data)) {
        // Object format: {sensor_id: reading, ...}
        Object.entries(data).forEach(([sensorId, reading]: [string, any]) => {
          readingsMap.set(sensorId, reading);
        });
      } else if (Array.isArray(data)) {
        // Array format
        data.forEach((reading: VibrationReading) => {
          readingsMap.set(reading.sensor_id, reading);
        });
      }
      setReadings(readingsMap);
    } catch (error) {
      console.warn('Vibration readings unavailable:', error);
      // Don't throw error, just log it
    }
  }, []);

  // Fetch historical data for graphs
  const fetchHistoricalData = useCallback(async (sensorId: string) => {
    try {
      const response = await fetch(`/api/vibration/history/${sensorId}?hours=8`);
      const data = await response.json();

      // Format data for Recharts
      const formatted = data.map((point: any) => ({
        time: new Date(point.timestamp).toLocaleTimeString(),
        velocity: point.velocity_mms,
        temperature: point.temperature_f,
        x: point.velocity_x,
        y: point.velocity_y,
        z: point.velocity_z
      }));

      setHistoricalData(prev => {
        const newMap = new Map(prev);
        newMap.set(sensorId, formatted);
        return newMap;
      });
    } catch (error) {
      console.error('Error fetching historical data:', error);
    }
  }, []);

  // Add new sensor
  const addSensor = async () => {
    const sensorId = `sensor_${Date.now()}`;
    const newSensor: VibrationSensor = {
      sensor_id: sensorId,
      equipment_name: `Sensor ${sensors.length + 1}`,
      port: availablePorts[0] || '/dev/ttyUSB0',
      modbus_id: 0x50, // Default address
      baud_rate: 9600,
      alert_threshold_mms: 7.1,
      enabled: false
    };

    try {
      const token = sessionStorage.getItem('authToken');
      const response = await fetch('/api/vibration/configs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newSensor)
      });

      if (response.ok) {
        await fetchSensors();
        setSaveStatus('Sensor added successfully');
        setTimeout(() => setSaveStatus(''), 3000);
        // Auto-open name editing for the new sensor
        setEditingName(sensorId);
        setNewName(`Sensor ${sensors.length + 1}`);
      }
    } catch (error) {
      console.error('Error adding sensor:', error);
      setSaveStatus('Error adding sensor');
    }
  };

  // Update sensor configuration
  const updateSensor = async (sensor: VibrationSensor) => {
    try {
      const token = sessionStorage.getItem('authToken');
      const response = await fetch(`/api/vibration/configs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(sensor)
      });

      if (response.ok) {
        await fetchSensors();
        setSaveStatus('Configuration saved');
        setTimeout(() => setSaveStatus(''), 3000);
      }
    } catch (error) {
      console.error('Error updating sensor:', error);
      setSaveStatus('Error saving configuration');
    }
  };

  // Delete sensor
  const deleteSensor = async (sensorId: string) => {
    if (!confirm('Are you sure you want to delete this sensor?')) return;

    try {
      const token = sessionStorage.getItem('authToken');
      const response = await fetch(`/api/vibration/configs/${sensorId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        // Remove from local state immediately
        setSensors(prev => prev.filter(s => s.sensor_id !== sensorId));
        setReadings(prev => {
          const newMap = new Map(prev);
          newMap.delete(sensorId);
          return newMap;
        });
        setHistoricalData(prev => {
          const newMap = new Map(prev);
          newMap.delete(sensorId);
          return newMap;
        });
        setShowGraphs(prev => {
          const newMap = new Map(prev);
          newMap.delete(sensorId);
          return newMap;
        });
        setSaveStatus('Sensor deleted');
        setTimeout(() => setSaveStatus(''), 3000);
      }
    } catch (error) {
      console.error('Error deleting sensor:', error);
      setSaveStatus('Error deleting sensor');
    }
  };

  // Toggle sensor enabled state
  const toggleSensor = async (sensor: VibrationSensor) => {
    const updated = { ...sensor, enabled: !sensor.enabled };
    await updateSensor(updated);
  };

  // Update sensor name
  const updateSensorName = async (sensor: VibrationSensor, name: string) => {
    const updated = { ...sensor, equipment_name: name };
    await updateSensor(updated);
    setEditingName(null);
    setNewName('');
  };

  // Toggle graph visibility
  const toggleGraph = (sensorId: string) => {
    setShowGraphs(prev => {
      const newMap = new Map(prev);
      const newValue = !prev.get(sensorId);
      newMap.set(sensorId, newValue);

      // Fetch historical data when graph is turned on
      if (newValue) {
        fetchHistoricalData(sensorId);
      }

      return newMap;
    });
  };

  // Capture baseline reading
  const captureBaseline = async (sensor: VibrationSensor) => {
    const reading = readings.get(sensor.sensor_id);
    if (!reading) {
      setSaveStatus('No reading available to capture');
      setTimeout(() => setSaveStatus(''), 3000);
      return;
    }

    const updated = {
      ...sensor,
      baseline_velocity: reading.velocity_mms || 0,
      baseline_timestamp: new Date().toISOString()
    };

    try {
      const token = sessionStorage.getItem('authToken');
      const response = await fetch(`/api/vibration/baseline/${sensor.sensor_id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          baseline_velocity: reading.velocity_mms || 0,
          baseline_timestamp: new Date().toISOString()
        })
      });

      if (response.ok) {
        // Update local state
        setSensors(prev => prev.map(s =>
          s.sensor_id === sensor.sensor_id ? updated : s
        ));
        setSaveStatus(`Baseline captured: ${(reading.velocity_mms || 0).toFixed(2)} mm/s`);
        setTimeout(() => setSaveStatus(''), 3000);
      }
    } catch (error) {
      console.error('Error capturing baseline:', error);
      setSaveStatus('Error capturing baseline');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  // Clear baseline
  const clearBaseline = async (sensor: VibrationSensor) => {
    const updated = {
      ...sensor,
      baseline_velocity: undefined,
      baseline_timestamp: undefined
    };

    try {
      const token = sessionStorage.getItem('authToken');
      const response = await fetch(`/api/vibration/baseline/${sensor.sensor_id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        setSensors(prev => prev.map(s =>
          s.sensor_id === sensor.sensor_id ? updated : s
        ));
        setSaveStatus('Baseline cleared');
        setTimeout(() => setSaveStatus(''), 3000);
      }
    } catch (error) {
      console.error('Error clearing baseline:', error);
      setSaveStatus('Error clearing baseline');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  // Toggle relative display
  const toggleRelative = (sensorId: string) => {
    setShowRelative(prev => {
      const newMap = new Map(prev);
      newMap.set(sensorId, !prev.get(sensorId));
      return newMap;
    });
  };

  // Get zone color based on velocity
  const getZoneColor = (velocity: number) => {
    if (velocity <= ISO_ZONES.A.max) return ISO_ZONES.A.color;
    if (velocity <= ISO_ZONES.B.max) return ISO_ZONES.B.color;
    if (velocity <= ISO_ZONES.C.max) return ISO_ZONES.C.color;
    return ISO_ZONES.D.color;
  };

  // Get alert icon based on level
  const getAlertIcon = (level: string) => {
    switch (level) {
      case 'Good':
        return <Activity className="w-5 h-5 text-green-500" />;
      case 'Acceptable':
        return <Activity className="w-5 h-5 text-yellow-500" />;
      case 'Warning':
        return <AlertTriangle className="w-5 h-5 text-orange-500" />;
      case 'Unsatisfactory':
      case 'Unacceptable':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      default:
        return <Activity className="w-5 h-5 text-gray-500" />;
    }
  };

  useEffect(() => {
    fetchSensors();
    fetchPorts();
    // Fetch readings once on load
    fetchReadings();

    // Disable polling completely
    // const interval = setInterval(() => {
    //   fetchReadings();
    // }, 120000);

    // return () => clearInterval(interval);
  }, []); // Only run once on mount

  useEffect(() => {
    // Disable all historical data fetching to prevent freezing
    // const historicalInterval = setInterval(() => {
    //   sensors.forEach(sensor => {
    //     if (sensor.enabled && showGraphs.get(sensor.sensor_id)) {
    //       fetchHistoricalData(sensor.sensor_id);
    //     }
    //   });
    // }, 120000);

    // Disable initial fetch for enabled sensors
    // sensors.forEach(sensor => {
    //   if (sensor.enabled && showGraphs.get(sensor.sensor_id)) {
    //     fetchHistoricalData(sensor.sensor_id);
    //   }
    // });

    // return () => clearInterval(historicalInterval);
  }, [sensors, showGraphs]);

  return (
    <div className="vibration-monitor">
      <div className="page-header">
        <div className="header-left">
          <Activity className="w-8 h-8 text-cyan-400" />
          <h1>Vibration Monitoring System</h1>
        </div>
        <div className="header-right">
          <button onClick={fetchReadings} className="btn-secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh Readings
          </button>
          <button onClick={fetchPorts} className="btn-secondary">
            <RefreshCw className="w-4 h-4" />
            Scan Ports
          </button>
          <button onClick={addSensor} className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Sensor
          </button>
          {saveStatus && (
            <span className={`save-status ${saveStatus.includes('Error') ? 'error' : 'success'}`}>
              {saveStatus}
            </span>
          )}
        </div>
      </div>

      <div className="sensors-grid">
        {sensors.map(sensor => {
          const reading = readings.get(sensor.sensor_id);
          const history = historicalData.get(sensor.sensor_id) || [];
          const showGraph = showGraphs.get(sensor.sensor_id) || false;

          return (
            <div key={sensor.sensor_id} className={`sensor-card ${!sensor.enabled ? 'disabled' : ''}`}>
              <div className="sensor-header">
                <div className="sensor-title">
                  {editingName === sensor.sensor_id ? (
                    <div className="name-edit">
                      <input
                        type="text"
                        value={newName || sensor.equipment_name}
                        onChange={(e) => setNewName(e.target.value)}
                        autoFocus
                      />
                      <button
                        onClick={() => updateSensorName(sensor, newName || sensor.equipment_name)}
                        className="btn-icon"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setEditingName(null);
                          setNewName('');
                        }}
                        className="btn-icon"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="name-display">
                      <h3>{sensor.equipment_name}</h3>
                      <button
                        onClick={() => {
                          setEditingName(sensor.sensor_id);
                          setNewName(sensor.equipment_name);
                        }}
                        className="btn-icon"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <span className="sensor-port">{sensor.port}</span>
                </div>
                <div className="sensor-controls">
                  <button
                    onClick={() => toggleGraph(sensor.sensor_id)}
                    className="btn-icon"
                    title={showGraph ? 'Hide Graph' : 'Show Graph'}
                  >
                    {showGraph ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => toggleSensor(sensor)}
                    className={`btn-icon ${sensor.enabled ? 'active' : ''}`}
                    title={sensor.enabled ? 'Disable' : 'Enable'}
                  >
                    <Power className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setSelectedSensor(sensor.sensor_id)}
                    className="btn-icon"
                    title="Settings"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteSensor(sensor.sensor_id)}
                    className="btn-icon danger"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Threshold Control */}
              <div className="threshold-control">
                <label>Alert Threshold:</label>
                <input
                  type="number"
                  step="0.1"
                  className="threshold-input"
                  value={pendingThresholdUpdates.get(sensor.sensor_id) ?? sensor.alert_threshold_mms}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value) || 7.1;
                    setPendingThresholdUpdates(prev => {
                      const newMap = new Map(prev);
                      newMap.set(sensor.sensor_id, value);
                      return newMap;
                    });
                    // Update locally for immediate feedback
                    const updated = sensors.map(s =>
                      s.sensor_id === sensor.sensor_id
                        ? { ...s, alert_threshold_mms: value }
                        : s
                    );
                    setSensors(updated);
                  }}
                  onBlur={() => {
                    // Save on blur
                    if (pendingThresholdUpdates.has(sensor.sensor_id)) {
                      updateSensor(sensor);
                      setPendingThresholdUpdates(prev => {
                        const newMap = new Map(prev);
                        newMap.delete(sensor.sensor_id);
                        return newMap;
                      });
                    }
                  }}
                />
                <span style={{ color: '#6b7280', fontSize: '14px' }}>mm/s</span>
              </div>

              {/* Baseline Control */}
              <div className="baseline-control">
                <button
                  className="baseline-btn"
                  onClick={() => captureBaseline(sensor)}
                  disabled={!reading}
                  title="Capture current reading as baseline"
                >
                  <Target className="w-3 h-3" />
                  Set Baseline
                </button>
                {sensor.baseline_velocity !== undefined && sensor.baseline_velocity !== null && (
                  <>
                    <span className="baseline-info">
                      Baseline: {sensor.baseline_velocity.toFixed(2)} mm/s
                    </span>
                    <button
                      className="baseline-clear-btn"
                      onClick={() => clearBaseline(sensor)}
                      title="Clear baseline"
                    >
                      Clear
                    </button>
                    <label className="relative-toggle">
                      <input
                        type="checkbox"
                        checked={showRelative.get(sensor.sensor_id) || false}
                        onChange={() => toggleRelative(sensor.sensor_id)}
                      />
                      <span>Show Relative</span>
                    </label>
                  </>
                )}
              </div>

              {reading ? (
                reading.error ? (
                  <div className="sensor-error">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    <span className="error-message">{reading.errorMessage || 'Sensor connection failed'}</span>
                    <small>Check USB connection and port configuration</small>
                  </div>
                ) : (
                  <div className="sensor-readings">
                    <div className="reading-grid">
                      <div className="reading-item">
                        <span className="label">Velocity</span>
                        <span
                          className="value large"
                          style={{ color: getZoneColor(reading.velocity_mms || 0) }}
                        >
                          {showRelative.get(sensor.sensor_id) && sensor.baseline_velocity !== undefined
                            ? `${((reading.velocity_mms || 0) - sensor.baseline_velocity >= 0 ? '+' : '')}${((reading.velocity_mms || 0) - sensor.baseline_velocity).toFixed(2)} mm/s`
                            : `${(reading.velocity_mms || 0).toFixed(2)} mm/s`}
                        </span>
                        {showRelative.get(sensor.sensor_id) && sensor.baseline_velocity !== undefined && (
                          <span className="baseline-reference">
                            (Actual: {(reading.velocity_mms || 0).toFixed(2)})
                          </span>
                        )}
                      </div>
                      <div className="reading-item">
                        <span className="label">Temperature</span>
                        <span className="value">
                          <Thermometer className="w-4 h-4 inline" />
                          {(reading.temperature_f || 0).toFixed(1)}°F
                        </span>
                      </div>
                      <div className="reading-item">
                        <span className="label">ISO Zone</span>
                        <span className={`iso-zone zone-${reading.iso_zone || 'unknown'}`}>
                          {reading.iso_zone || 'Unknown'}
                        </span>
                      </div>
                      <div className="reading-item">
                        <span className="label">Status</span>
                        <div className="status">
                          {getAlertIcon(reading.alert_level || 'Unknown')}
                          <span>{reading.alert_level || 'Unknown'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="axis-readings">
                      <div className="axis">
                        <span>X: {reading.velocity_x?.toFixed(2) || '0.00'}</span>
                      </div>
                      <div className="axis">
                        <span>Y: {reading.velocity_y?.toFixed(2) || '0.00'}</span>
                      </div>
                      <div className="axis">
                        <span>Z: {reading.velocity_z?.toFixed(2) || '0.00'}</span>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="sensor-no-data">
                  <Activity className="w-5 h-5 text-gray-400" />
                  <span>{sensor.enabled ? 'Waiting for data...' : 'Sensor disabled'}</span>
                </div>
              )}

              {showGraph && sensor.enabled && history.length > 0 && (
                <div className="sensor-graph">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="time"
                        stroke="#9ca3af"
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fontSize: 10 }}
                        domain={[0, 15]}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'white',
                          border: '1px solid #e5e7eb'
                        }}
                      />
                      <Legend />

                      {/* ISO Zone reference lines */}
                      <ReferenceLine
                        y={2.8}
                        stroke="#10b981"
                        strokeDasharray="5 5"
                        label="Zone A"
                      />
                      <ReferenceLine
                        y={7.1}
                        stroke="#f59e0b"
                        strokeDasharray="5 5"
                        label="Zone B"
                      />
                      <ReferenceLine
                        y={11.0}
                        stroke="#ef4444"
                        strokeDasharray="5 5"
                        label="Zone C"
                      />
                      <ReferenceLine
                        y={sensor.alert_threshold_mms}
                        stroke="#dc2626"
                        strokeWidth={2}
                        label="Alert"
                      />

                      <Line
                        type="monotone"
                        dataKey="velocity"
                        stroke="#06b6d4"
                        strokeWidth={2}
                        dot={false}
                        name="RMS Velocity"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="x"
                        stroke="#8b5cf6"
                        strokeWidth={1}
                        dot={false}
                        name="X-axis"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="y"
                        stroke="#ec4899"
                        strokeWidth={1}
                        dot={false}
                        name="Y-axis"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="z"
                        stroke="#10b981"
                        strokeWidth={1}
                        dot={false}
                        name="Z-axis"
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Settings Modal */}
      {selectedSensor && (
        <div className="modal-overlay" onClick={() => setSelectedSensor(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Sensor Configuration</h2>
              <button onClick={() => setSelectedSensor(null)} className="btn-icon">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="modal-body">
              {sensors.find(s => s.sensor_id === selectedSensor) && (
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const sensor = sensors.find(s => s.sensor_id === selectedSensor)!;
                  updateSensor(sensor);
                  setSelectedSensor(null);
                }}>
                  {(() => {
                    const sensor = sensors.find(s => s.sensor_id === selectedSensor)!;
                    return (
                      <>
                        <div className="form-group">
                          <label>Equipment Name</label>
                          <input
                            type="text"
                            value={sensor.equipment_name}
                            onChange={(e) => {
                              const updated = sensors.map(s =>
                                s.sensor_id === selectedSensor
                                  ? { ...s, equipment_name: e.target.value }
                                  : s
                              );
                              setSensors(updated);
                            }}
                          />
                        </div>
                        <div className="form-group">
                          <label>Port</label>
                          <select
                            value={sensor.port}
                            onChange={(e) => {
                              const updated = sensors.map(s =>
                                s.sensor_id === selectedSensor
                                  ? { ...s, port: e.target.value }
                                  : s
                              );
                              setSensors(updated);
                            }}
                          >
                            {availablePorts.map(port => (
                              <option key={port} value={port}>{port}</option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Modbus Address (Hex)</label>
                          <input
                            type="text"
                            value={`0x${sensor.modbus_id.toString(16).toUpperCase()}`}
                            onChange={(e) => {
                              const value = parseInt(e.target.value, 16);
                              if (!isNaN(value)) {
                                const updated = sensors.map(s =>
                                  s.sensor_id === selectedSensor
                                    ? { ...s, modbus_id: value }
                                    : s
                                );
                                setSensors(updated);
                              }
                            }}
                          />
                        </div>
                        <div className="form-group">
                          <label>Baud Rate</label>
                          <select
                            value={sensor.baud_rate}
                            onChange={(e) => {
                              const updated = sensors.map(s =>
                                s.sensor_id === selectedSensor
                                  ? { ...s, baud_rate: parseInt(e.target.value) }
                                  : s
                              );
                              setSensors(updated);
                            }}
                          >
                            <option value="9600">9600</option>
                            <option value="19200">19200</option>
                            <option value="38400">38400</option>
                            <option value="57600">57600</option>
                            <option value="115200">115200</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Alert Threshold (mm/s)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={sensor.alert_threshold_mms}
                            onChange={(e) => {
                              const updated = sensors.map(s =>
                                s.sensor_id === selectedSensor
                                  ? { ...s, alert_threshold_mms: parseFloat(e.target.value) }
                                  : s
                              );
                              setSensors(updated);
                            }}
                          />
                          <small>ISO 10816-3: Zone B=7.1, Zone C=11.0</small>
                        </div>
                        <div className="form-actions">
                          <button type="submit" className="btn-primary">
                            <Save className="w-4 h-4" />
                            Save Configuration
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedSensor(null)}
                            className="btn-secondary"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VibrationMonitor;