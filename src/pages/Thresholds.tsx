import React, { useState, useEffect } from 'react';
import { Switch } from '../components/ui/switch';
import { Button } from '../components/ui/button';
import './Thresholds.css';

interface Threshold {
  id: string;
  name: string;
  parameter: string;
  minValue: number;
  maxValue: number;
  unit: string;
  enabled: boolean;
  alarmType: 'warning' | 'critical';
}

interface ConfiguredSensor {
  key: string;
  name: string;
  unit: string;
  type: 'temperature' | 'current' | 'voltage' | 'other';
}

const Thresholds: React.FC = () => {
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [availableSensors, setAvailableSensors] = useState<ConfiguredSensor[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoardConfigs();
    fetchThresholds();
  }, []);

  const fetchBoardConfigs = async () => {
    try {
      // Get board configurations to know what sensors are available
      const token = sessionStorage.getItem('authToken');
      const response = await fetch('/api/logic/boards', {
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        const boardConfigs = await response.json();
        const sensors: ConfiguredSensor[] = [];
        
        // Always add setpoint as it's a system parameter
        sensors.push({
          key: 'setpoint',
          name: 'Temperature Setpoint',
          unit: '°F',
          type: 'temperature'
        });
        
        // Process each board configuration
        boardConfigs.forEach((board: any) => {
          if (board.enabled && board.inputs) {
            Object.entries(board.inputs).forEach(([, input]: [string, any]) => {
              if (input && input.enabled && input.name) {
                // Create a sanitized key from the name
                const sensorKey = input.name.toLowerCase()
                  .replace(/[^a-z0-9]+/g, '_')
                  .replace(/^_|_$/g, '');
                
                // Determine unit and type based on conversion type and name
                let unit = '';
                let type: 'temperature' | 'current' | 'voltage' | 'other' = 'other';
                
                if (input.conversionType === 'temperature' || 
                    input.name.toLowerCase().includes('temp')) {
                  unit = '°F';
                  type = 'temperature';
                } else if (input.conversionType === 'amps' || 
                          input.name.toLowerCase().includes('current') ||
                          input.name.toLowerCase().includes('vfd') ||
                          input.name.toLowerCase().includes('pump')) {
                  unit = 'A';
                  type = 'current';
                } else if (input.inputType === '0-10V') {
                  unit = 'V';
                  type = 'voltage';
                }
                
                // Add to available sensors if not already present
                if (!sensors.find(s => s.key === sensorKey)) {
                  sensors.push({
                    key: sensorKey,
                    name: input.name,
                    unit: unit,
                    type: type
                  });
                }
              }
            });
          }
        });
        
        // Add outdoor air temp from weather if not already present
        if (!sensors.find(s => s.key === 'outdoor_air_temp')) {
          sensors.push({
            key: 'outdoor_air_temp',
            name: 'Outdoor Air Temp',
            unit: '°F',
            type: 'temperature'
          });
        }

        // Add vibration sensors if available
        const vibResponse = await fetch('/api/vibration/sensors', {
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'Content-Type': 'application/json'
          }
        });
        if (vibResponse.ok) {
          const vibSensors = await vibResponse.json();
          vibSensors.forEach((vibSensor: any) => {
            const key = `vib_${vibSensor.sensor_id}`;
            if (!sensors.find(s => s.key === key)) {
              sensors.push({
                key: key,
                name: `Vibration - ${vibSensor.equipment_name}`,
                unit: 'mm/s',
                type: 'other' as const
              });
            }
          });
        }

        setAvailableSensors(sensors);
      }
    } catch (error) {
      console.error('Failed to fetch board configs:', error);
      // Set some defaults if fetch fails
      setAvailableSensors([
        { key: 'setpoint', name: 'Temperature Setpoint', unit: '°F', type: 'temperature' },
        { key: 'tower_loop_supply_temp', name: 'Tower Loop Supply Temp', unit: '°F', type: 'temperature' },
        { key: 'tower_loop_return_temp', name: 'Tower Loop Return Temp', unit: '°F', type: 'temperature' },
      ]);
    }
  };

  const fetchThresholds = async () => {
    try {
      const token = sessionStorage.getItem('authToken');
      const response = await fetch('/api/alarms/thresholds', {
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        const data = await response.json();
        setThresholds(data);
      } else {
        // Load some default thresholds if none exist
        setThresholds([
          { 
            id: '1', 
            name: 'High Tower Supply Temp', 
            parameter: 'tower_loop_supply_temp', 
            minValue: -999, 
            maxValue: 105, 
            unit: '°F', 
            enabled: true, 
            alarmType: 'warning' 
          },
          { 
            id: '2', 
            name: 'Low Tower Return Temp', 
            parameter: 'tower_loop_return_temp', 
            minValue: 85, 
            maxValue: 999, 
            unit: '°F', 
            enabled: true, 
            alarmType: 'warning' 
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to fetch thresholds:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = sessionStorage.getItem('authToken');
      console.log('Saving thresholds:', thresholds);
      
      const response = await fetch('/api/alarms/thresholds', {
        method: 'POST',
        headers: { 
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify(thresholds),
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Save successful:', result);
        alert('Thresholds saved successfully');
        // Reload thresholds to confirm save
        await fetchThresholds();
      } else {
        const errorText = await response.text();
        console.error('Save failed:', response.status, errorText);
        alert(`Failed to save thresholds: ${errorText}`);
      }
    } catch (error) {
      console.error('Save error:', error);
      alert(`Failed to save thresholds: ${error}`);
    }
    setSaving(false);
  };

  const updateThreshold = (id: string, field: keyof Threshold, value: any) => {
    setThresholds(prev => prev.map(t => {
      if (t.id === id) {
        const updated = { ...t, [field]: value };
        
        // Update unit when parameter changes
        if (field === 'parameter') {
          const sensor = availableSensors.find(s => s.key === value);
          if (sensor) {
            updated.unit = sensor.unit;
          }
        }
        
        return updated;
      }
      return t;
    }));
  };

  const addThreshold = () => {
    const newThreshold: Threshold = {
      id: `t-${Date.now()}`,
      name: '', // Let user name it
      parameter: '', // Let user select parameter
      minValue: 0,
      maxValue: 100,
      unit: '',
      enabled: true,
      alarmType: 'warning',
    };
    setThresholds([...thresholds, newThreshold]);
  };

  const deleteThreshold = (id: string) => {
    if (confirm('Are you sure you want to delete this threshold?')) {
      setThresholds(thresholds.filter(t => t.id !== id));
    }
  };

  if (loading) {
    return (
      <div className="thresholds-page">
        <div className="page-header">
          <h1><i className="fas fa-thermometer-half"></i> NexusController Alarm Thresholds</h1>
        </div>
        <div className="loading-message">Loading sensor configurations...</div>
      </div>
    );
  }

  return (
    <div className="thresholds-page">
      <div className="page-header">
        <h1><i className="fas fa-thermometer-half"></i> NexusController Alarm Thresholds</h1>
        <Button 
          onClick={handleSave} 
          disabled={saving}
          variant="teal"
          style={{
            background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
            color: 'white',
            border: 'none',
            padding: '10px 20px'
          }}
        >
          <i className="fas fa-save" style={{ marginRight: '8px' }}></i>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <div className="sensor-info">
        <i className="fas fa-info-circle"></i> 
        <span>Configured Sensors: {availableSensors.length}</span>
      </div>

      <div className="thresholds-grid">
        {thresholds.map(threshold => (
          <div key={threshold.id} className={`threshold-card ${threshold.alarmType}`}>
            <div className="card-header">
              <input
                type="text"
                value={threshold.name}
                onChange={(e) => updateThreshold(threshold.id, 'name', e.target.value)}
                className="threshold-name-input"
                placeholder="Enter threshold name (e.g., High Pump Current, Low Supply Temp)"
              />
              <button onClick={() => deleteThreshold(threshold.id)} className="btn-delete" title="Delete Threshold">
                <i className="fas fa-trash"></i>
              </button>
            </div>

            <div className="card-body">
              <div className="form-row">
                <label>Sensor Parameter</label>
                <select
                  value={threshold.parameter}
                  onChange={(e) => updateThreshold(threshold.id, 'parameter', e.target.value)}
                >
                  {availableSensors.map(sensor => (
                    <option key={sensor.key} value={sensor.key}>
                      {sensor.name} {sensor.unit && `(${sensor.unit})`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <label>Alarm Type</label>
                <select
                  value={threshold.alarmType}
                  onChange={(e) => updateThreshold(threshold.id, 'alarmType', e.target.value as 'warning' | 'critical')}
                >
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div className="form-row">
                <label>Min Value</label>
                <div className="input-group">
                  <input
                    type="number"
                    value={threshold.minValue}
                    onChange={(e) => updateThreshold(threshold.id, 'minValue', parseFloat(e.target.value))}
                    placeholder="Use -999 for no minimum"
                  />
                  <span className="unit">{threshold.unit}</span>
                </div>
              </div>

              <div className="form-row">
                <label>Max Value</label>
                <div className="input-group">
                  <input
                    type="number"
                    value={threshold.maxValue}
                    onChange={(e) => updateThreshold(threshold.id, 'maxValue', parseFloat(e.target.value))}
                    placeholder="Use 999 for no maximum"
                  />
                  <span className="unit">{threshold.unit}</span>
                </div>
              </div>

              <div className="toggle-row">
                <label htmlFor={`switch-${threshold.id}`} className="toggle-label">
                  <i className={`fas fa-${threshold.enabled ? 'check-circle' : 'times-circle'}`}></i>
                  <span>{threshold.enabled ? 'Monitoring Enabled' : 'Monitoring Disabled'}</span>
                </label>
                <Switch
                  id={`switch-${threshold.id}`}
                  checked={threshold.enabled}
                  onCheckedChange={(checked) => updateThreshold(threshold.id, 'enabled', checked)}
                />
              </div>
            </div>
          </div>
        ))}

        <div className="threshold-card add-card" onClick={addThreshold}>
          <i className="fas fa-plus-circle"></i>
          <span>Add New Threshold</span>
        </div>
      </div>

      <div className="threshold-legend">
        <h3>Threshold Guidelines</h3>
        <ul>
          <li><strong>Min Value:</strong> Set to -999 to disable minimum threshold checking</li>
          <li><strong>Max Value:</strong> Set to 999 to disable maximum threshold checking</li>
          <li><strong>Warning:</strong> Non-critical alerts that notify but don't require immediate action</li>
          <li><strong>Critical:</strong> Urgent alerts requiring immediate attention</li>
        </ul>
      </div>
    </div>
  );
};

export default Thresholds;