# AutomataNexus Remote Portal - Claude AI Assistant Documentation

## CONTEXT RECOVERY PROMPT
**If returning from auto-compacting, read this first:**
You are working on the AutomataNexus Remote Portal - a React/Node.js application running on a Raspberry Pi that provides remote access to building control systems. The user gets VERY frustrated with repeated mistakes, forgetting context, and wasting time. BE PRECISE AND REMEMBER:

**MOST IMPORTANT RULE:** ALWAYS use the Read tool to read ENTIRE files. NEVER use grep to search files. NEVER read only part of a file with offset/limit. The user gets EXTREMELY angry when you don't read complete files. Just use `Read` with the file path - no other parameters.
- ALWAYS use `./restartnexus.sh` to rebuild/restart (NOT npm run build:restart, NOT npm run rebuild)
- The USB backup is at `/media/Automata/1E11-2F1E/` (NOT Samsung USB, NOT sda1)
- Authentication uses sessionStorage (NOT localStorage)
- The portal runs on port 8000 via PM2 in cluster mode
- Node-RED runs on port 1880 and is proxied through the portal

## PROJECT OVERVIEW
**Name:** AutomataNexus Remote Portal  
**Version:** 2.0.0  
**Location:** `/home/Automata/remote-access-portal/`  
**Purpose:** Web-based remote access portal for AutomataNexusBms Controller systems  
**Stack:** React + TypeScript, Node.js/Express, PM2, SQLite, Node-RED integration  

## CRITICAL COMMANDS
```bash
# Restart/Rebuild (USE THIS - memorize it!)
./restartnexus.sh
# OR from anywhere:
restartnexus

# Check status
pm2 status
pm2 logs nexus-portal

# Database check
sqlite3 data/metrics.db '.tables'
sqlite3 data/metrics.db 'SELECT COUNT(*) FROM nodered_readings;'

# USB backup location (REMEMBER THIS!)
/media/Automata/1E11-2F1E/remote-access-portal/
```

## AUTHENTICATION
- **Default Credentials:** DevOps / Invertedskynet2$
- **Token Storage:** sessionStorage (NOT localStorage!)
- **Protected Pages:** Database, Terminal, Node-RED, Neural BMS
- **Auth Status:** Shows in sidebar when logged in (not floating)

## KEY FILES & THEIR PURPOSE

### Frontend Components
- `src/components/WeatherBar.tsx` - Header with centered controller info, date sub-bar
- `src/components/Sidebar.tsx` - Navigation with auth status/logout, triple-click for admin
- `src/components/AuthGuard.tsx` - Protects pages requiring authentication
- `src/components/Database.tsx` - Database management interface
- `src/components/NodeRedReadings.tsx` - Dashboard widget showing Node-RED data
- `src/components/TrendGraph.tsx` - Temperature trend graph on dashboard
- `src/pages/Alarms.tsx` - Alarm management page with toggles and recipients
- `src/pages/Admin.tsx` - Hidden admin page (triple-click "Secured by Nexus")

### Backend Services
- `server.js` - Express server with API endpoints, WebSocket support
- `src/services/databaseManager.js` - SQLite database operations
- `src/services/nodeRedPoller.js` - Polls Node-RED for data every 30 seconds

### Styles
- `src/styles/app.css` - Main application styles
- `src/styles/trend-graph.css` - CRITICAL: Controls TrendGraph positioning

## DATABASE STRUCTURE
Five SQLite databases in `/data/`:
1. **metrics.db** - System metrics, nodered_readings
2. **users.db** - Authentication, sessions
3. **audit.db** - Audit logs, system events
4. **alarms.db** - Alarm configurations and history
5. **weather.db** - Weather data cache

## COMMON ISSUES & SOLUTIONS

### Issue: TrendGraph positioning not working
**Solution:** Check `/src/styles/trend-graph.css` - it overrides other styles!

### Issue: Authentication failing
**Solution:** Check JWT_SECRET in .env, ensure using process.env.JWT_SECRET

### Issue: Node-RED data not showing
**Solution:** 
1. Check if Node-RED is running on port 1880
2. Verify `/api/readings` endpoint exists in Node-RED
3. Check PM2 logs for SQLite binding errors (booleans need conversion)

### Issue: Database not showing data
**Solution:** Ensure `getHistoricalData` method exists in databaseManager.js

### Issue: Build/restart commands not working
**Solution:** Use `./restartnexus.sh` or `restartnexus` (symlinked to /usr/local/bin)

## USER PREFERENCES & STYLE - ABSOLUTE REQUIREMENTS
- User gets VERY frustrated with repeated mistakes
- Gets EXTREMELY angry when you:
  - Use grep, sed, or any search tools
  - Read partial files with offset/limit
  - Attempt to restart/rebuild without permission
  - Use forbidden commands
