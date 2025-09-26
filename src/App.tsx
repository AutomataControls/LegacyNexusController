/*
 * AutomataControls™ Remote Portal
 * Copyright © 2024 AutomataNexus, LLC. All rights reserved.
 * 
 * PROPRIETARY AND CONFIDENTIAL
 * This software is proprietary to AutomataNexus and constitutes valuable 
 * trade secrets. This software may not be copied, distributed, modified, 
 * or disclosed to third parties without prior written authorization from 
 * AutomataNexus. Use of this software is governed by a commercial license
 * agreement. Unauthorized use is strictly prohibited.
 * 
 * AutomataNexusBms Controller Software
 */

import React, { useState, useEffect, lazy, Suspense } from 'react';
const WeatherBar = lazy(() => import('./components/WeatherBar'));
const Sidebar = lazy(() => import('./components/Sidebar'));
const AppFooter = lazy(() => import('./components/AppFooter'));
import AuthGuard from './components/AuthGuard';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const NodeRED = lazy(() => import('./pages/NodeRED'));
const Terminal = lazy(() => import('./pages/Terminal'));
const NeuralBMS = lazy(() => import('./pages/NeuralBMS'));
const Database = lazy(() => import('./components/Database'));
const Thresholds = lazy(() => import('./pages/Thresholds'));
const Alarms = lazy(() => import('./pages/Alarms'));
const VibrationMonitor = lazy(() => import('./pages/VibrationMonitor'));
const Admin = lazy(() => import('./pages/Admin'));
const Controls = lazy(() => import('./pages/Controls'));
import { authenticatedFetch } from './services/api';
import { SystemInfo, WeatherData } from './types';
import './styles/app.css';
import './styles/dashboard.css';
import './styles/nodered-readings.css';
import './styles/trend-graph.css';
import './styles/controls.css';

const App: React.FC = () => {
  // Get initial view from URL hash or default to dashboard
  const getInitialView = () => {
    const hash = window.location.hash.replace('#', '');
    return hash || 'dashboard';
  };
  
  const [currentView, setCurrentView] = useState<string>(getInitialView());
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  
  // Update URL hash when view changes
  const handleViewChange = (view: string) => {
    setCurrentView(view);
    window.location.hash = view;
  };
  
  // Listen for browser back/forward navigation
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash) {
        setCurrentView(hash);
      }
    };
    
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Fetch system info
  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const response = await authenticatedFetch('/api/system-info');
        if (response.ok) {
          const data = await response.json();
          setSystemInfo(data);
        }
      } catch (error) {
        console.error('Failed to fetch system info:', error);
      }
    };

    fetchSystemInfo();
    const interval = setInterval(fetchSystemInfo, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch weather data
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
    const interval = setInterval(fetchWeather, 600000); // 10 minutes
    return () => clearInterval(interval);
  }, []);

  const renderContent = () => {
    const component = (() => {
      switch (currentView) {
        case 'dashboard':
          return <Dashboard systemInfo={systemInfo} />;
        case 'controls':
          return (
            <AuthGuard requiredAuth={true}>
              <Controls />
            </AuthGuard>
          );
        case 'nodered':
          return (
            <AuthGuard requiredAuth={true}>
              <NodeRED />
            </AuthGuard>
          );
        case 'terminal':
          return (
            <AuthGuard requiredAuth={true}>
              <Terminal />
            </AuthGuard>
          );
        case 'database':
          return (
            <AuthGuard requiredAuth={true}>
              <Database />
            </AuthGuard>
          );
        case 'neuralbms':
          return (
            <AuthGuard requiredAuth={true}>
              <NeuralBMS />
            </AuthGuard>
          );
        case 'thresholds':
          return <Thresholds />;
        case 'alarms':
          return <Alarms />;
        case 'vibration':
          return (
            <AuthGuard requiredAuth={true}>
              <VibrationMonitor />
            </AuthGuard>
          );
        case 'admin':
          return <Admin />;
        default:
          return <Dashboard systemInfo={systemInfo} />;
      }
    })();

    return (
      <Suspense fallback={
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      }>
        {component}
      </Suspense>
    );
  };

  return (
    <div id="app-root">
      <Suspense fallback={<div className="weather-bar-placeholder" style={{height: '60px'}} />}>
        <WeatherBar systemInfo={systemInfo} weatherData={weatherData} />
      </Suspense>
      <div className="main-container">
        <Suspense fallback={<div className="sidebar-placeholder" style={{width: '200px'}} />}>
          <Sidebar currentView={currentView} onViewChange={handleViewChange} />
        </Suspense>
        <main className="content">
          <div className="content-inner">
            {renderContent()}
          </div>
        </main>
      </div>
      <Suspense fallback={null}>
        <AppFooter />
      </Suspense>
    </div>
  );
};

export default App;