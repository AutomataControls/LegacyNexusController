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

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const NodeRED: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // Listen for audit messages from iframe
    const handleMessage = async (event: MessageEvent) => {
      // Verify origin if needed
      if (event.data && event.data.type) {
        const token = sessionStorage.getItem('token');
        if (!token) return;

        try {
          if (event.data.type === 'NODE_RED_DEPLOY') {
            // Log Node-RED deploy action
            await axios.post('/api/audit/nodered-deploy', {
              deployType: event.data.data.deployType,
              flowCount: event.data.data.flowCount,
              nodeCount: event.data.data.nodeCount,
              timestamp: event.data.data.timestamp
            }, {
              headers: { Authorization: `Bearer ${token}` }
            });
            
            console.log('Node-RED deploy audit logged:', event.data.data);
          } else if (event.data.type === 'NODE_RED_SAVE') {
            // Log save action
            await axios.post('/api/audit/ui-change', {
              actionType: 'NODE_RED_SAVE',
              description: 'Node-RED flows saved',
              component: 'Node-RED',
              details: event.data.data
            }, {
              headers: { Authorization: `Bearer ${token}` }
            });
          } else if (event.data.type === 'NODE_RED_MENU_ACTION') {
            // Log menu actions
            await axios.post('/api/audit/ui-change', {
              actionType: 'NODE_RED_MENU',
              description: `Node-RED menu action: ${event.data.data.action}`,
              component: 'Node-RED',
              details: event.data.data
            }, {
              headers: { Authorization: `Bearer ${token}` }
            });
          }
        } catch (error) {
          console.error('Failed to log Node-RED audit:', error);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const handleIframeLoad = () => {
    setLoading(false);
    
    // Inject audit script into iframe
    try {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        const script = iframeRef.current.contentDocument?.createElement('script');
        if (script) {
          script.src = '/node-red-audit.js';
          iframeRef.current.contentDocument?.head.appendChild(script);
        }
      }
    } catch (error) {
      // Cross-origin restriction, try alternative method
      console.log('Could not inject audit script directly, Node-RED audit may be limited');
    }
  };

  return (
    <div className="iframe-container">
      {loading && (
        <div className="iframe-loading">
          <div className="spinner-container">
            <div className="spinner"></div>
            <p className="loading-text">Loading Node-RED...</p>
            <p className="loading-subtext">Flow-based programming interface</p>
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src="/node-red/"
        className="full-iframe"
        onLoad={handleIframeLoad}
        style={{ display: loading ? 'none' : 'block' }}
        title="Node-RED"
      />
    </div>
  );
};

export default NodeRED;