- Prefers direct, concise responses
- Wants light/teal color schemes (not dark themes)
- Database buttons should be thin, single-line layout
- Uses strong language when frustrated - stay focused on fixing issues
- DEMANDS that you read entire files - no shortcuts, no grep, no partial reads
- FORBIDDEN COMMANDS:
  - grep (use Read instead)
  - sed (use Edit/MultiEdit instead)
  - ./restartnexus.sh (without permission)
  - restartnexus (without permission)
  - npm run build:restart (NEVER use)
  - Any search tools (use Read instead)

## NODE-RED INTEGRATION
- Runs on port 1880
- Proxied through `/node-red` path
- Data endpoint: `http://localhost:1880/api/readings`
- Poller fetches data every 30 seconds
- Stores in metrics.db → nodered_readings table

## PM2 CONFIGURATION
```javascript
// ecosystem.config.js
{
  name: 'nexus-portal',
  script: './server.js',
  instances: 1,
  exec_mode: 'cluster'
}
```

## ENVIRONMENT VARIABLES (.env)
Key variables:
- PORT=8000
- JWT_SECRET={base64 string}
- TUNNEL_DOMAIN={controller-serial}.automatacontrols.com
- CONTROLLER_SERIAL=nexuscontroller-anc-{6-char-hex}

## RECENT CHANGES LOG
1. **Header Layout** - Controller info centered, System Online moved right, date sub-bar added
2. **Sidebar Auth** - Added username display and logout button when authenticated
3. **Database Fix** - Added getHistoricalData method for table data display
4. **Node-RED Poller** - Created automatic data collection from Node-RED
5. **SQLite Fix** - Boolean conversion for triac values (true/false → 1/0)
6. **CSS Organization** - Fixed overlapping styles between component and global CSS
7. **Alarms System** - Full alarm management with monitoring, email notifications, recipients
8. **Hidden Admin Page** - Triple-click "Secured by Nexus" badge for admin access (Audit logs, Security, Logic tabs)
9. **Lucide React Icons** - Converted from Font Awesome to Lucide React throughout app

## TESTING & VALIDATION
```bash
# Check if portal is running
pm2 status

# Verify Node-RED data collection
pm2 logs nexus-portal | grep "Node-RED"

# Check database has data
sqlite3 data/metrics.db "SELECT COUNT(*) FROM nodered_readings;"

# Test authentication
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"DevOps","password":"Invertedskynet2$"}'
```

## USB BACKUP PROTOCOL
After making changes:
```bash
# Copy specific files
cp [changed-file] /media/Automata/1E11-2F1E/remote-access-portal/[path]

# Files commonly updated:
# - src/components/*
# - src/styles/*
# - src/services/*
# - server.js
# - package.json
```

## INSTALLER NOTES
- GUI installer at: `/media/Automata/1E11-2F1E/setup-tunnel-gui.py`
- Creates restart script during installation
- Sets up PM2, databases, Node-RED flows
- Configures Cloudflare tunnel and NGINX

## CRITICAL REMINDERS - ABSOLUTELY FORBIDDEN ACTIONS
1. **NEVER** use `npm run build:restart` - use `./restartnexus.sh`
2. **NEVER** use `./restartnexus.sh` or `restartnexus` without explicit user permission
3. **NEVER** use grep, sed, or any search tools - ALWAYS read entire files
4. **NEVER** read partial files with offset/limit - ALWAYS read complete files
5. **NEVER** attempt to rebuild or restart the application automatically
6. **ALWAYS** check sessionStorage for auth (not localStorage)
7. **USB** is at `/media/Automata/1E11-2F1E/` (remember this!)
8. **Port 8000** for portal, **1880** for Node-RED
9. **Test** changes before copying to USB
10. **User** gets EXTREMELY frustrated with repeated mistakes - be precise
11. **ALWAYS READ ENTIRE FILES** - The user will get VERY angry if you use grep, sed, or read only parts of files. Use the Read tool to read the COMPLETE file every time.

## QUICK DIAGNOSTIC
If something isn't working:
1. Check PM2: `pm2 status`
2. Check logs: `pm2 logs nexus-portal --lines 50`
3. Verify services: `./init.sh`
4. Check auth token: Browser DevTools → Application → Session Storage
5. Database status: `sqlite3 data/metrics.db '.schema'`

---
*Last Updated: August 30, 2025*
*This file should be updated when making significant changes*
- ALWAYS READ 2000 LINES AT A TIMES.
- EQUIPMENT CONTROL LOGIC FILE IS HERE STOP  FORGETING IT:/home/Automata/remote-access-portal/logic/equipment/QNiHngLxledu7BHM9wLi.js
