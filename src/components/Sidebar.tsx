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

import React, { useState, useEffect } from 'react';
import { 
  LayoutGrid, 
  Workflow, 
  Terminal, 
  BrainCircuit,
  Database,
  Thermometer,
  Bell,
  UserCheck,
  LogOut,
  Shield,
  Sliders,
  Activity,
  LucideIcon
} from 'lucide-react';
import { Button } from './ui/button';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  description?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange }) => {
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [clickCount, setClickCount] = useState(0);
  const [clickTimer, setClickTimer] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Check if user is authenticated
    const checkAuth = () => {
      const token = sessionStorage.getItem('authToken');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          setAuthUser(payload.username);
        } catch {
          setAuthUser(null);
        }
      } else {
        setAuthUser(null);
      }
    };

    checkAuth();
    // Check on focus (in case of login in another tab)
    window.addEventListener('focus', checkAuth);
    // Check periodically for session changes
    const interval = setInterval(checkAuth, 1000);
    
    return () => {
      window.removeEventListener('focus', checkAuth);
      clearInterval(interval);
    };
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem('authToken');
    setAuthUser(null);
    // Reload to clear any protected content
    window.location.reload();
  };

  const handleSecurityBadgeClick = () => {
    // Clear existing timer
    if (clickTimer) {
      clearTimeout(clickTimer);
    }

    // Increment click count
    const newCount = clickCount + 1;
    setClickCount(newCount);

    // Check if triple click achieved
    if (newCount === 3) {
      // Navigate to hidden admin page
      onViewChange('admin');
      setClickCount(0);
    } else {
      // Set timer to reset count after 500ms
      const timer = setTimeout(() => {
        setClickCount(0);
      }, 500);
      setClickTimer(timer);
    }
  };

  const navItems: NavItem[] = [
    { 
      id: 'dashboard', 
      label: 'Dashboard', 
      icon: LayoutGrid,
      description: 'System overview and metrics'
    },
    { 
      id: 'controls', 
      label: 'Controls', 
      icon: Sliders,
      description: 'Equipment I/O control'
    },
    { 
      id: 'nodered', 
      label: 'Node-RED', 
      icon: Workflow,
      description: 'Flow-based programming'
    },
    { 
      id: 'terminal', 
      label: 'Terminal', 
      icon: Terminal,
      description: 'Command line access'
    },
    { 
      id: 'neuralbms', 
      label: 'Neural BMS', 
      icon: BrainCircuit,
      description: 'Building management system'
    },
    { 
      id: 'database', 
      label: 'Database', 
      icon: Database,
      description: 'Database management and analytics'
    },
    { 
      id: 'thresholds', 
      label: 'Thresholds', 
      icon: Thermometer,
      description: 'Configure Node-RED alarm thresholds'
    },
    {
      id: 'alarms',
      label: 'Alarms',
      icon: Bell,
      description: 'Alarm management and notifications'
    },
    {
      id: 'vibration',
      label: 'Vibration',
      icon: Activity,
      description: 'Vibration sensor monitoring'
    }
  ];

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">Navigation</div>
      </div>
      
      <div className="nav-menu">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <Button
              key={item.id}
              variant={isActive ? "sidebarActive" : "sidebar"}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onViewChange(item.id)}
              title={item.description}
              style={{
                padding: '8px 12px',
                height: 'auto',
                borderRadius: '6px',
                marginBottom: '4px',
                marginLeft: '4px',
                marginRight: '4px',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                width: 'calc(100% - 8px)',
                borderLeft: isActive ? '3px solid #14b8a6' : 'none',
                background: isActive 
                  ? 'linear-gradient(to right, rgba(20, 184, 166, 0.1), rgba(6, 182, 212, 0.1))' 
                  : 'transparent'
              }}
            >
              <Icon size={18} style={{ marginRight: '10px' }} />
              <span style={{ fontWeight: 500 }}>{item.label}</span>
            </Button>
          );
        })}
        
        {authUser && (
          <div className="sidebar-auth">
            <div className="auth-user">
              <UserCheck size={18} />
              <span>Logged in as: {authUser}</span>
            </div>
            <Button 
              onClick={handleLogout}
              variant="sidebar"
              className="btn-sidebar-logout"
              style={{
                marginTop: '8px',
                padding: '8px 12px',
                height: 'auto',
                borderRadius: '6px',
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.2)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
              }}
            >
              <LogOut size={18} style={{ marginRight: '8px' }} />
              <span>Logout</span>
            </Button>
          </div>
        )}
        
        <div 
          className="sidebar-security"
          onClick={handleSecurityBadgeClick}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          <Shield size={18} />
          <span>Secured by Nexus</span>
        </div>
      </div>
      
      <div className="sidebar-footer">
        <div className="sidebar-version">
          v2.0.0
        </div>
        <div className="sidebar-copyright">
          © 2024 AutomataNexus
        </div>
      </div>
    </nav>
  );
};

export default Sidebar;