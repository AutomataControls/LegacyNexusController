import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Mail, MailX, Plus, Trash2, Save, X, AlertTriangle, Check, Forward } from 'lucide-react';
import AuthGuard from '../components/AuthGuard';
import { authenticatedFetch } from '../services/api';
import '../styles/alarms.css';

interface Alarm {
  id: number;
  timestamp: string;
  type: string;
  description: string;
  value: number;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  acknowledged: boolean;
  acknowledged_by?: string;
  acknowledged_at?: string;
}

interface EmailRecipient {
  id: number;
  email: string;
  name: string;
  active: boolean;
}

interface AlarmSettings {
  monitoring_enabled: boolean;
  email_notifications: boolean;
  high_temp_threshold: number;
  low_temp_threshold: number;
  high_amp_threshold: number;
  low_amp_threshold: number;
}

const Alarms: React.FC = () => {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [settings, setSettings] = useState<AlarmSettings>({
    monitoring_enabled: true,
    email_notifications: false,
    high_temp_threshold: 85,
    low_temp_threshold: 65,
    high_amp_threshold: 30,
    low_amp_threshold: 5
  });
  const [activeTab, setActiveTab] = useState<'alarms' | 'recipients'>('alarms');
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [newRecipient, setNewRecipient] = useState({ email: '', name: '' });
  const [showAddRecipient, setShowAddRecipient] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardEmail, setForwardEmail] = useState('');
  const [selectedAlarm, setSelectedAlarm] = useState<Alarm | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    checkUserRole();
    fetchAlarms();
    fetchSettings();
    fetchRecipients();
  }, []);

  const checkUserRole = () => {
    const token = sessionStorage.getItem('authToken');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(payload.role === 'admin');
      } catch (error) {
        console.error('Error parsing token:', error);
      }
    }
  };

  const fetchAlarms = async () => {
    try {
      const response = await authenticatedFetch('/api/alarms');
      if (response.ok) {
        const data = await response.json();
        setAlarms(data);
      }
    } catch (error) {
      console.error('Error fetching alarms:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await authenticatedFetch('/api/alarms/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  };

  const fetchRecipients = async () => {
    try {
      const response = await authenticatedFetch('/api/alarms/recipients');
      if (response.ok) {
        const data = await response.json();
        setRecipients(data);
      }
    } catch (error) {
      console.error('Error fetching recipients:', error);
    }
  };

  const toggleMonitoring = async () => {
    if (!isAdmin) return;
    
    const newValue = !settings.monitoring_enabled;
    // Update state immediately for smooth transition
    setSettings(prev => ({ ...prev, monitoring_enabled: newValue }));
    
    try {
      const response = await authenticatedFetch('/api/alarms/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, monitoring_enabled: newValue })
      });
      
      if (!response.ok) {
        // Revert on failure
        setSettings(prev => ({ ...prev, monitoring_enabled: !newValue }));
        console.error('Failed to update monitoring setting');
      }
    } catch (error) {
      console.error('Error updating monitoring setting:', error);
      // Revert on error
      setSettings(prev => ({ ...prev, monitoring_enabled: !newValue }));
    }
  };

  const toggleEmailNotifications = async () => {
    if (!isAdmin) return;
    
    const newValue = !settings.email_notifications;
    // Update state immediately for smooth transition
    setSettings(prev => ({ ...prev, email_notifications: newValue }));
    
    try {
      const response = await authenticatedFetch('/api/alarms/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, email_notifications: newValue })
      });
      
      if (!response.ok) {
        // Revert on failure
        setSettings(prev => ({ ...prev, email_notifications: !newValue }));
        console.error('Failed to update email setting');
      }
    } catch (error) {
      console.error('Error updating email setting:', error);
      // Revert on error
      setSettings(prev => ({ ...prev, email_notifications: !newValue }));
    }
  };

  const acknowledgeAlarm = async (alarmId: number) => {
    try {
      const response = await authenticatedFetch(`/api/alarms/${alarmId}/acknowledge`, {
        method: 'PUT'
      });

      if (response.ok) {
        fetchAlarms();
      }
    } catch (error) {
      console.error('Error acknowledging alarm:', error);
    }
  };

  const deleteAlarm = async (alarmId: number) => {
    if (window.confirm('Are you sure you want to delete this alarm?')) {
      try {
        const response = await authenticatedFetch(`/api/alarms/${alarmId}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          fetchAlarms();
        }
      } catch (error) {
        console.error('Error deleting alarm:', error);
      }
    }
  };

  const forwardAlarmEmail = async () => {
    if (!selectedAlarm || !forwardEmail) return;

    setSendingEmail(true);
    try {
      const response = await authenticatedFetch('/api/alarms/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alarmId: selectedAlarm.id,
          email: forwardEmail,
          alarm: selectedAlarm
        })
      });

      if (response.ok) {
        alert('Alarm email sent successfully!');
        setShowForwardModal(false);
        setForwardEmail('');
        setSelectedAlarm(null);
      } else {
        alert('Failed to send alarm email');
      }
    } catch (error) {
      console.error('Error forwarding alarm:', error);
      alert('Error sending email');
    } finally {
      setSendingEmail(false);
    }
  };

  const addRecipient = async () => {
    if (!isAdmin || !newRecipient.email || !newRecipient.name) return;
    
    try {
      const response = await authenticatedFetch('/api/alarms/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newRecipient, active: true })
      });
      
      if (response.ok) {
        fetchRecipients();
        setNewRecipient({ email: '', name: '' });
        setShowAddRecipient(false);
      }
    } catch (error) {
      console.error('Error adding recipient:', error);
    }
  };

  const toggleRecipient = async (recipientId: number, active: boolean) => {
    if (!isAdmin) return;
    
    try {
      const response = await authenticatedFetch(`/api/alarms/recipients/${recipientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active })
      });
      
      if (response.ok) {
        fetchRecipients();
      }
    } catch (error) {
      console.error('Error updating recipient:', error);
    }
  };

  const deleteRecipient = async (recipientId: number) => {
    if (!isAdmin) return;
    
    if (window.confirm('Are you sure you want to remove this recipient?')) {
      try {
        const response = await authenticatedFetch(`/api/alarms/recipients/${recipientId}`, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          fetchRecipients();
        }
      } catch (error) {
        console.error('Error deleting recipient:', error);
      }
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return '#ef4444';
      case 'high': return '#f97316';
      case 'medium': return '#eab308';
      case 'low': return '#22c55e';
      default: return '#6b7280';
    }
  };

  return (
    <AuthGuard>
      <div className="alarms-container">
        <div className="alarms-header">
          <h1>Alarm Management</h1>
          <div className="alarm-toggles">
            <div className={`toggle-item ${!isAdmin ? 'disabled' : ''}`} onClick={toggleMonitoring}>
              <div className={`toggle-switch ${settings.monitoring_enabled ? 'active' : ''}`}>
                <div className="toggle-slider" />
              </div>
              {settings.monitoring_enabled ? <Bell size={20} /> : <BellOff size={20} />}
              <span>Monitoring {settings.monitoring_enabled ? 'ON' : 'OFF'}</span>
            </div>
            
            <div className={`toggle-item ${!isAdmin ? 'disabled' : ''}`} onClick={toggleEmailNotifications}>
              <div className={`toggle-switch ${settings.email_notifications ? 'active' : ''}`}>
                <div className="toggle-slider" />
              </div>
              {settings.email_notifications ? <Mail size={20} /> : <MailX size={20} />}
              <span>Email Alerts {settings.email_notifications ? 'ON' : 'OFF'}</span>
            </div>
          </div>
        </div>

        <div className="alarm-tabs">
          <button 
            className={`tab-button ${activeTab === 'alarms' ? 'active' : ''}`}
            onClick={() => setActiveTab('alarms')}
          >
            <AlertTriangle size={18} />
            Active Alarms
          </button>
          <button 
            className={`tab-button ${activeTab === 'recipients' ? 'active' : ''}`}
            onClick={() => setActiveTab('recipients')}
          >
            <Mail size={18} />
            Email Recipients
          </button>
        </div>

        <div className="alarm-content">
          {loading ? (
            <div className="loading">Loading alarms...</div>
          ) : (
            <>
              {activeTab === 'alarms' && (
                <div className="alarms-list">
                  {alarms.length === 0 ? (
                    <div className="no-alarms">
                      <Check size={48} color="#14b8a6" />
                      <h3>No Active Alarms</h3>
                      <p>All systems operating within normal parameters</p>
                    </div>
                  ) : (
                    <table className="alarms-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th>Value</th>
                          <th>Threshold</th>
                          <th>Severity</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alarms.map(alarm => (
                          <tr key={alarm.id} className={alarm.acknowledged ? 'acknowledged' : ''}>
                            <td>{new Date(alarm.timestamp).toLocaleString('en-US', { 
                              timeZone: 'America/New_York',
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit'
                            })}</td>
                            <td>{alarm.type}</td>
                            <td>{alarm.description}</td>
                            <td>{alarm.value.toFixed(1)}</td>
                            <td>{alarm.threshold.toFixed(1)}</td>
                            <td>
                              <span 
                                className="severity-badge" 
                                style={{ backgroundColor: getSeverityColor(alarm.severity) }}
                              >
                                {alarm.severity}
                              </span>
                            </td>
                            <td>
                              {alarm.acknowledged ? (
                                <span className="acknowledged-status">
                                  Acknowledged by {alarm.acknowledged_by}
                                </span>
                              ) : (
                                <span className="active-status">Active</span>
                              )}
                            </td>
                            <td>
                              {!alarm.acknowledged && (
                                <button
                                  className="action-btn acknowledge"
                                  onClick={() => acknowledgeAlarm(alarm.id)}
                                  title="Acknowledge"
                                >
                                  <Check size={16} />
                                </button>
                              )}
                              <button
                                className="action-btn forward"
                                onClick={() => {
                                  setSelectedAlarm(alarm);
                                  setShowForwardModal(true);
                                }}
                                title="Forward Email"
                              >
                                <Forward size={16} />
                              </button>
                              <button
                                className="action-btn delete"
                                onClick={() => deleteAlarm(alarm.id)}
                                title="Delete"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {activeTab === 'recipients' && (
                <div className="recipients-section">
                  {isAdmin && (
                    <div className="add-recipient-header">
                      {!showAddRecipient ? (
                        <button 
                          className="add-btn"
                          onClick={() => setShowAddRecipient(true)}
                        >
                          <Plus size={20} />
                          Add Recipient
                        </button>
                      ) : (
                        <div className="add-recipient-form">
                          <input
                            type="text"
                            placeholder="Name"
                            value={newRecipient.name}
                            onChange={(e) => setNewRecipient({ ...newRecipient, name: e.target.value })}
                          />
                          <input
                            type="email"
                            placeholder="Email Address"
                            value={newRecipient.email}
                            onChange={(e) => setNewRecipient({ ...newRecipient, email: e.target.value })}
                          />
                          <button className="save-btn" onClick={addRecipient}>
                            <Save size={16} />
                          </button>
                          <button className="cancel-btn" onClick={() => {
                            setShowAddRecipient(false);
                            setNewRecipient({ email: '', name: '' });
                          }}>
                            <X size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="recipients-list">
                    {recipients.length === 0 ? (
                      <div className="no-recipients">
                        <MailX size={48} color="#9ca3af" />
                        <h3>No Email Recipients</h3>
                        <p>Add recipients to receive alarm notifications</p>
                      </div>
                    ) : (
                      <table className="recipients-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Status</th>
                            {isAdmin && <th>Actions</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {recipients.map(recipient => (
                            <tr key={recipient.id}>
                              <td>{recipient.name}</td>
                              <td>{recipient.email}</td>
                              <td>
                                <span className={`status ${recipient.active ? 'active' : 'inactive'}`}>
                                  {recipient.active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              {isAdmin && (
                                <td>
                                  <button
                                    className={`action-btn ${recipient.active ? 'deactivate' : 'activate'}`}
                                    onClick={() => toggleRecipient(recipient.id, !recipient.active)}
                                  >
                                    {recipient.active ? <MailX size={16} /> : <Mail size={16} />}
                                  </button>
                                  <button
                                    className="action-btn delete"
                                    onClick={() => deleteRecipient(recipient.id)}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

            </>
          )}
        </div>

        {/* Forward Email Modal */}
        {showForwardModal && selectedAlarm && (
          <div className="modal-overlay" onClick={() => setShowForwardModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Forward Alarm Email</h2>
                <button onClick={() => setShowForwardModal(false)} className="close-btn">
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="alarm-details">
                  <p><strong>Alarm:</strong> {selectedAlarm.description}</p>
                  <p><strong>Severity:</strong> {selectedAlarm.severity}</p>
                  <p><strong>Value:</strong> {selectedAlarm.value.toFixed(1)}</p>
                  <p><strong>Threshold:</strong> {selectedAlarm.threshold.toFixed(1)}</p>
                </div>
                <div className="email-input">
                  <label>Send to Email Address:</label>
                  <input
                    type="email"
                    placeholder="Enter email address"
                    value={forwardEmail}
                    onChange={(e) => setForwardEmail(e.target.value)}
                    disabled={sendingEmail}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn-primary"
                  onClick={forwardAlarmEmail}
                  disabled={!forwardEmail || sendingEmail}
                >
                  {sendingEmail ? 'Sending...' : 'Send Email'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setShowForwardModal(false);
                    setForwardEmail('');
                  }}
                  disabled={sendingEmail}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
};

export default Alarms;