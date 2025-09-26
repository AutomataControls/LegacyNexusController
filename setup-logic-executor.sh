#!/bin/bash

echo "Setting up Logic Executor Service for auto-start on boot..."

# Make sure PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    sudo npm install -g pm2
fi

# Start the logic executor service
echo "Starting logic executor service..."
cd /home/Automata/remote-access-portal
pm2 start logicExecutor.config.js

# Save PM2 configuration
echo "Saving PM2 configuration..."
pm2 save

# Generate startup script for system boot
echo "Setting up auto-start on boot..."
pm2 startup systemd -u Automata --hp /home/Automata

# The above command will output a command to run with sudo
# For Raspberry Pi, it's typically:
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u Automata --hp /home/Automata

# Save the PM2 process list
pm2 save

echo "Logic Executor Service setup complete!"
echo ""
echo "The service will now:"
echo "  1. Continue running even when you close the browser/SSH"
echo "  2. Automatically restart if it crashes"
echo "  3. Start automatically on system boot"
echo ""
echo "Useful commands:"
echo "  pm2 status          - Check service status"
echo "  pm2 logs logic-executor - View service logs"
echo "  pm2 restart logic-executor - Restart the service"
echo "  pm2 stop logic-executor - Stop the service"
echo ""