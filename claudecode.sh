#!/bin/bash

# Claude Code Clean Reinstall Script
# This script performs a clean reinstall of Claude Code when it crashes or malfunctions

echo "===================================="
echo "Claude Code Clean Reinstall"
echo "===================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running with sudo
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}[!]${NC} This script must be run with sudo"
   echo "Usage: sudo ./reinstall-claude-code.sh"
   exit 1
fi

echo -e "${YELLOW}[*]${NC} Starting Claude Code clean reinstall..."

# Step 1: Uninstall existing Claude Code
echo -e "${YELLOW}[*]${NC} Uninstalling existing Claude Code..."
npm uninstall -g @anthropic-ai/claude-code 2>/dev/null
if [ $? -eq 0 ]; then
    echo -e "${GREEN}[✓]${NC} Uninstalled Claude Code package"
else
    echo -e "${YELLOW}[!]${NC} Claude Code package not found or already uninstalled"
fi

# Step 2: Remove any remaining Claude Code directories
echo -e "${YELLOW}[*]${NC} Removing Claude Code directories..."
rm -rf /usr/lib/node_modules/@anthropic-ai/claude-code 2>/dev/null
rm -rf /usr/lib/node_modules/@anthropic-ai/.claude-code* 2>/dev/null
echo -e "${GREEN}[✓]${NC} Cleaned up Claude Code directories"

# Step 3: Clear npm cache to ensure clean install
echo -e "${YELLOW}[*]${NC} Clearing npm cache..."
npm cache clean --force 2>/dev/null
echo -e "${GREEN}[✓]${NC} npm cache cleared"

# Step 4: Install Claude Code for ARM64 Linux
echo -e "${YELLOW}[*]${NC} Installing Claude Code for ARM64 Linux..."
npm install -g @anthropic-ai/claude-code --target_arch=arm64 --target_platform=linux

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[✓]${NC} Claude Code successfully installed!"

    # Verify installation
    CLAUDE_VERSION=$(claude --version 2>/dev/null)
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[✓]${NC} Installation verified - Version: $CLAUDE_VERSION"
        echo ""
        echo -e "${GREEN}===================================="
        echo "Claude Code Reinstall Complete!"
        echo "===================================="
        echo ""
        echo "You can now use Claude Code by running: claude"
    else
        echo -e "${YELLOW}[!]${NC} Claude Code installed but 'claude' command not found in PATH"
        echo "You may need to restart your terminal or run: source ~/.bashrc"
    fi
else
    echo -e "${RED}[✗]${NC} Failed to install Claude Code"
    echo "Please check your internet connection and try again"
    echo ""
    echo "If the problem persists, try:"
    echo "1. Check Node.js version: node --version (should be 18+)"
    echo "2. Check npm version: npm --version"
    echo "3. Check internet connectivity"
    echo "4. Review the error messages above"
    exit 1
fi

echo ""
echo -e "${YELLOW}Tips:${NC}"
echo "- If Claude Code crashes frequently, check system resources with: free -h"
echo "- Monitor Claude Code logs with: claude --debug"
echo "- For persistent issues, check Node.js compatibility"