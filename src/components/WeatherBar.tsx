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

import React from 'react';
import { Satellite } from 'lucide-react';
import { SystemInfo, WeatherData } from '../types';

interface WeatherBarProps {
  systemInfo: SystemInfo | null;
  weatherData: WeatherData | null;
}

const WeatherBar: React.FC<WeatherBarProps> = ({ systemInfo }) => {
  // Format date as full text
  const getFullDate = () => {
    const date = new Date();
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    };
    return date.toLocaleDateString('en-US', options);
  };

  return (
    <>
      <div className="weather-bar">
        <div className="weather-left">
          <div className="logo-section">
            <img 
              src="/automata-nexus-logo.png?v=2" 
              alt="AutomataNexus" 
              className="logo-image"
            />
            <div className="logo-text">
              <span className="logo-primary">AutomataControls</span>
              <span className="logo-secondary">Neural Nexus™</span>
            </div>
          </div>
        </div>
        
        <div className="weather-center">
          <div className="controller-info">
            <div className="controller-label">Controller</div>
            <div className="controller-serial">
              {systemInfo?.serial || 'AutomataNexusBms-XXXXXX'}
            </div>
            {systemInfo?.location && (
              <div className="controller-location">
                <i className="ri-map-pin-line"></i> {systemInfo.location}
              </div>
            )}
          </div>
        </div>
        
        <div className="weather-right">
          <div className="system-status">
            <Satellite className="satellite-icon" size={20} />
            <span className="status-text">System Online</span>
          </div>
        </div>
      </div>
      
      <div className="sub-weather-bar">
        <div className="full-date">
          {getFullDate()}
        </div>
      </div>
    </>
  );
};

export default WeatherBar;