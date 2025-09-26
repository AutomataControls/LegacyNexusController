# AutomataControls™ Legacy Integration Package
## AutomataNexusBms Controller - Remote Access Portal for Raspberry Pi 4 Systems (32-bit OS)

![AutomataNexus](https://img.shields.io/badge/AutomataNexus-AI-06b6d4?labelColor=64748b)
![Platform](https://img.shields.io/badge/Platform-Raspberry%20Pi%204-c51a4a)
![Node-RED](https://img.shields.io/badge/Node--RED-v3.0%2B-8F0000)
![React](https://img.shields.io/badge/React-18.2-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Tunnel-F38020)
![License](https://img.shields.io/badge/License-Commercial-red)
![Status](https://img.shields.io/badge/Status-Production%20Ready-success)

**© 2024 AutomataNexus, LLC. All Rights Reserved.**

## 🚀 Overview

The AutomataControls™ Legacy Integration Package provides enterprise-grade remote access capabilities for Raspberry Pi 4 systems running 32-bit Raspberry Pi OS (Bullseye). This comprehensive solution features a React-based web portal with Neural Nexus™ styling, secure Cloudflare tunnel access, and full integration with Node-RED, terminal access, and Neural BMS.

## 🎯 Key Features

### Neural Nexus™ Interface
- **Light Theme Design**: Clean white interface with cyan/teal accents matching Neural Nexus style
- **Weather Display**: Real-time weather information in the top bar
- **System Monitoring**: Live CPU, memory, disk usage with beautiful charts
- **Responsive Layout**: Fully responsive design that adapts to any screen size

### Core Functionality
- **Secure Remote Access**: Cloudflare tunnel for secure access without port forwarding
- **Node-RED Integration**: Full access to Node-RED flows through iframe integration
- **Web Terminal**: Browser-based terminal with xterm.js and Neural Nexus styling
- **Neural BMS Access**: Direct integration with neuralbms.automatacontrols.com
- **Email Notifications**: Resend API integration for system alerts
- **Weather API**: OpenWeatherMap integration for location-based weather
- **Node-RED Readings Widget**: Real-time display of inputs, outputs, and alarms
- **Thresholds Configuration**: Set and manage alarm thresholds with smooth toggle switches

### Security & Authentication
- **API Key Authentication**: Secure API endpoints with authentication middleware
- **Rate Limiting**: Built-in rate limiting for API protection
- **Environment Variables**: All sensitive data stored in .env file
- **Commercial License**: Protected by commercial license agreement
- **User Authentication**: BCrypt password hashing with session management
- **Audit Logging**: Complete audit trail of all user actions

### 📊 Database System
The portal includes a comprehensive SQLite3 database system with automatic management:

#### Five Specialized Databases:
1. **Metrics Database** (`metrics.db`)
   - System performance metrics (CPU, memory, disk, network)
   - Node-RED readings (temperatures, triacs, analog outputs)
   - Real-time data collection every 5 seconds

2. **Users Database** (`users.db`)
   - User accounts with BCrypt password hashing
   - Session management and authentication
   - Role-based permissions system
   - Default admin credentials: `DevOps` / `Invertedskynet2$`

3. **Audit Log Database** (`audit.db`)
   - Complete user action tracking
   - System event logging
   - Configuration change history
   - IP address and user agent tracking

4. **Alarms Database** (`alarms.db`)
   - Active alarm monitoring
   - Alarm history with duration tracking
   - Alarm configurations and thresholds
   - Acknowledgment tracking with notes

5. **Weather Database** (`weather.db`)
   - Current weather conditions
   - 5-day weather forecasts
   - Weather alerts and warnings
   - Historical weather data

#### Data Management Features:
- **7-Day Retention Policy**: Automatic cleanup of data older than 7 days
- **Auto-Compression**: Old data compressed to `.json.gz` archives
- **Rolling Delete**: Automatic cleanup when database exceeds 100MB
- **Archive Management**: 500MB total archive limit with oldest file deletion
- **Daily Cleanup**: Scheduled at 2:00 AM local time
- **Database Vacuuming**: Automatic space reclamation
- **Indexed Tables**: Optimized query performance

## 📦 Package Contents

```
Legacy Integration/
├── setup-tunnel-gui.py          # GUI installer with Neural Nexus styling
├── setup-tunnel.sh              # Command-line installer
├── uninstall-tunnel-gui.py      # GUI uninstaller
├── remote-access-portal/        # React TypeScript portal application
│   ├── src/
│   │   ├── App.tsx             # Main React application
│   │   ├── components/         # React components
│   │   │   ├── WeatherBar.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── pages/              # Page components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── NodeRED.tsx
│   │   │   ├── Terminal.tsx
│   │   │   └── NeuralBMS.tsx
│   │   ├── services/           # API services
│   │   │   └── api.ts
│   │   └── types.ts            # TypeScript definitions
│   ├── public/
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── automata-nexus-logo.png
│   ├── server.js               # Express server with authentication
│   ├── package.json            # Node.js dependencies
│   ├── tsconfig.json           # TypeScript configuration
│   ├── ecosystem.config.js     # PM2 configuration
│   ├── init.sh                 # Portal initialization script
│   ├── init-databases.sh       # Database setup script
│   ├── restartnexus.sh         # Quick restart script
│   ├── claudecode.sh           # Claude Code reinstall script
│   └── SetupNexus.py           # GUI installer
└── README.md                    # This file
```

## 🛠️ Installation

### Prerequisites
- Raspberry Pi 4 with 64GB SD card
- Raspberry Pi OS Bullseye 32-bit (IMPORTANT: Must be 32-bit, not 64-bit)
- Node.js 18+ and npm
- Node-RED installed and running on port 1880
- Internet connection
- Sudo privileges

### Installation Steps

1. **Clone the repository:**
```bash
cd /home/Automata
git clone https://github.com/AutomataControls/LegacyNexusController.git remote-access-portal
cd remote-access-portal
```

2. **Run the GUI installer:**
```bash
sudo python3 SetupNexus.py
```

**Note:** The installer must be run from within the `/home/Automata/remote-access-portal` directory.

The installer will:
1. Display Neural Nexus styled interface
2. Collect installation information:
   - Installation location (required)
   - Equipment ID (optional - for BMS integration)
   - Weather location (required)
   - Web portal port (default: 8000)
3. Generate unique AutomataNexusBms controller serial number
4. Create secure .env configuration file
5. Install all Node.js dependencies
6. Setup Cloudflare tunnel
7. Configure systemd services for auto-start

## 🔧 Configuration

### Environment Variables
The installer automatically generates a `.env` file with all necessary configuration:

```env
# Controller Information
CONTROLLER_SERIAL=<auto-generated>
CONTROLLER_NAME=AutomataNexusBms Controller
LOCATION=<user-provided>

# Server Configuration
PORT=8000
HOST=0.0.0.0
NODE_ENV=production

# Weather Configuration
WEATHER_ENABLED=true
WEATHER_LOCATION=<user-provided>
WEATHER_UNITS=imperial

# BMS Configuration
BMS_ENABLED=<true/false>
BMS_EQUIPMENT_ID=<user-provided>

# Security & Monitoring
ENABLE_MONITORING=true
LOG_LEVEL=info
RATE_LIMIT=100
```

**Note**: API keys are securely embedded in the installer and automatically configured. Never share your .env file.

## 🚦 Service Management

### PM2 Process Management
The portal runs under PM2 process manager with the name `nexus-portal`.

### Quick Commands
```bash
# Restart portal (recommended method)
./restartnexus.sh
# OR from anywhere:
restartnexus

# Check PM2 status
pm2 status

# View logs
pm2 logs nexus-portal

# Stop portal
pm2 stop nexus-portal

# Start portal
pm2 start nexus-portal

# Monitor all processes
pm2 monit
```

### Cloudflare Tunnel
```bash
# Start tunnel
sudo systemctl start cloudflared

# Stop tunnel
sudo systemctl stop cloudflared

# Check status
sudo systemctl status cloudflared

# View logs
sudo journalctl -u cloudflared -f
```

### Database Initialization
```bash
# Initialize all databases
./init-databases.sh

# Check database contents
sqlite3 data/metrics.db '.tables'
sqlite3 data/metrics.db 'SELECT COUNT(*) FROM nodered_readings;'
```

## 🌐 Accessing Your Portal

After successful installation, your portal will be accessible at:

1. **Local Access**: `http://localhost:<PORT>` (default: 8000)
2. **Remote Access**: `https://<serial-number>.automatacontrols.com`

### Portal Features
- **Dashboard**: Real-time system metrics with charts
- **Node-RED**: Access your flows at `/node-red`
- **Terminal**: Full bash terminal in browser
- **Neural BMS**: Direct access to BMS interface

## 🏗️ Architecture

### Technology Stack
- **Frontend**: React 18.2 with TypeScript
- **Styling**: Neural Nexus design system (light theme)
- **Backend**: Node.js with Express
- **Terminal**: xterm.js with Socket.IO
- **Charts**: Chart.js with react-chartjs-2
- **Authentication**: JWT with API key middleware
- **Email**: Resend API
- **Weather**: OpenWeatherMap API
- **Tunnel**: Cloudflare Zero Trust

### Security Features
- API authentication on all endpoints
- Rate limiting (100 requests/15 min)
- Environment-based configuration
- Secure WebSocket connections
- CORS protection
- Helmet.js security headers

## 📊 System Requirements

### Minimum Requirements
- Raspberry Pi 4 (2GB RAM minimum, 4GB recommended)
- 64GB SD card (Class 10 or better)
- Raspberry Pi OS Bullseye 32-bit (MUST be 32-bit for compatibility)
- Active internet connection

### Software Dependencies
Automatically installed by the installer:
- Node.js packages (Express, React, TypeScript, etc.)
- Python packages (for GUI installer)
- System packages (cloudflared)

## 🔍 Troubleshooting

### Portal Not Starting
1. Check if port is already in use
2. Verify .env file exists and is properly configured
3. Check PM2 logs: `pm2 logs nexus-portal --lines 50`

### Tunnel Not Connecting
1. Verify internet connection
2. Check cloudflared service: `sudo systemctl status cloudflared`
3. Review tunnel logs: `sudo journalctl -u cloudflared -f`

### Node-RED Not Displaying
1. Ensure Node-RED is running: `sudo systemctl status nodered`
2. Verify it's accessible on port 1880
3. Check browser console for errors

### Terminal Not Working
1. Verify Socket.IO connection
2. Check for WebSocket errors in browser console
3. Ensure node-pty is properly installed

## 🚫 Commercial License

This software is protected by commercial license and is the property of AutomataNexus, LLC.

**PROPRIETARY AND CONFIDENTIAL**
- This software constitutes valuable trade secrets
- Unauthorized use, copying, or distribution is strictly prohibited
- Use requires a valid commercial license agreement
- Contact AutomataNexus for licensing information

## 📞 Support

For commercial support and licensing:
- **Company**: AutomataNexus, LLC
- **Software**: AutomataControls™
- **Controller**: AutomataNexusBms Controller
- **Email**: Contact your AutomataNexus representative

## 🔄 Updates

To update the portal:
1. Backup your current configuration
2. Run the uninstaller
3. Download latest version
4. Run the installer with same configuration

## ⚠️ Important Notes

1. **Security**: Keep your .env file secure and never commit it to version control
2. **Backups**: Regularly backup your configuration and Node-RED flows
3. **Updates**: Check for updates regularly for security patches
4. **License**: Ensure you have a valid commercial license for production use
5. **Support**: Commercial support available for licensed users

---

**AutomataControls™** - Enterprise HVAC Control Solutions  
**© 2024 AutomataNexus, LLC. All Rights Reserved.**