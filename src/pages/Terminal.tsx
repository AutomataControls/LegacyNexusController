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

import React, { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

const Terminal: React.FC = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm with Neural Nexus theme
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0e1a',
        foreground: '#06b6d4',
        cursor: '#06b6d4',
        cursorAccent: '#0a0e1a',
        selectionBackground: 'rgba(6, 182, 212, 0.3)',
        black: '#000000',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#f0f9ff',
        brightBlack: '#64748b',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#a78bfa',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff'
      },
      allowTransparency: true,
      windowsMode: false
    });

    // Load addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Open terminal
    term.open(terminalRef.current);
    fitAddon.fit();

    // Connect to WebSocket
    const socket = io({
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      upgrade: true
    });
    
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Terminal connected');
      socket.emit('terminal-init', { 
        cols: term.cols, 
        rows: term.rows 
      });
    });

    socket.on('terminal-output', (data: string) => {
      term.write(data);
    });

    socket.on('disconnect', () => {
      console.log('Terminal disconnected');
      term.write('\r\n\x1b[31mConnection lost. Reconnecting...\x1b[0m\r\n');
    });

    socket.on('reconnect', () => {
      term.clear();
      socket.emit('terminal-init', { 
        cols: term.cols, 
        rows: term.rows 
      });
    });

    // Handle terminal input
    term.onData((data: string) => {
      socket.emit('terminal-input', data);
    });

    // Handle terminal resize
    term.onResize((size: { cols: number; rows: number }) => {
      socket.emit('terminal-resize', { 
        cols: size.cols, 
        rows: size.rows 
      });
    });

    // Handle window resize
    const handleResize = () => {
      if (fitAddon) {
        fitAddon.fit();
      }
    };
    
    window.addEventListener('resize', handleResize);

    // Focus terminal on mount
    term.focus();

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (socket) {
        socket.disconnect();
      }
      if (term) {
        term.dispose();
      }
    };
  }, []);

  const handleClear = () => {
    if (termRef.current) {
      termRef.current.clear();
    }
  };

  const handleReset = () => {
    if (termRef.current) {
      termRef.current.reset();
    }
  };

  const handleFit = () => {
    if (fitAddonRef.current) {
      fitAddonRef.current.fit();
    }
  };

  const handleCopy = () => {
    if (termRef.current && termRef.current.hasSelection()) {
      const selection = termRef.current.getSelection();
      navigator.clipboard.writeText(selection);
    }
  };

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <div className="terminal-title">
          <i className="ri-terminal-box-line"></i>
          <span>Neural Terminal</span>
          <span className="terminal-subtitle">AutomataNexusBms Controller</span>
        </div>
        <div className="terminal-controls">
          <button className="terminal-btn" onClick={handleCopy} title="Copy Selection">
            <i className="ri-file-copy-line"></i>
          </button>
          <button className="terminal-btn" onClick={handleClear} title="Clear Terminal">
            <i className="ri-delete-bin-line"></i>
          </button>
          <button className="terminal-btn" onClick={handleReset} title="Reset Terminal">
            <i className="ri-refresh-line"></i>
          </button>
          <button className="terminal-btn" onClick={handleFit} title="Fit to Window">
            <i className="ri-fullscreen-line"></i>
          </button>
        </div>
      </div>
      <div className="terminal-body" ref={terminalRef}></div>
    </div>
  );
};

export default Terminal;