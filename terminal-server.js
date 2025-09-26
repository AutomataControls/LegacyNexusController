const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const pty = require('node-pty');

// Serve static files
app.use(express.static(path.join(__dirname, 'templates')));
app.use(express.static(path.join(__dirname, 'static')));
app.use('/xterm', express.static(path.join(__dirname, 'node_modules/xterm')));
app.use('/xterm-addon-fit', express.static(path.join(__dirname, 'node_modules/xterm-addon-fit')));

// Store terminal sessions
const terminals = {};

// System info endpoint
app.get('/api/system-info', async (req, res) => {
  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  
  try {
    const hostname = require('os').hostname();
    const cpuTemp = await execPromise('vcgencmd measure_temp').then(r => r.stdout.trim().split('=')[1]).catch(() => 'N/A');
    const memInfo = await execPromise('free -m').then(r => {
      const lines = r.stdout.split('\n');
      const mem = lines[1].split(/\s+/);
      return {
        total: parseInt(mem[1]),
        used: parseInt(mem[2]),
        percent: Math.round((parseInt(mem[2]) / parseInt(mem[1])) * 100)
      };
    });
    
    res.json({
      hostname,
      cpu_temp: cpuTemp,
      mem_total: memInfo.total,
      mem_used: memInfo.used,
      mem_percent: memInfo.percent,
      serial: 'NexusController-anc-11E252'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Main page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Automata Remote Access Portal</title>
      <link rel="stylesheet" href="/xterm/css/xterm.css" />
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
        .header { background: linear-gradient(to right, #374151, #14b8a6); color: white; padding: 20px; }
        .nav { background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 10px; }
        .nav button { margin: 0 5px; padding: 10px 20px; border: none; background: #f3f4f6; cursor: pointer; }
        .nav button.active { background: #14b8a6; color: white; }
        .content { padding: 20px; height: calc(100vh - 200px); }
        iframe { width: 100%; height: 100%; border: none; }
        #terminal-container { width: 100%; height: 100%; background: black; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Automata Remote Access Portal</h1>
        <p>Controller: NexusController-anc-11E252</p>
      </div>
      <div class="nav">
        <button onclick="showDashboard()" id="btn-dashboard" class="active">Dashboard</button>
        <button onclick="showNodeRed()" id="btn-nodered">Node-RED</button>
        <button onclick="showTerminal()" id="btn-terminal">Terminal</button>
        <button onclick="showNeuralBMS()" id="btn-neuralbms">Neural BMS</button>
      </div>
      <div class="content" id="content">
        <h2>System Dashboard</h2>
        <div id="system-info">Loading...</div>
      </div>
      
      <script src="/socket.io/socket.io.js"></script>
      <script src="/xterm/lib/xterm.js"></script>
      <script src="/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
      <script>
        let socket = null;
        let term = null;
        let fitAddon = null;
        
        function clearActive() {
          document.querySelectorAll('.nav button').forEach(btn => btn.classList.remove('active'));
        }
        
        function cleanupTerminal() {
          if (term) {
            term.dispose();
            term = null;
          }
          if (socket) {
            socket.disconnect();
            socket = null;
          }
        }
        
        function showDashboard() {
          clearActive();
          cleanupTerminal();
          document.getElementById('btn-dashboard').classList.add('active');
          document.getElementById('content').innerHTML = '<h2>System Dashboard</h2><div id="system-info">Loading...</div>';
          updateSystemInfo();
        }
        
        function showNodeRed() {
          clearActive();
          cleanupTerminal();
          document.getElementById('btn-nodered').classList.add('active');
          document.getElementById('content').innerHTML = '<iframe src="/node-red/" id="nodered-frame"></iframe>';
        }
        
        function showTerminal() {
          clearActive();
          cleanupTerminal();
          document.getElementById('btn-terminal').classList.add('active');
          document.getElementById('content').innerHTML = '<div id="terminal-container"></div>';
          
          // Initialize xterm.js
          term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
              background: '#000000',
              foreground: '#ffffff'
            }
          });
          
          fitAddon = new FitAddon.FitAddon();
          term.loadAddon(fitAddon);
          term.open(document.getElementById('terminal-container'));
          fitAddon.fit();
          
          // Connect to socket
          socket = io();
          
          socket.on('connect', () => {
            socket.emit('terminal-init', { cols: term.cols, rows: term.rows });
          });
          
          socket.on('terminal-output', (data) => {
            term.write(data);
          });
          
          term.onData((data) => {
            socket.emit('terminal-input', data);
          });
          
          term.onResize((size) => {
            socket.emit('terminal-resize', { cols: size.cols, rows: size.rows });
          });
          
          window.addEventListener('resize', () => {
            if (fitAddon) fitAddon.fit();
          });
        }
        
        function showNeuralBMS() {
          clearActive();
          cleanupTerminal();
          document.getElementById('btn-neuralbms').classList.add('active');
          // Embed Neural BMS directly
          document.getElementById('content').innerHTML = '<iframe src="https://neuralbms.automatacontrols.com/login" id="neuralbms-frame"></iframe>';
        }
        
        async function updateSystemInfo() {
          try {
            const response = await fetch('/api/system-info');
            const data = await response.json();
            const infoDiv = document.getElementById('system-info');
            if (infoDiv) {
              infoDiv.innerHTML = \`
                <p>Hostname: \${data.hostname}</p>
                <p>CPU Temperature: \${data.cpu_temp}</p>
                <p>Memory: \${data.mem_used}MB / \${data.mem_total}MB (\${data.mem_percent}%)</p>
              \`;
            }
          } catch (error) {
            console.error('Failed to fetch system info:', error);
          }
        }
        
        // Update system info every 5 seconds
        setInterval(updateSystemInfo, 5000);
        updateSystemInfo();
      </script>
    </body>
    </html>
  `);
});

// Socket.IO terminal handling
io.on('connection', (socket) => {
  console.log('Terminal connection established');
  
  socket.on('terminal-init', (data) => {
    const term = pty.spawn('bash', [], {
      name: 'xterm-color',
      cols: data.cols || 80,
      rows: data.rows || 24,
      cwd: process.env.HOME,
      env: process.env
    });
    
    terminals[socket.id] = term;
    
    term.onData((data) => {
      socket.emit('terminal-output', data);
    });
    
    socket.emit('terminal-output', `Welcome to Automata Controller Terminal\r\n`);
  });
  
  socket.on('terminal-input', (data) => {
    if (terminals[socket.id]) {
      terminals[socket.id].write(data);
    }
  });
  
  socket.on('terminal-resize', (data) => {
    if (terminals[socket.id]) {
      terminals[socket.id].resize(data.cols, data.rows);
    }
  });
  
  socket.on('disconnect', () => {
    if (terminals[socket.id]) {
      terminals[socket.id].kill();
      delete terminals[socket.id];
    }
  });
});

// Start server
const PORT = 8001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Terminal server running on port ${PORT}`);
  console.log(`Web terminal and Node-RED proxy available`);
});