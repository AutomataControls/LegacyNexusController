#!/bin/bash
# AutomataNexus Portal Fullscreen Launcher
sleep 10  # Wait for X server and network
export DISPLAY=:0
chromium-browser --kiosk --noerrdialogs --disable-infobars --no-first-run --disable-translate "http://localhost:8000" &
