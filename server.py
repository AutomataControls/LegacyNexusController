#!/usr/bin/env python3
"""
Automata Remote Access Portal
Multi-page web server with Node-RED, Terminal, and Neural BMS access
Styled to match Neural Nexus application
Version: 1.0.0
"""

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit
import subprocess
import os
import pty
import select
import termios
import struct
import fcntl
import json
import base64
import secrets
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(32)
socketio = SocketIO(app, cors_allowed_origins="*")

# Store terminal sessions
terminals = {}

# Configuration
CONFIG = {
    'node_red_url': 'http://127.0.0.1:1880',
    'neural_bms_url': 'https://neuralbms.automatacontrols.com',
    'controller_serial': None,  # Will be loaded from config file
    'portal_port': 8000
}

def load_config():
    """Load configuration from tunnel setup"""
    config_file = '/home/Automata/tunnel-config.txt'
    if os.path.exists(config_file):
        with open(config_file, 'r') as f:
            for line in f:
                if line.startswith('CONTROLLER_SERIAL='):
                    CONFIG['controller_serial'] = line.split('=')[1].strip()
    else:
        # Fallback to hostname-based serial
        hostname = os.uname().nodename
        CONFIG['controller_serial'] = f"Controller-{hostname}"

@app.route('/')
def index():
    """Main dashboard page"""
    return render_template('dashboard.html', 
                         serial=CONFIG['controller_serial'],
                         timestamp=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

@app.route('/nodered')
def nodered():
    """Node-RED iframe page"""
    return render_template('nodered.html', 
                         node_red_url=CONFIG['node_red_url'],
                         serial=CONFIG['controller_serial'])

@app.route('/terminal')
def terminal():
    """Terminal page"""
    return render_template('terminal.html',
                         serial=CONFIG['controller_serial'])

@app.route('/neuralbms')
def neuralbms():
    """Neural BMS iframe page"""
    return render_template('neuralbms.html',
                         neural_bms_url=CONFIG['neural_bms_url'],
                         serial=CONFIG['controller_serial'])

@app.route('/api/system-info')
def system_info():
    """Get system information"""
    try:
        # Get CPU info
        cpu_temp = subprocess.check_output(['vcgencmd', 'measure_temp'], text=True).strip().split('=')[1]
        cpu_usage = subprocess.check_output(['top', '-bn1'], text=True)
        cpu_percent = float([line for line in cpu_usage.split('\n') if 'Cpu(s)' in line][0].split()[1])
        
        # Get memory info
        mem_info = subprocess.check_output(['free', '-m'], text=True).split('\n')[1].split()
        mem_total = int(mem_info[1])
        mem_used = int(mem_info[2])
        mem_percent = round((mem_used / mem_total) * 100, 1)
        
        # Get disk info
        disk_info = subprocess.check_output(['df', '-h', '/'], text=True).split('\n')[1].split()
        disk_used = disk_info[2]
        disk_percent = disk_info[4]
        
        # Get network info
        hostname = os.uname().nodename
        try:
            ip_addr = subprocess.check_output(['hostname', '-I'], text=True).split()[0]
        except:
            ip_addr = '127.0.0.1'
        
        # Check services
        services = {}
        for service in ['nodered', 'cloudflared']:
            try:
                status = subprocess.check_output(['systemctl', 'is-active', service], text=True).strip()
                services[service] = status == 'active'
            except:
                services[service] = False
        
        return jsonify({
            'cpu_temp': cpu_temp,
            'cpu_usage': cpu_percent,
            'mem_total': mem_total,
            'mem_used': mem_used,
            'mem_percent': mem_percent,
            'disk_used': disk_used,
            'disk_percent': disk_percent,
            'hostname': hostname,
            'ip_address': ip_addr,
            'serial': CONFIG['controller_serial'],
            'services': services,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Terminal WebSocket handlers
@socketio.on('terminal_connect')
def handle_terminal_connect(data):
    """Initialize a new terminal session"""
    session_id = request.sid
    
    if session_id in terminals:
        return
    
    # Create pseudo terminal
    master_fd, slave_fd = pty.openpty()
    
    # Start bash process
    p = subprocess.Popen(
        ['/bin/bash'],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        preexec_fn=os.setsid
    )
    
    terminals[session_id] = {
        'master_fd': master_fd,
        'slave_fd': slave_fd,
        'process': p
    }
    
    # Set terminal size
    if 'cols' in data and 'rows' in data:
        handle_terminal_resize({
            'cols': data['cols'],
            'rows': data['rows']
        })
    
    # Start reading output
    socketio.start_background_task(target=read_terminal_output, session_id=session_id)
    
    emit('terminal_output', {'data': f'Connected to {CONFIG["controller_serial"]}\r\n'})

@socketio.on('terminal_input')
def handle_terminal_input(data):
    """Handle terminal input from client"""
    session_id = request.sid
    
    if session_id not in terminals:
        return
    
    master_fd = terminals[session_id]['master_fd']
    os.write(master_fd, data['data'].encode())

@socketio.on('terminal_resize')
def handle_terminal_resize(data):
    """Handle terminal resize"""
    session_id = request.sid
    
    if session_id not in terminals:
        return
    
    master_fd = terminals[session_id]['master_fd']
    
    # Set terminal window size
    winsize = struct.pack('HHHH', data['rows'], data['cols'], 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

@socketio.on('disconnect')
def handle_disconnect():
    """Clean up terminal session on disconnect"""
    session_id = request.sid
    
    if session_id in terminals:
        term = terminals[session_id]
        term['process'].terminate()
        os.close(term['master_fd'])
        os.close(term['slave_fd'])
        del terminals[session_id]

def read_terminal_output(session_id):
    """Background task to read terminal output"""
    if session_id not in terminals:
        return
    
    master_fd = terminals[session_id]['master_fd']
    
    while session_id in terminals:
        try:
            # Check if data is available
            ready, _, _ = select.select([master_fd], [], [], 0.1)
            
            if ready:
                output = os.read(master_fd, 1024).decode('utf-8', errors='replace')
                socketio.emit('terminal_output', {'data': output}, room=session_id)
        except:
            break

if __name__ == '__main__':
    # Load configuration
    load_config()
    
    # Create templates directory if it doesn't exist
    os.makedirs('templates', exist_ok=True)
    os.makedirs('static', exist_ok=True)
    
    print(f"Starting Automata Remote Access Portal on port {CONFIG['portal_port']}")
    print(f"Controller Serial: {CONFIG['controller_serial']}")
    
    # Run the server
    socketio.run(app, host='0.0.0.0', port=CONFIG['portal_port'], debug=False)