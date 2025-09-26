import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import '../styles/nodered-readings.css';

interface NodeRedData {
  inputs: Record<string, number>;  // Allow any dynamic input keys
  outputs: {
    triacs: Record<string, boolean>;  // Dynamic triac keys
    analog: Record<string, number>;    // Dynamic analog keys
    relays?: Record<string, boolean>; // Dynamic relay keys
  };
  labels?: {
    triacs?: Record<string, string>;
    analog?: Record<string, string>;
    relays?: Record<string, string>;
  };
  alarms: Array<{
    id?: string;
    name: string;
    value: number;
    threshold?: number;
    unit?: string;
    type?: string;
    message?: string;
    status?: 'normal' | 'warning' | 'critical';
    timestamp: string;
  }>;
}

const NodeRedReadings: React.FC = () => {
  const [currentCard, setCurrentCard] = useState(0);
  const [data, setData] = useState<NodeRedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedLabels, setEditedLabels] = useState<any>({});
  const [userSetpoint, setUserSetpoint] = useState<number>(72);
  const [savingSetpoint, setSavingSetpoint] = useState(false);
  const [setpointSaved, setSetpointSaved] = useState(true);
  const [autoSetpointMode, setAutoSetpointMode] = useState(false);
  const [outdoorTemp, setOutdoorTemp] = useState<number | null>(null);

  const cards = ['Setpoint', 'Inputs', 'Outputs', 'Alarms'];

  // Load saved setpoint and auto mode preference on mount
  useEffect(() => {
    const loadSetpoint = async () => {
      try {
        const response = await fetch('/api/setpoint');
        if (response.ok) {
          const data = await response.json();
          if (data.setpoint !== undefined && data.setpoint !== null) {
            setUserSetpoint(data.setpoint);
          } else {
            // If no saved setpoint, default to 72 and save it
            setUserSetpoint(72);
            fetch('/api/setpoint', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ setpoint: 72 })
            });
          }
          // Load auto mode preference
          if (data.autoMode !== undefined) {
            setAutoSetpointMode(data.autoMode);
          }
        }
      } catch (err) {
        console.error('Error loading setpoint:', err);
        setUserSetpoint(72);
      }
    };
    loadSetpoint();
  }, []);

  // Fetch outdoor temperature
  useEffect(() => {
    const fetchOutdoorTemp = async () => {
      try {
        const response = await fetch('/api/weather');
        if (response.ok) {
          const weatherData = await response.json();
          if (weatherData.temperature) {
            setOutdoorTemp(weatherData.temperature);
          }
        }
      } catch (err) {
        console.error('Error fetching outdoor temp:', err);
      }
    };

    fetchOutdoorTemp();
    // Fetch weather every 5 minutes
    const interval = setInterval(fetchOutdoorTemp, 300000);
    return () => clearInterval(interval);
  }, []);

  // Auto adjust setpoint based on outdoor temperature
  useEffect(() => {
    if (autoSetpointMode && outdoorTemp !== null) {
      const newSetpoint = outdoorTemp > 75 ? 75 : 85;
      if (newSetpoint !== userSetpoint) {
        console.log(`Auto adjusting setpoint: OAT=${outdoorTemp}°F, Setting to ${newSetpoint}°F`);
        setUserSetpoint(newSetpoint);
        setSetpointSaved(false);
        // Auto-save the new setpoint
        saveSetpointValue(newSetpoint);
      }
    }
  }, [autoSetpointMode, outdoorTemp]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch board readings
        const response = await fetch('/api/boards/current-readings');
        if (response.ok) {
          const jsonData = await response.json();
          console.log('Fetched data:', jsonData);
          console.log('Number of inputs:', Object.keys(jsonData.inputs || {}).length);

          // Also fetch vibration sensor readings
          try {
            const vibResponse = await fetch('/api/vibration/readings');
            if (vibResponse.ok) {
              const vibData = await vibResponse.json();
              // Handle both object and array formats
              if (typeof vibData === 'object' && !Array.isArray(vibData)) {
                // Object format: {sensor_id: reading}
                Object.entries(vibData).forEach(([sensorId, reading]: [string, any]) => {
                  if (reading && reading.velocity_mms !== undefined) {
                    jsonData.inputs[`vib_${sensorId}_velocity`] = reading.velocity_mms;
                    jsonData.inputs[`vib_${sensorId}_temp`] = reading.temperature_f;
                  }
                });
              } else if (Array.isArray(vibData)) {
                // Array format
                vibData.forEach((reading: any) => {
                  if (reading.sensor_id && reading.velocity_mms !== undefined) {
                    jsonData.inputs[`vib_${reading.sensor_id}_velocity`] = reading.velocity_mms;
                    jsonData.inputs[`vib_${reading.sensor_id}_temp`] = reading.temperature_f;
                  }
                });
              }
            }
          } catch (vibErr) {
            console.error('Failed to fetch vibration readings:', vibErr);
          }

          // Apply saved labels from localStorage if they exist
          const savedLabels = localStorage.getItem('nodeRedOutputLabels');
          if (savedLabels) {
            jsonData.labels = JSON.parse(savedLabels);
          }
          setData(jsonData);
          setError(null);
        } else {
          setError('Failed to fetch board readings');
        }
      } catch (err) {
        setError('Connection error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const handleNext = () => {
    setCurrentCard((prev) => (prev + 1) % cards.length);
  };

  const handlePrev = () => {
    setCurrentCard((prev) => (prev - 1 + cards.length) % cards.length);
  };

  const handleSetpointChange = (value: number) => {
    setUserSetpoint(value);
    setSetpointSaved(false); // Mark as unsaved when changed
  };

  const saveSetpointValue = async (value: number) => {
    try {
      const response = await fetch('/api/setpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setpoint: value, autoMode: autoSetpointMode })
      });
      if (response.ok) {
        console.log('Setpoint saved:', value);
        setSetpointSaved(true);
      }
    } catch (err) {
      console.error('Error saving setpoint:', err);
    }
  };

  const saveSetpoint = async () => {
    setSavingSetpoint(true);
    try {
      const response = await fetch('/api/setpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setpoint: userSetpoint, autoMode: autoSetpointMode })
      });
      if (response.ok) {
        console.log('Setpoint saved:', userSetpoint);
        setSetpointSaved(true);
        // Show saved indicator briefly
        setTimeout(() => {
          setSavingSetpoint(false);
        }, 1500);
      } else {
        console.error('Failed to save setpoint');
        setSavingSetpoint(false);
      }
    } catch (err) {
      console.error('Error saving setpoint:', err);
      setSavingSetpoint(false);
    }
  };

  const toggleAutoMode = () => {
    const newMode = !autoSetpointMode;
    setAutoSetpointMode(newMode);
    // Save the preference
    fetch('/api/setpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setpoint: userSetpoint, autoMode: newMode })
    });
  };

  const renderSetpoint = () => {
    return (
      <div className="setpoint-control">
        <div className="setpoint-display">
          <h4>System Setpoint</h4>
          <div className="setpoint-value">
            <span className="setpoint-number">{userSetpoint}</span>
            <span className="setpoint-unit">°F</span>
          </div>
          {outdoorTemp !== null && (
            <div style={{
              fontSize: '12px',
              color: '#6b7280',
              marginTop: '4px'
            }}>
              OAT: {outdoorTemp}°F
            </div>
          )}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          marginBottom: '15px'
        }}>
          <label style={{
            fontSize: '14px',
            fontWeight: 500,
            color: autoSetpointMode ? '#14b8a6' : '#6b7280'
          }}>
            Auto Mode
          </label>
          <button
            onClick={toggleAutoMode}
            style={{
              width: '50px',
              height: '24px',
              borderRadius: '12px',
              border: 'none',
              background: autoSetpointMode ? '#14b8a6' : '#cbd5e1',
              position: 'relative',
              cursor: 'pointer',
              transition: 'background 0.3s'
            }}
          >
            <div style={{
              width: '20px',
              height: '20px',
              borderRadius: '10px',
              background: 'white',
              position: 'absolute',
              top: '2px',
              left: autoSetpointMode ? '28px' : '2px',
              transition: 'left 0.3s',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }} />
          </button>
          <span style={{
            fontSize: '11px',
            color: '#6b7280',
            marginLeft: '5px'
          }}>
            {autoSetpointMode ? 'OAT>75°=75° | OAT≤75°=85°' : 'Manual'}
          </span>
        </div>
        
        <div className="setpoint-adjuster">
          <button 
            className="setpoint-btn decrease"
            onClick={() => handleSetpointChange(Math.max(50, userSetpoint - 1))}
          >
            <i className="fas fa-minus"></i>
          </button>
          
          <input
            type="range"
            className="setpoint-slider"
            min="50"
            max="90"
            value={userSetpoint}
            onChange={(e) => handleSetpointChange(Number(e.target.value))}
          />
          
          <button 
            className="setpoint-btn increase"
            onClick={() => handleSetpointChange(Math.min(90, userSetpoint + 1))}
          >
            <i className="fas fa-plus"></i>
          </button>
        </div>
        
        <div className="setpoint-presets">
          <button 
            className="preset-btn"
            onClick={() => handleSetpointChange(68)}
          >
            68°F
          </button>
          <button 
            className="preset-btn"
            onClick={() => handleSetpointChange(70)}
          >
            70°F
          </button>
          <button 
            className="preset-btn"
            onClick={() => handleSetpointChange(72)}
          >
            72°F
          </button>
          <button 
            className="preset-btn"
            onClick={() => handleSetpointChange(75)}
          >
            75°F
          </button>
        </div>
        
        <div className="setpoint-save-container">
          <Button
            variant="teal"
            size="default"
            onClick={saveSetpoint}
            disabled={savingSetpoint || setpointSaved}
            className="save-setpoint-btn"
            style={{
              backgroundColor: 'rgba(203, 213, 225, 0.2)', // Ultra light gray
              color: '#14b8a6', // Teal text
              border: '1px solid rgba(20, 184, 166, 0.2)',
              width: '100%',
              marginTop: '12px',
              fontSize: '14px',
              fontWeight: '500',
              height: '36px'
            }}
          >
            {savingSetpoint ? (
              <>
                <i className="fas fa-spinner fa-spin" style={{ marginRight: '8px' }}></i>
                Saving...
              </>
            ) : setpointSaved ? (
              <>
                <i className="fas fa-check" style={{ marginRight: '8px' }}></i>
                Saved
              </>
            ) : (
              <>
                <i className="fas fa-save" style={{ marginRight: '8px' }}></i>
                Save Setpoint
              </>
            )}
          </Button>
        </div>
      </div>
    );
  };

  const renderInputs = () => {
    if (!data || !data.inputs) {
      console.log('No data or inputs available');
      return null;
    }
    
    console.log('Rendering inputs:', Object.keys(data.inputs).length, 'items');
    console.log('Input keys:', Object.keys(data.inputs));
    console.log('Full input data:', data.inputs);
    
    // Helper to format label from key
    const formatLabel = (key: string) => {
      // Remove technical suffixes like _0_10v_0_50a, _1k_rtd
      let cleaned = key
        .replace(/_0_10v_0_\d+a/g, '')
        .replace(/_1k_rtd/g, '')
        .replace(/_10k/g, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
      
      // Fix common abbreviations
      cleaned = cleaned
        .replace(/Vfd/g, 'VFD')
        .replace(/Hp/g, 'HP')
        .replace(/Oat/g, 'OAT')
        .replace(/L1/g, 'L1')
        .replace(/L3/g, 'L3')
        .replace(/Temp/g, 'Temp');
      
      return cleaned;
    };
    
    // Helper to determine icon based on input name
    const getIcon = (key: string) => {
      if (key.includes('setpoint')) return 'fas fa-crosshairs';
      if (key.includes('vib_') && key.includes('velocity')) return 'fas fa-wave-square';
      if (key.includes('vib_') && key.includes('temp')) return 'fas fa-thermometer-half';
      if (key.includes('current') || key.includes('amps')) return 'fas fa-bolt';
      if (key.includes('temp') || key.includes('oat')) return 'fas fa-thermometer-half';
      if (key.includes('supply')) return 'fas fa-wind';
      if (key.includes('return')) return 'fas fa-reply';
      if (key.includes('tower')) return 'fas fa-building';
      if (key.includes('pump')) return 'fas fa-tint';
      if (key.includes('space')) return 'fas fa-home';
      return 'fas fa-chart-line';
    };
    
    // Helper to format value with appropriate units
    const formatValue = (key: string, value: any) => {
      if (value === null || value === undefined) return '--';

      let numValue = parseFloat(value);
      if (isNaN(numValue)) return value;

      // Apply baseline offsets for Tower 2 and Tower 3 current sensors
      const keyLower = key.toLowerCase();
      if (keyLower.includes('current') && keyLower.includes('0_10v_0_50a')) {
        // Check if it's Tower 2 or Tower 3 current sensor
        if (keyLower.includes('tower_2') && keyLower.includes('l1')) {
          // Tower 2 L1 baseline: 0.402V = 2.01A
          numValue = Math.max(0, numValue - 2.01);
        } else if (keyLower.includes('tower_2') && keyLower.includes('l3')) {
          // Tower 2 L3 baseline: 0.773V = 3.865A
          numValue = Math.max(0, numValue - 3.865);
        } else if (keyLower.includes('tower_3') && keyLower.includes('l1')) {
          // Tower 3 L1 baseline: 0.651V = 3.255A
          numValue = Math.max(0, numValue - 3.255);
        } else if (keyLower.includes('tower_3') && keyLower.includes('l3')) {
          // Tower 3 L3 baseline: 1.537V = 7.685A
          numValue = Math.max(0, numValue - 7.685);
        }
      }

      // Determine units based on key name and value range
      if (key.includes('vib_') && key.includes('velocity')) {
        return `${numValue.toFixed(2)} mm/s`;
      } else if (key.includes('vib_') && key.includes('temp')) {
        return `${numValue.toFixed(1)}°F`;
      } else if (key.includes('current') || key.includes('amps') || key.includes('l1') || key.includes('l3')) {
        return `${numValue.toFixed(1)}A`;
      } else if (key.includes('voltage')) {
        return `${numValue.toFixed(1)}V`;
      } else if (key.includes('pressure')) {
        return `${numValue.toFixed(1)} PSI`;
      } else if (key.includes('humidity')) {
        return `${numValue.toFixed(0)}%`;
      } else if (numValue > 900 && numValue < 1200) {
        // This looks like raw BALCO 1000Ω value that wasn't converted
        // BALCO formula: Temperature = (SQRT((0.00644 × R) - 1.6597) - 1.961) / 0.00322
        const tempF = (Math.sqrt((0.00644 * numValue) - 1.6597) - 1.961) / 0.00322;
        const clampedTemp = Math.max(-40, Math.min(250, tempF));
        return `${clampedTemp.toFixed(1)}°F`;
      } else if (key.includes('temp') || key.includes('supply') || key.includes('return') || key.includes('oat') || key.includes('space')) {
        // Temperature values
        return `${numValue.toFixed(1)}°F`;
      } else {
        // Default to showing value with no units
        return numValue.toFixed(1);
      }
    };
    
    // Sort inputs to show temperatures first, then currents
    console.log('About to sort inputs, total:', Object.entries(data.inputs).length);
    // Don't filter out any inputs - show all even if value is 0
    const sortedInputs = Object.entries(data.inputs)
      .filter(([key]) => key !== 'amps') // Remove the generic 'amps' entry
      .sort(([a], [b]) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();

      // Group items by category with priority
      const getCategory = (key: string) => {
        if (key === 'setpoint') return 1;
        if (key.includes('outdoor_air_temp')) return 2;
        if (key.includes('hp_loop_supply_temp')) return 3;
        if (key.includes('hp_loop_return_temp')) return 4;
        if (key.includes('tower_supply_temp')) return 5;
        if (key.includes('tower_return_temp')) return 6;
        if (key.includes('pump_1_current')) return 7;
        if (key.includes('pump_2_current')) return 8;
        if (key.includes('pump_3_current')) return 9;
        if (key.includes('tower_1_vfd_current_l1')) return 10;
        if (key.includes('tower_1_vfd_current_l3')) return 11;
        if (key.includes('tower_2_vfd_current_l1')) return 12;
        if (key.includes('tower_2_vfd_current_l3')) return 13;
        if (key.includes('tower_3_vfd_current_l1')) return 14;
        if (key.includes('tower_3_vfd_current_l3')) return 15;
        if (key.includes('vfd_current_7')) return 16;
        if (key.includes('vfd_current_8')) return 17;
        return 99; // Everything else at the end
      };

      const aCat = getCategory(aLower);
      const bCat = getCategory(bLower);

      if (aCat !== bCat) return aCat - bCat;
      return a.localeCompare(b);
    });
    
    return (
      <div className="readings-content scrollable" style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {sortedInputs.map(([key, value]) => (
          <div key={key} className="reading-item">
            <i className={getIcon(key)}></i>
            <span className="reading-label">{formatLabel(key)}</span>
            <span className="reading-value">{formatValue(key, value)}</span>
          </div>
        ))}
      </div>
    );
  };

  const handleLabelChange = (type: 'triacs' | 'analog' | 'relays', key: string, value: string) => {
    setEditedLabels((prev: any) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [key]: value
      }
    }));
  };

  const saveLabels = () => {
    // Save labels to localStorage so they persist
    localStorage.setItem('nodeRedOutputLabels', JSON.stringify(editedLabels));
    setEditMode(false);
    // Update the displayed data with new labels
    if (data) {
      setData({
        ...data,
        labels: editedLabels
      });
    }
  };

  // Load saved labels from localStorage on mount
  useEffect(() => {
    const savedLabels = localStorage.getItem('nodeRedOutputLabels');
    if (savedLabels) {
      const parsed = JSON.parse(savedLabels);
      setEditedLabels(parsed);
      // Don't overwrite data here - it gets applied during fetch
    }
  }, []);

  const renderOutputs = () => {
    if (!data) return null;

    // Default labels if not provided
    const defaultTriacLabels = {
      triac1: 'Triac 1',
      triac2: 'Triac 2',
      triac3: 'Triac 3',
      triac4: 'Triac 4'
    };

    const defaultAnalogLabels = {
      ao1: 'AO 1',
      ao2: 'AO 2',
      ao3: 'AO 3',
      ao4: 'AO 4'
    };

    const defaultRelayLabels: Record<string, string> = {};
    for (let i = 1; i <= 16; i++) {
      defaultRelayLabels[`relay${i}`] = `Relay ${i}`;
    }

    const triacLabels = editMode && editedLabels.triacs ? editedLabels.triacs : (data.labels?.triacs || defaultTriacLabels);
    const analogLabels = editMode && editedLabels.analog ? editedLabels.analog : (data.labels?.analog || defaultAnalogLabels);
    const relayLabels = editMode && editedLabels.relays ? editedLabels.relays : (data.labels?.relays || defaultRelayLabels);

    // Initialize edited labels when entering edit mode
    if (editMode && Object.keys(editedLabels).length === 0) {
      setEditedLabels({
        triacs: triacLabels,
        analog: analogLabels,
        relays: relayLabels
      });
    }

    return (
      <div className="readings-content scrollable" style={{ maxHeight: '400px', overflowY: 'auto' }}>
        <div className="output-section">
          <h4>Digital Outputs (Triacs)</h4>
          {Object.entries(data.outputs.triacs).map(([key, value]) => (
            <div key={key} className="reading-item">
              {editMode ? (
                <input
                  type="text"
                  className="label-edit-input"
                  value={triacLabels[key as keyof typeof triacLabels] || ''}
                  onChange={(e) => handleLabelChange('triacs', key, e.target.value)}
                />
              ) : (
                <span className="reading-label">
                  {triacLabels[key as keyof typeof triacLabels] || defaultTriacLabels[key as keyof typeof defaultTriacLabels]}
                </span>
              )}
              <span className={`triac-status ${value ? 'enabled' : 'disabled'}`}>
                {value ? 'ON' : 'OFF'}
              </span>
            </div>
          ))}
        </div>

        {data.outputs.relays && Object.keys(data.outputs.relays).length > 0 && (
          <div className="output-section">
            <h4>Relay Outputs</h4>
            {Object.entries(data.outputs.relays).map(([key, value]) => (
              <div key={key} className="reading-item">
                {editMode ? (
                  <input
                    type="text"
                    className="label-edit-input"
                    value={relayLabels[key] || ''}
                    onChange={(e) => handleLabelChange('relays', key, e.target.value)}
                  />
                ) : (
                  <span className="reading-label">
                    {relayLabels[key] || defaultRelayLabels[key] || key}
                  </span>
                )}
                <span className={`triac-status ${value ? 'enabled' : 'disabled'}`}>
                  {value ? 'ON' : 'OFF'}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="output-section">
          <h4>Analog Outputs</h4>
          {Object.entries(data.outputs.analog).map(([key, value]) => (
            <div key={key} className="reading-item">
              {editMode ? (
                <input
                  type="text"
                  className="label-edit-input"
                  value={analogLabels[key as keyof typeof analogLabels] || ''}
                  onChange={(e) => handleLabelChange('analog', key, e.target.value)}
                />
              ) : (
                <span className="reading-label">
                  {analogLabels[key as keyof typeof analogLabels] || defaultAnalogLabels[key as keyof typeof defaultAnalogLabels]}
                </span>
              )}
              <div className="analog-display">
                <span className="analog-voltage">{(value * 0.1).toFixed(1)}V</span>
                <span className="analog-percent">{value}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderAlarms = () => {
    if (!data) return null;
    
    if (data.alarms.length === 0) {
      return (
        <div className="readings-content centered">
          <i className="fas fa-check-circle alarm-ok"></i>
          <span>No Active Alarms</span>
        </div>
      );
    }

    return (
      <div className="readings-content scrollable">
        {data.alarms.map((alarm, index) => {
          // Map type to status for styling
          const status = alarm.status || alarm.type || 'warning';
          return (
            <div key={alarm.id || index} className={`alarm-item ${status}`}>
              <div className="alarm-header">
                <i className={`fas fa-exclamation-triangle alarm-icon ${status}`}></i>
                <span className="alarm-name">{alarm.name}</span>
              </div>
              <div className="alarm-details">
                <span>Value: {alarm.value.toFixed(1)}{alarm.unit ? alarm.unit : ''}</span>
                {alarm.threshold && <span>Threshold: {alarm.threshold.toFixed(1)}</span>}
                {alarm.message && <span>{alarm.message}</span>}
              </div>
              <div className="alarm-time">{new Date(alarm.timestamp).toLocaleTimeString()}</div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderContent = () => {
    switch (currentCard) {
      case 0:
        return renderSetpoint();
      case 1:
        return renderInputs();
      case 2:
        return renderOutputs();
      case 3:
        return renderAlarms();
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="nodered-readings-card">
        <div className="readings-loading">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="nodered-readings-card">
      <div className="readings-header">
        <button className="nav-btn" onClick={handlePrev}>
          <i className="fas fa-chevron-left"></i>
        </button>
        <h3 style={{ flex: 1, textAlign: 'center' }}>{cards[currentCard]}</h3>
        {currentCard === 2 && (
          editMode ? (
            <button className="edit-btn" onClick={saveLabels} title="Save Labels">
              <i className="fas fa-save"></i>
            </button>
          ) : (
            <button className="edit-btn" onClick={() => setEditMode(true)} title="Edit Labels">
              <i className="fas fa-edit"></i>
            </button>
          )
        )}
        <button className="nav-btn" onClick={handleNext}>
          <i className="fas fa-chevron-right"></i>
        </button>
      </div>
      
      <div className="card-indicators">
        {cards.map((_, index) => (
          <span
            key={index}
            className={`indicator ${index === currentCard ? 'active' : ''}`}
            onClick={() => setCurrentCard(index)}
          />
        ))}
      </div>

      {error ? (
        <div className="readings-error">
          <i className="fas fa-exclamation-circle"></i>
          <span>{error}</span>
        </div>
      ) : (
        renderContent()
      )}
    </div>
  );
};

export default NodeRedReadings;