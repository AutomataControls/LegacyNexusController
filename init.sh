#!/bin/bash

# AutomataNexus Remote Portal - Initialization Script
# This script ensures the portal is properly set up and running

echo "=== AutomataNexus Remote Portal Initialization ==="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${YELLOW}[*]${NC} Checking environment..."

# Check if running on Raspberry Pi
if [ -f /proc/device-tree/model ]; then
    MODEL=$(cat /proc/device-tree/model)
    echo -e "${GREEN}[✓]${NC} Running on: $MODEL"
else
    echo -e "${YELLOW}[!]${NC} Not running on Raspberry Pi"
fi

# Check Node.js installation
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}[✓]${NC} Node.js installed: $NODE_VERSION"
else
    echo -e "${RED}[✗]${NC} Node.js not found!"
    exit 1
fi

# Check PM2 installation
if command -v pm2 &> /dev/null; then
    echo -e "${GREEN}[✓]${NC} PM2 is installed"
else
    echo -e "${YELLOW}[!]${NC} PM2 not found, installing..."
    sudo npm install -g pm2
fi

# Check for .env file
if [ ! -f .env ]; then
    echo -e "${RED}[✗]${NC} .env file not found!"
    echo "Please run the installer or create .env file with required configuration"
    exit 1
else
    echo -e "${GREEN}[✓]${NC} Configuration file found"
fi

# Check if data directory exists
if [ ! -d "data" ]; then
    echo -e "${YELLOW}[*]${NC} Creating data directory..."
    mkdir -p data/archives
    echo -e "${GREEN}[✓]${NC} Data directory created"
fi

# Check if logs directory exists
if [ ! -d "logs" ]; then
    echo -e "${YELLOW}[*]${NC} Creating logs directory..."
    mkdir -p logs
    echo -e "${GREEN}[✓]${NC} Logs directory created"
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[*]${NC} Installing dependencies..."
    npm install
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[✓]${NC} Dependencies installed"
    else
        echo -e "${RED}[✗]${NC} Failed to install dependencies"
        exit 1
    fi
else
    echo -e "${GREEN}[✓]${NC} Dependencies already installed"
fi

# Check if build exists
if [ ! -d "dist" ] && [ ! -f "public/bundle.js" ]; then
    echo -e "${YELLOW}[*]${NC} Building application..."
    npm run build
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[✓]${NC} Application built successfully"
    else
        echo -e "${RED}[✗]${NC} Build failed"
        exit 1
    fi
else
    echo -e "${GREEN}[✓]${NC} Application already built"
fi

# Check if portal is running
PM2_STATUS=$(pm2 list | grep "nexus-portal" | grep "online")
if [ -z "$PM2_STATUS" ]; then
    echo -e "${YELLOW}[*]${NC} Starting portal..."
    pm2 start server.js --name nexus-portal -i 1
    pm2 save
    echo -e "${GREEN}[✓]${NC} Portal started"
else
    echo -e "${GREEN}[✓]${NC} Portal is already running"
fi

# Check Node-RED
if command -v node-red &> /dev/null; then
    NODE_RED_PID=$(pgrep -f node-red)
    if [ -z "$NODE_RED_PID" ]; then
        echo -e "${YELLOW}[!]${NC} Node-RED is not running"
        echo "To start Node-RED: node-red &"
    else
        echo -e "${GREEN}[✓]${NC} Node-RED is running (PID: $NODE_RED_PID)"
    fi
else
    echo -e "${YELLOW}[!]${NC} Node-RED not installed"
fi

# Check system services
echo -e "\n${YELLOW}=== Service Status ===${NC}"

# Check nginx
if systemctl is-active --quiet nginx; then
    echo -e "${GREEN}[✓]${NC} NGINX is running"
else
    echo -e "${YELLOW}[!]${NC} NGINX is not running"
fi

# Check cloudflared
if systemctl is-active --quiet cloudflared; then
    echo -e "${GREEN}[✓]${NC} Cloudflared tunnel is running"
else
    echo -e "${YELLOW}[!]${NC} Cloudflared tunnel is not running"
fi

# Display portal information
echo -e "\n${GREEN}=== Portal Information ===${NC}"
echo "Local URL: http://localhost:8000"

# Get tunnel URL from .env if exists
if [ -f .env ]; then
    TUNNEL_DOMAIN=$(grep "TUNNEL_DOMAIN=" .env | cut -d'=' -f2)
    if [ ! -z "$TUNNEL_DOMAIN" ]; then
        echo "Tunnel URL: https://$TUNNEL_DOMAIN"
    fi
fi

echo -e "\n${GREEN}=== Quick Commands ===${NC}"
echo "Restart portal: ./restartnexus.sh (or 'restartnexus' from anywhere)"
echo "View logs: pm2 logs nexus-portal"
echo "Monitor: pm2 monit"
echo "Stop portal: pm2 stop nexus-portal"
echo "Database info: sqlite3 data/metrics.db '.tables'"

echo -e "\n${GREEN}[✓] Initialization complete!${NC}"