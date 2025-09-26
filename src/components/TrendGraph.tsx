import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { Waves, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from './ui/button';

interface ChartDataPoint {
  time: string;
  setpoint?: number;
  supply?: number;
  return?: number;
  space?: number;
  oat?: number;
  hpSupply?: number;  // HP Loop Supply temperature
  amps?: number;
  // Additional current sensors
  amps1?: number;
  amps2?: number;
  amps3?: number;
  amps4?: number;
  amps5?: number;
  amps6?: number;
  triac1?: number;
  triac2?: number;
  triac3?: number;
  triac4?: number;
  // Vibration data
  vibration1?: number;
  vibration2?: number;
  vibration3?: number;
  vibration4?: number;
  vibration5?: number;
  [key: string]: any; // Allow dynamic amp keys
}

interface VibrationSensor {
  sensor_id: string;
  equipment_name: string;
  enabled: boolean;
}

type GraphType = 'temperature' | 'amps' | 'triacs' | 'vibration';

const TrendGraph: React.FC = () => {
  const [graphType, setGraphType] = useState<GraphType>('temperature');
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [timeRange, setTimeRange] = useState<number>(8); // hours
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [vibrationSensors, setVibrationSensors] = useState<VibrationSensor[]>([]);
  const [vibrationData, setVibrationData] = useState<ChartDataPoint[]>([]);
  const [selectedSensorIndex, setSelectedSensorIndex] = useState<number>(0);
  const [individualVibrationData, setIndividualVibrationData] = useState<any[]>([]);
  const [currentSensorNames, setCurrentSensorNames] = useState<Map<string, string>>(new Map());
  const [currentApproachTemp, setCurrentApproachTemp] = useState<number | null>(null);
  const [currentWetBulb, setCurrentWetBulb] = useState<number | null>(null);
  const [hxEffectiveness, setHxEffectiveness] = useState<number | null>(null);
  const [thresholds] = useState({
    tempHigh: 85,
    tempLow: 65,
    ampsHigh: 40,
    ampsLow: 5,
    vibrationWarning: 4.5,  // ISO 10816-3 Zone B
    vibrationCritical: 7.1  // ISO 10816-3 Zone C
  });

  // Fetch real sensor data from boards
  const fetchSensorData = async () => {
    try {
      // Fetch real data from board readings API
      const response = await fetch('/api/boards/current-readings');
      if (response.ok) {
        const boardData = await response.json();
        
        const now = new Date();
        // For longer time ranges, include date info
        const timeStr = timeRange > 8
          ? now.toLocaleString('en-US', {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/New_York'
            })
          : now.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/New_York'
            });
        
        const newPoint: ChartDataPoint = {
          time: timeStr
        };
        
        // Map board data to chart data based on configuration
        if (boardData.inputs) {
          // Track current sensor indices
          let currentIndex = 1;
          const sensorNameMap = new Map<string, string>();

          // Map all available inputs
          Object.entries(boardData.inputs).forEach(([key, value]) => {
            const keyLower = key.toLowerCase();

            // Map to chart data points based on input names
            if (keyLower.includes('tower') && keyLower.includes('supply')) {
              newPoint.supply = parseFloat(value as string);
            } else if (keyLower.includes('tower') && keyLower.includes('return')) {
              newPoint.return = parseFloat(value as string);
            } else if (keyLower.includes('hp') && keyLower.includes('supply')) {
              // Store HP loop supply separately for display
              newPoint.hpSupply = parseFloat(value as string);
              // Also use as backup for supply if tower supply not available
              if (!newPoint.supply) {
                newPoint.supply = parseFloat(value as string);
              }
            } else if (keyLower.includes('hp') && keyLower.includes('return')) {
              // Use HP loop return as secondary option for return if tower return not available
              if (!newPoint.return) {
                newPoint.return = parseFloat(value as string);
              }
            } else if (keyLower.includes('outdoor_air') || keyLower.includes('oat')) {
              newPoint.oat = parseFloat(value as string);
            } else if (keyLower === 'space' || keyLower.includes('space_temp')) {
              newPoint.space = parseFloat(value as string);
            } else if (keyLower.includes('current') || keyLower.includes('amps') || keyLower.includes('vfd')) {
              // Map all current sensors dynamically
              const ampKey = `amps${currentIndex}`;
              newPoint[ampKey] = parseFloat(value as string);
              sensorNameMap.set(ampKey, key); // Store original name for legend
              currentIndex++;
            } else if (keyLower === 'setpoint') {
              newPoint.setpoint = parseFloat(value as string);
            }
          });

          // Update sensor names if we found any
          if (sensorNameMap.size > 0) {
            setCurrentSensorNames(sensorNameMap);
          }
        }
        
        // Triac states from outputs
        if (boardData.outputs && boardData.outputs.triacs) {
          newPoint.triac1 = boardData.outputs.triacs.triac1 ? 1 : 0;
          newPoint.triac2 = boardData.outputs.triacs.triac2 ? 1 : 0;
          newPoint.triac3 = boardData.outputs.triacs.triac3 ? 1 : 0;
          newPoint.triac4 = boardData.outputs.triacs.triac4 ? 1 : 0;
        }
        
        // Calculate approach temperature if we have tower supply and wet bulb
        if (newPoint.supply !== undefined && currentWetBulb !== null) {
          // Cooling tower approach = Tower Supply - Wet Bulb
          const approach = newPoint.supply - currentWetBulb;

          // Sanity check - approach should be positive (tower can't cool below wet bulb)
          if (approach < 0) {
            console.warn(`Invalid approach temp: Supply=${newPoint.supply}°F, WetBulb=${currentWetBulb}°F, Approach=${approach}°F`);
          }

          setCurrentApproachTemp(approach);
        } else {
          console.log(`Cannot calculate approach: Supply=${newPoint.supply}, WetBulb=${currentWetBulb}`);
        }

        // Calculate Heat Exchanger Effectiveness
        if (newPoint.supply !== undefined && newPoint.return !== undefined && newPoint.hpSupply !== undefined) {
          // Effectiveness = (T_tower_out - T_tower_in) / (T_hp_in - T_tower_in)
          // Tower out (leaving HX) = supply, Tower in (entering HX) = return, HP in = hpSupply
          const denominator = newPoint.hpSupply - newPoint.return;
          if (denominator !== 0) {
            const effectiveness = ((newPoint.supply - newPoint.return) / denominator) * 100;
            // Clamp to reasonable range (0-100%)
            setHxEffectiveness(Math.min(100, Math.max(0, effectiveness)));
          }
        }

        // Only add data if we have some readings
        if (Object.keys(newPoint).length > 1) {
          setIsConnected(true);
          setData(prevData => {
            const updated = [...prevData, newPoint];
            const intervalMinutes = timeRange <= 1 ? 1 : timeRange <= 4 ? 5 : 15;
            const maxPoints = Math.floor((timeRange * 60) / intervalMinutes);
            if (updated.length > maxPoints) {
              return updated.slice(-maxPoints);
            }
            return updated;
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch sensor data:', err);
      setIsConnected(false);
    }
  };

  // Load historical data when component mounts or time range changes
  useEffect(() => {
    const loadHistoricalData = async () => {
      try {
        // Fetch historical data from database
        const response = await fetch(`/api/boards/historical-data?hours=${timeRange}`);
        if (response.ok) {
          const historicalData = await response.json();
          if (historicalData && historicalData.length > 0) {
            setData(historicalData);
            setIsConnected(true);
          }
        }
      } catch (err) {
        console.error('Failed to load historical data:', err);
      }
    };
    
    loadHistoricalData();
  }, [timeRange]);

  // Fetch vibration sensor data
  const fetchVibrationData = async () => {
    try {

      // Get sensor configs
      const sensorsResponse = await fetch('/api/vibration/configs');
      if (sensorsResponse.ok) {
        const sensors = await sensorsResponse.json();
        const enabledSensors = sensors.filter((s: VibrationSensor) => s.enabled);
        setVibrationSensors(enabledSensors);

        // Fetch historical data for the selected sensor
        if (enabledSensors.length > 0 && enabledSensors[selectedSensorIndex]) {
          const selectedSensor = enabledSensors[selectedSensorIndex];
          const historyResponse = await fetch(`/api/vibration/history/${selectedSensor.sensor_id}?hours=1`);
          if (historyResponse.ok) {
            const history = await historyResponse.json();
            const formattedHistory = history.map((point: any) => ({
              time: new Date(point.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'America/New_York'
              }),
              velocity: point.velocity_mms,
              velocityX: point.velocity_x,
              velocityY: point.velocity_y,
              velocityZ: point.velocity_z,
              temperature: point.temperature_f
            }));
            setIndividualVibrationData(formattedHistory);
          }
        }
      }

      // Get current readings
      const readingsResponse = await fetch('/api/vibration/readings');
      if (readingsResponse.ok) {
        const readings = await readingsResponse.json();

        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/New_York'
        });

        const newPoint: ChartDataPoint = { time: timeStr };

        // Handle both object and array formats
        let readingsArray: any[] = [];
        if (typeof readings === 'object' && !Array.isArray(readings)) {
          // Object format: convert to array
          readingsArray = Object.values(readings);
        } else if (Array.isArray(readings)) {
          readingsArray = readings;
        }

        // Map up to 5 sensors
        readingsArray.slice(0, 5).forEach((reading: any, index: number) => {
          const key = `vibration${index + 1}` as 'vibration1' | 'vibration2' | 'vibration3' | 'vibration4' | 'vibration5';
          newPoint[key] = reading.velocity_mms || 0;
        });

        setVibrationData(prevData => {
          const updated = [...prevData, newPoint];
          const maxPoints = 50; // Keep last 50 points for vibration
          if (updated.length > maxPoints) {
            return updated.slice(-maxPoints);
          }
          return updated;
        });
      }
    } catch (err) {
      console.error('Failed to fetch vibration data:', err);
    }
  };

  // Fetch weather data for wet bulb temperature
  const fetchWeatherData = async () => {
    try {
      const response = await fetch('/api/weather');
      if (response.ok) {
        const weatherData = await response.json();
        if (weatherData.wetBulb) {
          setCurrentWetBulb(weatherData.wetBulb);
          console.log('Wet bulb temperature updated:', weatherData.wetBulb);
        }
      }
    } catch (error) {
      console.error('Failed to fetch weather data:', error);
    }
  };

  useEffect(() => {
    fetchWeatherData();
    // Fetch weather every 10 minutes
    const weatherInterval = setInterval(fetchWeatherData, 600000);

    return () => clearInterval(weatherInterval);
  }, []);

  // Poll for new sensor data
  useEffect(() => {
    // Initial fetch
    fetchWeatherData(); // Ensure we have wet bulb data
    fetchSensorData();

    // Set up polling interval (every 30 seconds for real data)
    const interval = setInterval(fetchSensorData, 30000);

    return () => clearInterval(interval);
  }, [timeRange]);

  // Poll for vibration data when in vibration mode
  useEffect(() => {
    if (graphType === 'vibration') {
      fetchVibrationData();
      const interval = setInterval(fetchVibrationData, 30000); // Poll every 30 seconds for vibration
      return () => clearInterval(interval);
    }
    return undefined; // Explicit return for non-vibration types
  }, [graphType, selectedSensorIndex]);

  // Handle sensor navigation
  const handleNextSensor = () => {
    if (vibrationSensors.length > 0) {
      setSelectedSensorIndex((prev) => (prev + 1) % vibrationSensors.length);
    }
  };

  const handlePrevSensor = () => {
    if (vibrationSensors.length > 0) {
      setSelectedSensorIndex((prev) => (prev - 1 + vibrationSensors.length) % vibrationSensors.length);
    }
  };

  const graphTitles = {
    temperature: 'Temperature Trends',
    amps: 'Current Trends',
    triacs: 'VFD Enable Status',
    vibration: 'Vibration Monitoring'
  };

  const handleNextGraph = () => {
    const types: GraphType[] = ['temperature', 'amps', 'triacs', 'vibration'];
    const currentIndex = types.indexOf(graphType);
    setGraphType(types[(currentIndex + 1) % types.length]);
  };

  const handlePrevGraph = () => {
    const types: GraphType[] = ['temperature', 'amps', 'triacs', 'vibration'];
    const currentIndex = types.indexOf(graphType);
    setGraphType(types[(currentIndex - 1 + types.length) % types.length]);
  };

  const renderChart = () => {
    // Show "Connect Sensors" message if no data
    if (!isConnected || data.length === 0) {
      return (
        <div style={{ 
          height: 250, 
          display: 'flex', 
          flexDirection: 'column',
          alignItems: 'center', 
          justifyContent: 'center',
          background: '#f9fafb',
          borderRadius: '8px',
          border: '2px dashed #d1d5db'
        }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <h3 style={{ 
            marginTop: '1rem', 
            marginBottom: '0.5rem',
            color: '#6b7280',
            fontSize: '1.125rem',
            fontWeight: 600
          }}>
            Connect Sensors
          </h3>
          <p style={{ 
            color: '#9ca3af', 
            fontSize: '0.875rem',
            textAlign: 'center',
            maxWidth: '250px'
          }}>
            No sensor data available. Please ensure boards are connected and configured.
          </p>
        </div>
      );
    }

    if (graphType === 'temperature') {
      return (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              stroke="#9ca3af"
              fontSize={12}
              interval={(() => {
                // Calculate proper interval based on time range and data points
                const totalPoints = data.length;

                if (timeRange <= 1) {
                  // 1 hour: show every 10 minutes (20 points)
                  return Math.max(1, Math.floor(totalPoints / 6));
                } else if (timeRange <= 4) {
                  // 4 hours: show every 30 minutes
                  return Math.max(1, Math.floor(totalPoints / 8));
                } else if (timeRange <= 8) {
                  // 8 hours: show every hour
                  return Math.max(1, Math.floor(totalPoints / 8));
                } else {
                  // 24 hours: show every 2-3 hours
                  return Math.max(1, Math.floor(totalPoints / 10));
                }
              })()}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              stroke="#9ca3af"
              fontSize={12}
              domain={[50, 95]}
              tickFormatter={(value) => `${value.toFixed(0)}°F`}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '0.375rem'
              }}
              formatter={(value: number) => [`${value?.toFixed(1)}°F`, '']}
            />
            <Legend
              iconType="line"
              formatter={(value, entry) => (
                <span style={{
                  color: entry.color && entry.color.includes('rgba')
                    ? entry.color.replace(/[\d.]+\)/, '1)') // Make legend text fully opaque
                    : entry.color,
                  fontWeight: 600
                }}>
                  {value}
                </span>
              )}
            />
            
            {/* Threshold lines */}
            <ReferenceLine
              y={thresholds.tempHigh}
              stroke="rgba(239, 68, 68, 0.3)"
              strokeDasharray="5 5"
            />
            <ReferenceLine
              y={thresholds.tempLow}
              stroke="rgba(239, 68, 68, 0.3)"
              strokeDasharray="5 5"
            />
            <ReferenceLine 
              y={70} 
              stroke="rgba(34, 197, 94, 0.3)" 
              strokeDasharray="3 3" 
              label="Setpoint"
            />
            
            {/* Data lines */}
            {data.some(d => d.supply !== undefined) && (
              <Line
                type="monotone"
                dataKey="supply"
                stroke="rgba(14, 165, 233, 0.3)"
                strokeWidth={2.5}
                dot={false}
                name="Tower Supply"
                legendType="line"
              />
            )}
            {data.some(d => d.return !== undefined) && (
              <Line
                type="monotone"
                dataKey="return"
                stroke="rgba(245, 158, 11, 0.3)"
                strokeWidth={2.5}
                dot={false}
                name="Tower Return"
                legendType="line"
              />
            )}
            {data.some(d => d.oat !== undefined) && (
              <Line
                type="monotone"
                dataKey="oat"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
                name="Outside Air"
              />
            )}
            {data.some(d => d.space !== undefined) && (
              <Line
                type="monotone"
                dataKey="space"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                name="Space"
              />
            )}
            {data.some(d => d.hpSupply !== undefined) && (
              <Line
                type="monotone"
                dataKey="hpSupply"
                stroke="rgba(239, 68, 68, 0.5)"
                strokeWidth={2}
                dot={false}
                name="HP Loop Supply"
                legendType="line"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      );
    } else if (graphType === 'amps') {
      // Define colors for different current sensors
      const ampColors = ['#f59e0b', '#0ea5e9', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4'];

      // Find all amp keys in the data
      const ampKeys = new Set<string>();
      data.forEach(point => {
        Object.keys(point).forEach(key => {
          if (key.startsWith('amps') && key !== 'amps') {
            ampKeys.add(key);
          }
        });
      });

      return (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              stroke="#9ca3af"
              fontSize={12}
              interval={timeRange <= 1 ? 'preserveStartEnd' : timeRange <= 4 ? Math.floor(data.length / 8) : Math.floor(data.length / 6)}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              stroke="#9ca3af"
              fontSize={12}
              domain={[0, 50]}
              tickFormatter={(value) => `${value.toFixed(0)}A`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '0.375rem'
              }}
              formatter={(value: number) => [`${value?.toFixed(1)}A`, '']}
            />
            <Legend
              iconType="line"
              formatter={(value, entry) => (
                <span style={{
                  color: entry.color && entry.color.includes('rgba')
                    ? entry.color.replace(/[\d.]+\)/, '1)') // Make legend text fully opaque
                    : entry.color,
                  fontWeight: 600
                }}>
                  {value}
                </span>
              )}
            />

            {/* Threshold lines */}
            <ReferenceLine
              y={thresholds.ampsHigh}
              stroke="rgba(239, 68, 68, 0.3)"
              strokeDasharray="5 5"
              label="High Limit"
            />
            <ReferenceLine
              y={thresholds.ampsLow}
              stroke="rgba(34, 197, 94, 0.3)"
              strokeDasharray="5 5"
              label="Running"
            />

            {/* Render a line for each current sensor */}
            {Array.from(ampKeys).sort().map((key, index) => {
              const sensorName = currentSensorNames.get(key) || key;
              const displayName = sensorName
                .replace(/_/g, ' ')
                .replace(/tower/gi, 'Tower')
                .replace(/pump/gi, 'Pump')
                .replace(/vfd/gi, 'VFD')
                .replace(/current/gi, '')
                .replace(/amps/gi, '')
                .trim();

              return (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={ampColors[index % ampColors.length]}
                  strokeWidth={2.5}
                  dot={false}
                  name={displayName || `Current ${index + 1}`}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      );
    } else if (graphType === 'vibration') {
      // Vibration graph
      const selectedSensor = vibrationSensors[selectedSensorIndex];

      // Show no data message if no sensors configured
      if (vibrationSensors.length === 0) {
        return (
          <div style={{
            height: 250,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f9fafb',
            borderRadius: '8px',
            border: '2px dashed #d1d5db'
          }}>
            <Waves size={64} color="#9ca3af" />
            <h3 style={{
              marginTop: '1rem',
              marginBottom: '0.5rem',
              color: '#6b7280',
              fontSize: '1.125rem',
              fontWeight: 600
            }}>
              No Vibration Sensors
            </h3>
            <p style={{
              color: '#9ca3af',
              fontSize: '0.875rem',
              textAlign: 'center',
              maxWidth: '250px'
            }}>
              Configure vibration sensors in the Vibration page to see data here.
            </p>
          </div>
        );
      }

      // Use vibrationData for multi-sensor overlay or individualVibrationData for single sensor
      const chartData = selectedSensor && individualVibrationData.length > 0
        ? individualVibrationData
        : vibrationData.length > 0 ? vibrationData : [];

      if (chartData.length === 0) {
        return (
          <div style={{
            height: 250,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f9fafb',
            borderRadius: '8px'
          }}>
            <p style={{ color: '#9ca3af' }}>Waiting for sensor data...</p>
          </div>
        );
      }

      return (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              stroke="#9ca3af"
              fontSize={12}
              interval="preserveStartEnd"
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              stroke="#9ca3af"
              fontSize={12}
              domain={[0, 15]}
              tickFormatter={(value) => `${value.toFixed(2)} mm/s`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '0.375rem'
              }}
              formatter={(value: number) => [`${value?.toFixed(2)} mm/s`, '']}
            />
            <Legend
              iconType="line"
              formatter={(value, entry) => (
                <span style={{
                  color: entry.color && entry.color.includes('rgba')
                    ? entry.color.replace(/[\d.]+\)/, '1)') // Make legend text fully opaque
                    : entry.color,
                  fontWeight: 600
                }}>
                  {value}
                </span>
              )}
            />

            {/* ISO 10816-3 Zone lines */}
            <ReferenceLine
              y={2.8}
              stroke="rgba(34, 197, 94, 0.3)"
              strokeDasharray="5 5"
              label="Zone A (Good)"
            />
            <ReferenceLine
              y={thresholds.vibrationWarning}
              stroke="rgba(245, 158, 11, 0.3)"
              strokeDasharray="5 5"
              label="Zone B (Acceptable)"
            />
            <ReferenceLine
              y={thresholds.vibrationCritical}
              stroke="rgba(239, 68, 68, 0.3)"
              strokeDasharray="5 5"
              label="Zone C (Warning)"
            />
            <ReferenceLine
              y={11.0}
              stroke="rgba(220, 38, 38, 0.3)"
              strokeDasharray="5 5"
              label="Zone D (Critical)"
            />

            {/* Render lines based on data type */}
            {selectedSensor && chartData === individualVibrationData ? (
              // Individual sensor detail view
              <>
                <Line
                  type="monotone"
                  dataKey="velocity"
                  stroke="#06b6d4"
                  strokeWidth={2.5}
                  dot={false}
                  name={`${selectedSensor.equipment_name} - RMS`}
                />
                <Line
                  type="monotone"
                  dataKey="velocityX"
                  stroke="#8b5cf6"
                  strokeWidth={1.5}
                  dot={false}
                  name="X-axis"
                />
                <Line
                  type="monotone"
                  dataKey="velocityY"
                  stroke="#ec4899"
                  strokeWidth={1.5}
                  dot={false}
                  name="Y-axis"
                />
                <Line
                  type="monotone"
                  dataKey="velocityZ"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  dot={false}
                  name="Z-axis"
                />
              </>
            ) : (
              // Multi-sensor overlay view
              <>
                {vibrationSensors.slice(0, 5).map((sensor, index) => {
                  const colors = ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];
                  return (
                    <Line
                      key={sensor.sensor_id}
                      type="monotone"
                      dataKey={`vibration${index + 1}`}
                      stroke={colors[index]}
                      strokeWidth={2}
                      dot={false}
                      name={sensor.equipment_name}
                    />
                  );
                })}
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      );
    } else {
      // Triacs graph
      return (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              stroke="#9ca3af"
              fontSize={12}
              interval={(() => {
                // Calculate proper interval based on time range and data points
                const totalPoints = data.length;

                if (timeRange <= 1) {
                  // 1 hour: show every 10 minutes (20 points)
                  return Math.max(1, Math.floor(totalPoints / 6));
                } else if (timeRange <= 4) {
                  // 4 hours: show every 30 minutes
                  return Math.max(1, Math.floor(totalPoints / 8));
                } else if (timeRange <= 8) {
                  // 8 hours: show every hour
                  return Math.max(1, Math.floor(totalPoints / 8));
                } else {
                  // 24 hours: show every 2-3 hours
                  return Math.max(1, Math.floor(totalPoints / 10));
                }
              })()}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis 
              stroke="#9ca3af"
              fontSize={12}
              domain={[0, 1]}
              ticks={[0, 1]}
              tickFormatter={(value) => value > 0.5 ? 'ON' : 'OFF'}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '0.375rem'
              }}
              formatter={(value: number) => value > 0.5 ? 'ON' : 'OFF'}
            />
            <Legend
              iconType="line"
              formatter={(value, entry) => (
                <span style={{
                  color: entry.color && entry.color.includes('rgba')
                    ? entry.color.replace(/[\d.]+\)/, '1)') // Make legend text fully opaque
                    : entry.color,
                  fontWeight: 600
                }}>
                  {value}
                </span>
              )}
            />
            
            <Line 
              type="stepAfter" 
              dataKey="triac1" 
              stroke="#0ea5e9" 
              strokeWidth={2.5}
              dot={false}
              name="Tower 1 VFD"
            />
            <Line 
              type="stepAfter" 
              dataKey="triac2" 
              stroke="#10b981" 
              strokeWidth={2.5}
              dot={false}
              name="Tower 2 VFD"
            />
            <Line 
              type="stepAfter" 
              dataKey="triac3" 
              stroke="#f59e0b" 
              strokeWidth={2.5}
              dot={false}
              name="Tower 3 VFD"
            />
            <Line 
              type="stepAfter" 
              dataKey="triac4" 
              stroke="#8b5cf6" 
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              name="Spare"
            />
          </LineChart>
        </ResponsiveContainer>
      );
    }
  };

  return (
    <div className="trend-graph-card">
      <div className="trend-header">
        <button className="trend-nav-btn" onClick={handlePrevGraph}>‹</button>
        <Button
          variant={graphType === 'vibration' ? 'default' : 'outline'}
          onClick={() => setGraphType(graphType === 'vibration' ? 'temperature' : 'vibration')}
          title="Vibration Monitoring - ISO 10816-3"
          style={{ fontSize: '10px', padding: '4px 8px', height: '32px', width: 'auto' }}
        >
          ISO-10816
        </Button>
        {graphType === 'vibration' && vibrationSensors.length > 1 && (
          <>
            <button
              onClick={handlePrevSensor}
              title="Previous Sensor"
              style={{
                padding: '2px 4px',
                fontSize: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                background: 'white',
                cursor: 'pointer'
              }}
            >
              <ChevronUp style={{ width: '12px', height: '12px' }} />
            </button>
            <button
              onClick={handleNextSensor}
              title="Next Sensor"
              style={{
                padding: '2px 4px',
                fontSize: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                background: 'white',
                cursor: 'pointer'
              }}
            >
              <ChevronDown style={{ width: '12px', height: '12px' }} />
            </button>
          </>
        )}
        <h3 style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {graphType === 'temperature' && (
            <div style={{
              display: 'flex',
              gap: '20px',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '4px'
            }}>
              <span style={{
                color: currentApproachTemp !== null ? (currentApproachTemp < 0 ? '#ef4444' : '#059669') : '#6b7280'
              }}>
                Approach: {currentApproachTemp !== null ? `${currentApproachTemp.toFixed(1)}°F` : '--'}
              </span>
              <span style={{
                color: hxEffectiveness !== null ?
                  (hxEffectiveness > 80 ? '#059669' : hxEffectiveness > 60 ? '#f59e0b' : '#ef4444') : '#6b7280'
              }}>
                HX Eff: {hxEffectiveness !== null ? `${hxEffectiveness.toFixed(1)}%` : '--'}
              </span>
            </div>
          )}
          <span>
            {graphType === 'vibration' && vibrationSensors[selectedSensorIndex]
              ? `${vibrationSensors[selectedSensorIndex].equipment_name} Vibration`
              : graphTitles[graphType]}
          </span>
        </h3>
        <div className="trend-controls">
          <select 
            className="time-range-select" 
            value={timeRange} 
            onChange={(e) => setTimeRange(Number(e.target.value))}
          >
            <option value={1}>1 Hour</option>
            <option value={4}>4 Hours</option>
            <option value={8}>8 Hours</option>
            <option value={24}>24 Hours</option>
          </select>
          <div className="trend-status">
            <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
            {isConnected ? 'Live' : 'Offline'}
          </div>
        </div>
        <button className="trend-nav-btn" onClick={handleNextGraph}>›</button>
      </div>
      <div style={{ padding: '1rem' }}>
        {renderChart()}
      </div>
    </div>
  );
};

export default TrendGraph;