import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Eye, EyeOff, Edit2, ChartCandlestick } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { SystemInfo } from '../types';
import { authenticatedFetch } from '../services/api';
const NodeRedReadings = lazy(() => import('../components/NodeRedReadings'));
const TrendGraph = lazy(() => import('../components/TrendGraph'));

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface DashboardProps {
  systemInfo: SystemInfo | null;
}

const Dashboard: React.FC<DashboardProps> = ({ systemInfo }) => {
  const [weatherData, setWeatherData] = useState<any>(null);
  const [servicesStatus, setServicesStatus] = useState({
    nodeRed: 'checking',
    neuralBMS: 'checking',
    cloudflare: 'checking'
  });
  const [valveStatus, setValveStatus] = useState({
    valve1: 'open',
    valve2: 'open',
    valve3: 'open'
  });
  const [cpuHistory, setCpuHistory] = useState<number[]>(Array(20).fill(0));
  const [memHistory, setMemHistory] = useState<number[]>(Array(20).fill(0));
  const [timeLabels, setTimeLabels] = useState<string[]>(Array(20).fill(''));
  const [showIP, setShowIP] = useState<boolean>(false);
  const [ipAddress, setIpAddress] = useState<string>('192.168.1.100'); // Default IP
  const [showZipModal, setShowZipModal] = useState<boolean>(false);
  const [newZipCode, setNewZipCode] = useState<string>('');
  const [zipError, setZipError] = useState<string>('');
  const [savingZip, setSavingZip] = useState<boolean>(false);

  // Fetch IP address
  useEffect(() => {
    const fetchIP = async () => {
      try {
        const response = await authenticatedFetch('/api/network-info');
        if (response.ok) {
          const data = await response.json();
          if (data.ip) {
            setIpAddress(data.ip);
          }
        }
      } catch (error) {
        console.error('Failed to fetch IP:', error);
        // Try to get local IP from system info or use default
        if (systemInfo && (systemInfo as any).ip_address) {
          setIpAddress((systemInfo as any).ip_address);
        }
      }
    };
    fetchIP();
  }, [systemInfo]);

  // Save zip code function
  const handleSaveZipCode = async () => {
    // Validate zip code
    if (!newZipCode || newZipCode.length !== 5 || !/^\d{5}$/.test(newZipCode)) {
      setZipError('Please enter a valid 5-digit ZIP code');
      return;
    }

    setSavingZip(true);
    setZipError('');

    try {
      const response = await authenticatedFetch('/api/settings/weather-location', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ zipCode: newZipCode }),
      });

      if (response.ok) {
        // Close modal
        setShowZipModal(false);
        setNewZipCode('');
        
        // Refresh weather data
        const weatherResponse = await authenticatedFetch('/api/weather');
        if (weatherResponse.ok) {
          const data = await weatherResponse.json();
          setWeatherData(data);
        }
      } else {
        const error = await response.json();
        setZipError(error.message || 'Failed to save ZIP code');
      }
    } catch (error) {
      console.error('Failed to save ZIP code:', error);
      setZipError('Failed to save ZIP code');
    } finally {
      setSavingZip(false);
    }
  };

  // Fetch weather
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const response = await authenticatedFetch('/api/weather');
        if (response.ok) {
          const data = await response.json();
          setWeatherData(data);
        }
      } catch (error) {
        console.error('Failed to fetch weather:', error);
      }
    };

    fetchWeather();
    const interval = setInterval(fetchWeather, 600000);
    return () => clearInterval(interval);
  }, []);

  // Check services
  useEffect(() => {
    const checkServices = async () => {
      try {
        const response = await fetch('/node-red/');
        setServicesStatus(prev => ({ ...prev, nodeRed: response.ok ? 'online' : 'offline' }));
      } catch {
        setServicesStatus(prev => ({ ...prev, nodeRed: 'offline' }));
      }

      setServicesStatus(prev => ({
        ...prev,
        neuralBMS: systemInfo ? 'online' : 'offline',
        cloudflare: systemInfo ? 'online' : 'offline'
      }));
    };

    checkServices();
    const interval = setInterval(checkServices, 30000);
    return () => clearInterval(interval);
  }, [systemInfo]);

  // Check valve status
  useEffect(() => {
    const checkValveStatus = async () => {
      try {
        // TODO: Replace with actual valve status API endpoint once channels are assigned
        // Will read from 16-channel relay board digital inputs once configured
        const response = await authenticatedFetch('/api/boards/current-readings');
        if (response.ok) {
          await response.json(); // Consume response to avoid memory leak
          // Once channels are assigned, will read from appropriate digital inputs
          // Example: data.CH13 for valve 1, data.CH14 for valve 2, etc.
          // For now, defaulting to open status
          setValveStatus({
            valve1: 'open',
            valve2: 'open',
            valve3: 'open'
          });
        }
      } catch (error) {
        console.error('Failed to check valve status:', error);
      }
    };

    checkValveStatus();
    const interval = setInterval(checkValveStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Update charts
  useEffect(() => {
    if (!systemInfo) return;

    const now = new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'America/New_York'
    });

    setCpuHistory(prev => [...prev.slice(1), parseFloat(systemInfo.cpu_usage || '0')]);
    setMemHistory(prev => [...prev.slice(1), systemInfo.mem_percent || 0]);
    setTimeLabels(prev => [...prev.slice(1), now]);
  }, [systemInfo]);

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        titleColor: '#111827',
        bodyColor: '#374151',
        borderColor: '#e5e7eb',
        borderWidth: 1
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        ticks: { 
          color: '#64748b',
          callback: function(value: any) {
            return value + '%';
          }
        },
        grid: { 
          color: 'rgba(148, 163, 184, 0.1)',
          drawBorder: false
        }
      },
      x: {
        ticks: { 
          color: '#64748b',
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 6
        },
        grid: { display: false }
      }
    }
  };

  const cpuChartData = {
    labels: timeLabels,
    datasets: [{
      label: 'CPU Usage',
      data: cpuHistory,
      borderColor: '#14b8a6',
      backgroundColor: 'rgba(20, 184, 166, 0.1)',
      borderWidth: 2,
      tension: 0.4,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: '#14b8a6'
    }]
  };

  const memChartData = {
    labels: timeLabels,
    datasets: [{
      label: 'Memory Usage',
      data: memHistory,
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      borderWidth: 2,
      tension: 0.4,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: '#10b981'
    }]
  };

  if (!systemInfo) {
    return (
      <div className="dashboard-loading">
        <div className="spinner"></div>
        <div>Loading system information...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      {/* Row 1: Status buttons */}
      <div className="status-buttons-row">
        <button className={`status-button nodered ${servicesStatus.nodeRed}`}>
          <div className="status-icon">
            <i className="fas fa-project-diagram"></i>
          </div>
          <div className="status-text">Node-RED</div>
        </button>
        <button className={`status-button neuralbms ${servicesStatus.neuralBMS}`}>
          <div className="status-icon">
            <i className="fas fa-brain"></i>
          </div>
          <div className="status-text">NeuralBMS</div>
        </button>
        <button className={`status-button cloudflare ${servicesStatus.cloudflare}`}>
          <div className="status-icon">
            <i className="fas fa-cloud"></i>
          </div>
          <div className="status-text">Cloudflare</div>
        </button>
      </div>

      {/* Valve Status Indicators */}
      <div className="valve-status-row">
        <div className={`valve-indicator ${valveStatus.valve1}`}>
          <div className="valve-icon">
            <ChartCandlestick size={14} />
          </div>
          <div className="valve-info">
            <div className="valve-text">Valve 1</div>
            <div className="valve-state">{valveStatus.valve1 === 'open' ? 'Open' : 'Closed'}</div>
          </div>
        </div>
        <div className={`valve-indicator ${valveStatus.valve2}`}>
          <div className="valve-icon">
            <ChartCandlestick size={14} />
          </div>
          <div className="valve-info">
            <div className="valve-text">Valve 2</div>
            <div className="valve-state">{valveStatus.valve2 === 'open' ? 'Open' : 'Closed'}</div>
          </div>
        </div>
        <div className={`valve-indicator ${valveStatus.valve3}`}>
          <div className="valve-icon">
            <ChartCandlestick size={14} />
          </div>
          <div className="valve-info">
            <div className="valve-text">Valve 3</div>
            <div className="valve-state">{valveStatus.valve3 === 'open' ? 'Open' : 'Closed'}</div>
          </div>
        </div>
      </div>

      {/* Row 2: Weather widget (left), TrendGraph (middle), and NodeRED Readings (right) */}
      <div className="weather-row">
        {weatherData && (
          <div className="weather-card">
            <div className="weather-header">
              <img 
                src={`https://openweathermap.org/img/wn/${weatherData.icon}@4x.png`} 
                alt={weatherData.condition}
                className="weather-main-icon"
              />
              <div className="weather-main-info">
                <div className="weather-temperature">{weatherData.temperature}°F</div>
                <div className="weather-description">{weatherData.condition}</div>
                <div className="weather-feels">Feels like {weatherData.feelsLike}°F</div>
              </div>
            </div>
            <div className="weather-stats">
              <div className="weather-stat">
                <i className="fas fa-wind"></i>
                <span>{weatherData.windSpeed} mph</span>
              </div>
              <div className="weather-stat">
                <i className="fas fa-tint"></i>
                <span>{weatherData.humidity}%</span>
              </div>
              <div className="weather-stat">
                <i className="fas fa-eye"></i>
                <span>{weatherData.visibility} mi</span>
              </div>
            </div>
            <div className="weather-footer">
              <i className="fas fa-map-marker-alt"></i>
              <span>{weatherData.location}</span>
              <button 
                className="weather-edit-btn"
                onClick={() => {
                  setShowZipModal(true);
                  setNewZipCode('');
                  setZipError('');
                }}
                title="Change location"
              >
                <Edit2 size={14} />
              </button>
            </div>
          </div>
        )}
        <Suspense fallback={<div className="trend-graph-card"><div className="loading-placeholder">Loading graph...</div></div>}>
          <TrendGraph />
        </Suspense>
        <Suspense fallback={<div className="widget-card"><div className="loading-placeholder">Loading readings...</div></div>}>
          <NodeRedReadings />
        </Suspense>
      </div>

      {/* Row 3: Metrics grid (3 columns) */}
      <div className="metrics-row">
        <div className="metric-box">
          <div className="metric-icon-wrapper cpu">
            <i className="fas fa-thermometer-half"></i>
          </div>
          <div className="metric-content">
            <div className="metric-label">CPU Temperature</div>
            <div className="metric-value">{systemInfo.cpu_temp || 'N/A'}</div>
            <div className="metric-status">Normal</div>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon-wrapper cpu">
            <i className="fas fa-microchip"></i>
          </div>
          <div className="metric-content">
            <div className="metric-label">CPU Usage</div>
            <div className="metric-value">{systemInfo.cpu_usage || '0'}%</div>
            <div className="metric-bar">
              <div className="metric-bar-fill cpu" style={{ width: `${systemInfo.cpu_usage || 0}%` }}></div>
            </div>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon-wrapper memory">
            <i className="fas fa-memory"></i>
          </div>
          <div className="metric-content">
            <div className="metric-label">Memory Usage</div>
            <div className="metric-value">{systemInfo.mem_percent || 0}%</div>
            <div className="metric-bar">
              <div className="metric-bar-fill memory" style={{ width: `${systemInfo.mem_percent || 0}%` }}></div>
            </div>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon-wrapper disk">
            <i className="fas fa-hdd"></i>
          </div>
          <div className="metric-content">
            <div className="metric-label">Disk Usage</div>
            <div className="metric-value">{systemInfo.disk_percent || 0}%</div>
            <div className="metric-subtext">{systemInfo.disk_used || 'N/A'} / {systemInfo.disk_total || 'N/A'}</div>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon-wrapper uptime">
            <i className="fas fa-clock"></i>
          </div>
          <div className="metric-content">
            <div className="metric-label">Uptime</div>
            <div className="metric-value">{formatUptime(systemInfo.uptime || 0)}</div>
            <div className="metric-status">Stable</div>
          </div>
        </div>

        <div className="metric-box network-box">
          <div className="metric-icon-wrapper network">
            <i className="fas fa-wifi"></i>
          </div>
          <div className="metric-content">
            <div className="metric-label">
              Network
              <button 
                className="ip-toggle-btn"
                onClick={() => setShowIP(!showIP)}
                title={showIP ? "Hide IP" : "Show IP"}
              >
                {showIP ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="metric-value">Connected</div>
            <div className="metric-status">
              {showIP ? ipAddress : 'Strong Signal'}
            </div>
          </div>
        </div>
      </div>

      {/* Row 4: Charts (2 columns) */}
      <div className="charts-row">
        <div className="chart-box">
          <div className="chart-header">
            <h3>CPU Usage History</h3>
            <span className="chart-current">{systemInfo.cpu_usage || 0}%</span>
          </div>
          <div className="chart-content">
            <Line data={cpuChartData} options={chartOptions} />
          </div>
        </div>

        <div className="chart-box">
          <div className="chart-header">
            <h3>Memory Usage History</h3>
            <span className="chart-current">{systemInfo.mem_percent || 0}%</span>
          </div>
          <div className="chart-content">
            <Line data={memChartData} options={chartOptions} />
          </div>
        </div>
      </div>

      {/* ZIP Code Modal */}
      {showZipModal && (
        <div className="modal-overlay" onClick={() => setShowZipModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Change Weather Location</h3>
              <button 
                className="modal-close-btn"
                onClick={() => setShowZipModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <label htmlFor="zipCode">Enter ZIP Code:</label>
              <input
                id="zipCode"
                type="text"
                value={newZipCode}
                onChange={(e) => {
                  setNewZipCode(e.target.value);
                  setZipError('');
                }}
                placeholder="e.g., 60601"
                maxLength={5}
                className={zipError ? 'input-error' : ''}
              />
              {zipError && <div className="error-message">{zipError}</div>}
            </div>
            <div className="modal-footer">
              <button 
                className="btn-secondary"
                onClick={() => setShowZipModal(false)}
                disabled={savingZip}
              >
                Cancel
              </button>
              <button 
                className="btn-primary"
                onClick={handleSaveZipCode}
                disabled={savingZip}
              >
                {savingZip ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;