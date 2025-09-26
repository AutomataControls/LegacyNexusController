/*
 * AutomataControls™ Remote Portal
 * Authentication Guard Component
 */

import React, { useState, useEffect } from 'react';
import './AuthGuard.css';

interface AuthGuardProps {
  children: React.ReactNode;
  requiredAuth?: boolean;
}

interface AuthState {
  isAuthenticated: boolean;
  user: any | null;
  loading: boolean;
}

const AuthGuard: React.FC<AuthGuardProps> = ({ children, requiredAuth = false }) => {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    loading: true
  });
  const [showLogin, setShowLogin] = useState(false);
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    checkAuthentication();
  }, []);

  const checkAuthentication = async () => {
    try {
      const token = sessionStorage.getItem('authToken');
      if (token) {
        const response = await fetch('/api/auth/verify', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const user = await response.json();
          setAuthState({
            isAuthenticated: true,
            user,
            loading: false
          });
          return;
        }
      }
      
      setAuthState({
        isAuthenticated: false,
        user: null,
        loading: false
      });
      
      if (requiredAuth) {
        setShowLogin(true);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setAuthState({
        isAuthenticated: false,
        user: null,
        loading: false
      });
      
      if (requiredAuth) {
        setShowLogin(true);
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(credentials)
      });
      
      if (response.ok) {
        const data = await response.json();
        sessionStorage.setItem('authToken', data.token);
        setAuthState({
          isAuthenticated: true,
          user: data.user,
          loading: false
        });
        setShowLogin(false);
        setCredentials({ username: '', password: '' });
      } else {
        let errorMessage = 'Invalid credentials';
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
        } catch (e) {
          // Response wasn't JSON, likely an HTML error page
          errorMessage = `Server error (${response.status})`;
        }
        setLoginError(errorMessage);
      }
    } catch (error) {
      console.error('Login failed:', error);
      setLoginError('Login failed. Please try again.');
    }
  };

  // Loading state
  if (authState.loading) {
    return (
      <div className="auth-loading">
        <i className="fas fa-spinner fa-spin"></i>
        <p>Authenticating...</p>
      </div>
    );
  }

  // Show login form if required and not authenticated
  if (requiredAuth && !authState.isAuthenticated && showLogin) {
    return (
      <div className="auth-overlay">
        <div className="auth-modal">
          <div className="auth-header">
            <h2>
              <i className="fas fa-lock"></i>
              Authentication Required
            </h2>
            <p>This area requires authentication to access</p>
          </div>
          
          <form onSubmit={handleLogin} className="auth-form">
            <div className="form-group">
              <label htmlFor="username">
                <i className="fas fa-user"></i>
                Username
              </label>
              <input
                type="text"
                id="username"
                value={credentials.username}
                onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                placeholder="Enter username"
                required
                autoFocus
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="password">
                <i className="fas fa-key"></i>
                Password
              </label>
              <input
                type="password"
                id="password"
                value={credentials.password}
                onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                placeholder="Enter password"
                required
              />
            </div>
            
            {loginError && (
              <div className="auth-error">
                <i className="fas fa-exclamation-triangle"></i>
                {loginError}
              </div>
            )}
            
            <div className="auth-actions">
              <button type="submit" className="btn-login">
                <i className="fas fa-sign-in-alt"></i>
                Login
              </button>
              <button 
                type="button" 
                className="btn-cancel"
                onClick={() => setShowLogin(false)}
              >
                Cancel
              </button>
            </div>
          </form>
          
          <div className="auth-footer">
            <p className="auth-hint">Contact your system administrator for credentials</p>
          </div>
        </div>
      </div>
    );
  }

  // Don't render protected content if authentication is required but user is not authenticated
  if (requiredAuth && !authState.isAuthenticated) {
    return (
      <div className="auth-denied">
        <i className="fas fa-shield-alt"></i>
        <h2>Access Denied</h2>
        <p>You must be authenticated to access this page.</p>
        <button onClick={() => setShowLogin(true)} className="btn-login">
          <i className="fas fa-sign-in-alt"></i>
          Login
        </button>
      </div>
    );
  }

  // Render children with auth context
  return <>{children}</>;
};

export default AuthGuard;