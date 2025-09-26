#!/bin/bash

# Change to the project directory
cd /home/Automata/remote-access-portal

echo "=== Restarting Nexus Portal ==="

# Stop PM2 process
echo "Stopping PM2 process..."
pm2 stop nexus-portal 2>/dev/null || true

# Delete PM2 process
echo "Deleting PM2 process..."
pm2 delete nexus-portal 2>/dev/null || true

# Clear build cache and dist
echo "Clearing cache and dist..."
rm -rf dist/*
rm -rf .next
rm -rf node_modules/.cache
rm -rf public/static/*

# Build the application
echo "Building application..."
npm run build

# Start with PM2 using ecosystem config
echo "Starting with PM2..."
pm2 start ecosystem.config.js --only nexus-portal

# Start local controller service if logic files exist
if [ -d "logic/equipment" ] && [ "$(ls -A logic/equipment 2>/dev/null)" ]; then
  echo "Starting local controller service..."
  pm2 start localController.config.js 2>/dev/null || true
fi

echo "=== Nexus Portal restarted successfully ==="
pm2 status
