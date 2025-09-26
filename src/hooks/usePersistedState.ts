import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

// Custom hook for persisted state with audit tracking
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  page: string = 'unknown'
): [T, (value: T) => void, boolean] {
  const [state, setState] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);
  const previousValueRef = useRef<T>(defaultValue);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load persisted state on mount
  useEffect(() => {
    const loadState = async () => {
      try {
        const token = sessionStorage.getItem('token');
        if (!token) {
          setLoading(false);
          return;
        }

        const response = await axios.get(`/api/ui-state/load/${page}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (response.data.success && response.data.state[key] !== undefined) {
          setState(response.data.state[key]);
          previousValueRef.current = response.data.state[key];
        }
      } catch (error) {
        console.error('Failed to load persisted state:', error);
      } finally {
        setLoading(false);
      }
    };

    loadState();
  }, [key, page]);

  // Save state changes with debouncing
  const saveState = async (newValue: T) => {
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save to avoid too many API calls
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const token = sessionStorage.getItem('token');
        if (!token) return;

        await axios.post('/api/ui-state/save', {
          page,
          stateKey: key,
          stateValue: newValue
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });

        // Log UI change audit if value changed significantly
        if (JSON.stringify(previousValueRef.current) !== JSON.stringify(newValue)) {
          await axios.post('/api/audit/ui-change', {
            actionType: 'UI_STATE_CHANGE',
            component: page,
            description: `Changed ${key} in ${page}`,
            oldValue: JSON.stringify(previousValueRef.current),
            newValue: JSON.stringify(newValue)
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          
          previousValueRef.current = newValue;
        }
      } catch (error) {
        console.error('Failed to save state:', error);
      }
    }, 500); // 500ms debounce
  };

  // Custom setState that also persists
  const setPersistedState = (newValue: T) => {
    setState(newValue);
    saveState(newValue);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return [state, setPersistedState, loading];
}

// Hook for logging audit events
export function useAuditLog() {
  const logAudit = async (actionType: string, description: string, details: any = {}) => {
    try {
      const token = sessionStorage.getItem('token');
      if (!token) return;

      await axios.post('/api/audit/ui-change', {
        actionType,
        description,
        component: window.location.pathname,
        pageUrl: window.location.href,
        ...details
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      console.error('Failed to log audit:', error);
    }
  };

  const logNodeRedDeploy = async (details: any = {}) => {
    try {
      const token = sessionStorage.getItem('token');
      if (!token) return;

      await axios.post('/api/audit/nodered-deploy', details, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      console.error('Failed to log Node-RED deploy:', error);
    }
  };

  return { logAudit, logNodeRedDeploy };
}

// Hook for session management
export function useSessionTimeout(): void {
  const checkInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Check session every minute
    checkInterval.current = setInterval(() => {
      const token = sessionStorage.getItem('token');
      if (token) {
        // Decode token to check expiry
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const expiryTime = payload.exp * 1000;
          const now = Date.now();
          
          // If token expires in less than 1 minute, warn user
          if (expiryTime - now < 60000) {
            const remainingSeconds = Math.floor((expiryTime - now) / 1000);
            if (remainingSeconds > 0) {
              console.warn(`Session expires in ${remainingSeconds} seconds`);
              // Could show a modal or notification here
            } else {
              // Token expired, clear and redirect
              sessionStorage.clear();
              window.location.href = '/login';
            }
          }
        } catch (error) {
          console.error('Failed to decode token:', error);
        }
      }
    }, 30000); // Check every 30 seconds

    return () => {
      if (checkInterval.current) {
        clearInterval(checkInterval.current);
      }
    };
  }, []);
}