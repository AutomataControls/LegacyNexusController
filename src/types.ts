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

export interface SystemInfo {
  hostname: string;
  serial: string;
  location?: string;
  uptime: number;
  cpu_temp: string;
  cpu_usage: string;
  mem_total: number;
  mem_used: number;
  mem_free: number;
  mem_percent: number;
  disk_total: string;
  disk_used: string;
  disk_available: string;
  disk_percent: number;
  timestamp: string;
}

export interface WeatherData {
  temperature: number;
  condition: string;
  humidity: number;
  location: string;
  icon: string;
  windSpeed?: number;
  windDirection?: string;
  pressure?: number;
  feelsLike?: number;
}

export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
    borderWidth: number;
    tension: number;
    fill: boolean;
  }[];
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface AuthToken {
  token: string;
  expiresIn: number;
}

export interface User {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
}

export interface EmailNotification {
  to: string;
  subject: string;
  html: string;
  from?: string;
}