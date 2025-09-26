/**
 * Alarm Monitoring Service
 * Monitors thresholds and generates alarms when crossed
 */

const DatabaseManager = require('./databaseManager');
const winston = require('winston');

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class AlarmMonitor {
  constructor(db) {
    this.dbManager = db || new DatabaseManager();
    this.db = this.dbManager.alarmsDb;
    this.settings = {
      monitoring_enabled: true,
      email_notifications: false,
      high_temp_threshold: 85,
      low_temp_threshold: 65,
      high_amp_threshold: 30,
      low_amp_threshold: 5
    };
    this.lastReadings = {};
    this.activeAlarms = new Map();
    this.emailTransporter = null;
    this.initializeEmailTransporter();
    this.loadSettings();
  }

  async initializeEmailTransporter() {
    const resendApiKey = process.env.RESEND_API || '<addapikey>';
    if (resendApiKey && resendApiKey !== '<addapikey>') {
      // Using Resend API
      this.emailTransporter = {
        sendMail: async (options) => {
          try {
            const response = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: options.from || process.env.EMAIL_FROM,
                to: options.to,
                subject: options.subject,
                html: options.html
              })
            });
            
            if (!response.ok) {
              throw new Error(`Resend API error: ${response.statusText}`);
            }
            
            logger.info('Email sent successfully via Resend');
          } catch (error) {
            logger.error('Failed to send email via Resend:', error);
            throw error;
          }
        }
      };
    }
  }

  async loadSettings() {
    try {
      if (!this.db) {
        logger.error('Database not initialized');
        return;
      }
      
      const stmt = this.db.prepare('SELECT * FROM alarm_settings LIMIT 1');
      const settings = stmt.all();
      
      if (settings && settings.length > 0) {
        this.settings = settings[0];
      } else {
        // Initialize settings in database
        const insertStmt = this.db.prepare(`
          INSERT INTO alarm_settings (
            monitoring_enabled, email_notifications,
            high_temp_threshold, low_temp_threshold,
            high_amp_threshold, low_amp_threshold
          ) VALUES (?, ?, ?, ?, ?, ?)
        `);
        insertStmt.run(
          this.settings.monitoring_enabled ? 1 : 0,
          this.settings.email_notifications ? 1 : 0,
          this.settings.high_temp_threshold,
          this.settings.low_temp_threshold,
          this.settings.high_amp_threshold,
          this.settings.low_amp_threshold
        );
      }
    } catch (error) {
      logger.error('Failed to load alarm settings:', error);
    }
  }

  async updateSettings(newSettings) {
    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      
      this.settings = { ...this.settings, ...newSettings };
      
      // Check if settings exist
      const selectStmt = this.db.prepare('SELECT id FROM alarm_settings LIMIT 1');
      const existing = selectStmt.all();
      
      if (existing && existing.length > 0) {
        // Update existing settings
        const updateStmt = this.db.prepare(`
          UPDATE alarm_settings SET
            monitoring_enabled = ?,
            email_notifications = ?,
            high_temp_threshold = ?,
            low_temp_threshold = ?,
            high_amp_threshold = ?,
            low_amp_threshold = ?
          WHERE id = ?
        `);
        updateStmt.run(
          this.settings.monitoring_enabled ? 1 : 0,
          this.settings.email_notifications ? 1 : 0,
          this.settings.high_temp_threshold,
          this.settings.low_temp_threshold,
          this.settings.high_amp_threshold,
          this.settings.low_amp_threshold,
          existing[0].id
        );
      } else {
        // Insert new settings
        const insertStmt = this.db.prepare(`
          INSERT INTO alarm_settings (
            monitoring_enabled, email_notifications,
            high_temp_threshold, low_temp_threshold,
            high_amp_threshold, low_amp_threshold
          ) VALUES (?, ?, ?, ?, ?, ?)
        `);
        insertStmt.run(
          this.settings.monitoring_enabled ? 1 : 0,
          this.settings.email_notifications ? 1 : 0,
          this.settings.high_temp_threshold,
          this.settings.low_temp_threshold,
          this.settings.high_amp_threshold,
          this.settings.low_amp_threshold
        );
      }
      
      logger.info('Alarm settings updated:', this.settings);
    } catch (error) {
      logger.error('Failed to update alarm settings:', error);
      throw error;
    }
  }

  async checkThresholds(readings) {
    if (!this.settings.monitoring_enabled) {
      return;
    }

    try {
      // Get user-configured thresholds from alarm_thresholds table
      const stmt = this.dbManager.metricsDb.prepare('SELECT * FROM alarm_thresholds WHERE enabled = 1');
      const thresholds = stmt.all();

      // Also get vibration readings if available
      const vibStmt = this.dbManager.metricsDb.prepare('SELECT * FROM vibration_readings WHERE sensor_id IN (SELECT sensor_id FROM vibration_sensors WHERE enabled = 1) ORDER BY timestamp DESC LIMIT 10');
      const vibReadings = vibStmt.all();

      // Add vibration readings to inputs
      const vibBySenosr = {};
      vibReadings.forEach(reading => {
        if (!vibBySenosr[reading.sensor_id]) {
          vibBySenosr[reading.sensor_id] = reading;
        }
      });

      // Process each configured threshold
      for (const threshold of thresholds) {
        let value = null;

        // Get the value for this parameter
        if (threshold.parameter.startsWith('vib_')) {
          // Vibration sensor reading
          const sensorId = threshold.parameter.replace('vib_', '').replace('_velocity', '').replace('_temp', '');
          const vibReading = vibBySenosr[sensorId];
          if (vibReading) {
            if (threshold.parameter.includes('velocity')) {
              value = vibReading.velocity_mms;
            } else if (threshold.parameter.includes('temp')) {
              value = vibReading.temperature_f;
            }
          }
        } else {
          // Regular input reading
          value = readings.inputs?.[threshold.parameter];
        }

        if (value !== null && value !== undefined) {
          const alarmKey = `${threshold.id}_${threshold.parameter}`;
          let shouldAlarm = false;
          let alarmDescription = '';

          // Check min threshold
          if (threshold.minValue !== -999 && value < threshold.minValue) {
            shouldAlarm = true;
            alarmDescription = `${threshold.name}: Value ${value.toFixed(1)}${threshold.unit} below minimum ${threshold.minValue}${threshold.unit}`;
          }

          // Check max threshold
          if (threshold.maxValue !== 999 && value > threshold.maxValue) {
            shouldAlarm = true;
            alarmDescription = `${threshold.name}: Value ${value.toFixed(1)}${threshold.unit} exceeds maximum ${threshold.maxValue}${threshold.unit}`;
          }

          if (shouldAlarm) {
            // Threshold crossed - create alarm if not already active
            if (!this.activeAlarms.has(alarmKey)) {
              await this.createAlarm({
                type: threshold.parameter,
                description: alarmDescription,
                value: value,
                threshold: threshold.minValue !== -999 ? threshold.minValue : threshold.maxValue,
                severity: threshold.alarmType === 'critical' ? 'critical' : 'medium'
              });
              this.activeAlarms.set(alarmKey, true);
            }
          } else {
            // Threshold no longer crossed - clear active alarm
            if (this.activeAlarms.has(alarmKey)) {
              this.activeAlarms.delete(alarmKey);
              logger.info(`Alarm cleared: ${threshold.name}`);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error checking thresholds:', error);
    }

    this.lastReadings = readings;
  }

  async createAlarm(alarmData) {
    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      
      // Insert alarm into database
      const stmt = this.db.prepare(`
        INSERT INTO alarms (
          timestamp, type, description, value, threshold, severity, acknowledged
        ) VALUES (datetime('now'), ?, ?, ?, ?, ?, 0)
      `);
      const result = stmt.run(
        alarmData.type,
        alarmData.description,
        alarmData.value,
        alarmData.threshold,
        alarmData.severity
      );

      logger.warn(`ALARM GENERATED: ${alarmData.description} (Value: ${alarmData.value}, Threshold: ${alarmData.threshold})`);

      // Send email notification if enabled
      if (this.settings.email_notifications && this.emailTransporter) {
        await this.sendAlarmEmail(alarmData);
      }

      return result;
    } catch (error) {
      logger.error('Failed to create alarm:', error);
      throw error;
    }
  }

  async sendAlarmEmail(alarmData) {
    try {
      if (!this.db) {
        logger.error('Database not initialized for email');
        return;
      }

      // Get default recipient from .env
      const defaultRecipient = process.env.DEFAULT_RECIPIENT;
      if (!defaultRecipient) {
        logger.error('No DEFAULT_RECIPIENT configured in .env file');
        return;
      }

      // Start with default recipient
      const recipientEmails = [defaultRecipient];

      // Get additional active recipients from database
      const stmt = this.db.prepare('SELECT email FROM alarm_recipients WHERE active = 1');
      const additionalRecipients = stmt.all();

      // Add additional recipients to the list
      if (additionalRecipients && additionalRecipients.length > 0) {
        additionalRecipients.forEach(r => {
          if (r.email && !recipientEmails.includes(r.email)) {
            recipientEmails.push(r.email);
          }
        });
        logger.info(`Sending alarm to default recipient and ${additionalRecipients.length} additional recipients`);
      } else {
        logger.info('Sending alarm to default recipient only');
      }

      // Convert timestamp to EST
      const now = new Date();
      const estTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
      const formattedTime = estTime.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      });

      // Parse equipment name from parameter/type
      let equipmentName = alarmData.type.replace(/_/g, ' ');
      if (alarmData.type.includes('pump')) {
        equipmentName = equipmentName.toUpperCase();
      } else if (alarmData.type.includes('vib_')) {
        equipmentName = `Vibration Sensor ${alarmData.type.replace('vib_', '')}`;
      } else {
        equipmentName = equipmentName.split(' ').map(word =>
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
      }

      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
          <div style="background-color: #fafafa; padding: 40px 20px;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);">

              <!-- Header with Logo -->
              <div style="background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); padding: 30px; text-align: center;">
                <img src="${process.env.TUNNEL_DOMAIN ? 'https://' + process.env.TUNNEL_DOMAIN : 'http://localhost:8000'}/automata-nexus-logo.png" alt="AutomataNexus" style="height: 50px; margin-bottom: 10px;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">Alarm Notification</h1>
                <p style="color: #e0f2fe; margin: 5px 0 0 0; font-size: 14px;">NexusController System Alert - Location ${process.env.LOCATION || 'Unknown'}</p>
              </div>

              <!-- Severity Banner -->
              <div style="background-color: ${alarmData.severity === 'critical' ? '#fef2f2' : '#fffbeb'}; border-left: 4px solid ${alarmData.severity === 'critical' ? '#ef4444' : '#f59e0b'}; padding: 15px 20px; margin: 20px 20px 0 20px; border-radius: 4px;">
                <p style="margin: 0; color: ${alarmData.severity === 'critical' ? '#991b1b' : '#92400e'}; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">
                  ⚠️ ${alarmData.severity} SEVERITY ALARM
                </p>
              </div>

              <!-- Main Content -->
              <div style="padding: 30px;">
                <h2 style="color: #111827; margin: 0 0 20px 0; font-size: 20px; font-weight: 600;">Alarm Details</h2>

                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px; width: 35%;">
                      <strong>Equipment:</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 14px;">
                      ${equipmentName}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">
                      <strong>Description:</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 14px;">
                      ${alarmData.description}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">
                      <strong>Current Value:</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 14px;">
                      <span style="color: #ef4444; font-weight: 600;">${alarmData.value.toFixed(1)}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">
                      <strong>Threshold Value:</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 14px;">
                      ${alarmData.threshold.toFixed(1)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; color: #6b7280; font-size: 14px;">
                      <strong>Timestamp (EST):</strong>
                    </td>
                    <td style="padding: 12px 0; color: #111827; font-size: 14px;">
                      ${formattedTime}
                    </td>
                  </tr>
                </table>

                <!-- Action Button -->
                <div style="text-align: center; margin-top: 30px;">
                  <a href="${process.env.TUNNEL_DOMAIN ? 'https://' + process.env.TUNNEL_DOMAIN : 'http://localhost:8000'}/dashboard"
                     style="display: inline-block; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 6px rgba(20, 184, 166, 0.25);">
                    View Dashboard
                  </a>
                  <p style="color: #9ca3af; font-size: 12px; margin-top: 15px;">
                    Click the button above to acknowledge this alarm and view system status
                  </p>
                </div>
              </div>

              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  AutomataNexus Control Systems
                </p>
                <p style="color: #9ca3af; font-size: 11px; margin: 5px 0 0 0;">
                  Controller Serial: ${process.env.CONTROLLER_SERIAL || 'NEXUS-CONTROLLER'}
                </p>
                <p style="color: #9ca3af; font-size: 11px; margin: 5px 0 0 0;">
                  This is an automated notification. Do not reply to this email.
                </p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      await this.emailTransporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: recipientEmails,
        subject: `[ALARM] ${alarmData.severity.toUpperCase()} - ${alarmData.description}`,
        html: emailHtml
      });

      logger.info(`Alarm email sent to ${recipientEmails.length} recipients`);
    } catch (error) {
      logger.error('Failed to send alarm email:', error);
    }
  }

  async getActiveAlarms() {
    try {
      if (!this.db) {
        logger.error('Database not initialized');
        return [];
      }
      
      const stmt = this.db.prepare('SELECT * FROM alarms WHERE acknowledged = 0 ORDER BY timestamp DESC');
      return stmt.all();
    } catch (error) {
      logger.error('Failed to get active alarms:', error);
      return [];
    }
  }

  async getAllAlarms(limit = 100) {
    try {
      if (!this.db) {
        logger.error('Database not initialized');
        return [];
      }
      
      const stmt = this.db.prepare('SELECT * FROM alarms ORDER BY timestamp DESC LIMIT ?');
      return stmt.all(limit);
    } catch (error) {
      logger.error('Failed to get alarms:', error);
      return [];
    }
  }

  async acknowledgeAlarm(alarmId, username) {
    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      
      const stmt = this.db.prepare(`
        UPDATE alarms 
        SET acknowledged = 1, 
            acknowledged_by = ?, 
            acknowledged_at = datetime('now')
        WHERE id = ?
      `);
      stmt.run(username, alarmId);
      
      logger.info(`Alarm ${alarmId} acknowledged by ${username}`);
    } catch (error) {
      logger.error('Failed to acknowledge alarm:', error);
      throw error;
    }
  }

  async deleteAlarm(alarmId) {
    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      
      const stmt = this.db.prepare('DELETE FROM alarms WHERE id = ?');
      stmt.run(alarmId);
      logger.info(`Alarm ${alarmId} deleted`);
    } catch (error) {
      logger.error('Failed to delete alarm:', error);
      throw error;
    }
  }

  // Send alarm email to specific recipient
  async sendAlarmEmailTo(alarmData, recipientEmail) {
    try {
      if (!this.emailTransporter) {
        logger.error('Email transporter not configured');
        return;
      }

      // Convert timestamp to EST
      const now = new Date(alarmData.timestamp || new Date());
      const estTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
      const formattedTime = estTime.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      });

      // Parse equipment name from parameter/type
      let equipmentName = alarmData.type.replace(/_/g, ' ');
      if (alarmData.type.includes('pump')) {
        equipmentName = equipmentName.toUpperCase();
      } else if (alarmData.type.includes('vib_')) {
        equipmentName = `Vibration Sensor ${alarmData.type.replace('vib_', '')}`;
      } else {
        equipmentName = equipmentName.split(' ').map(word =>
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
      }

      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
          <div style="background-color: #fafafa; padding: 40px 20px;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);">

              <!-- Header with Logo -->
              <div style="background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); padding: 30px; text-align: center;">
                <img src="${process.env.TUNNEL_DOMAIN ? 'https://' + process.env.TUNNEL_DOMAIN : 'http://localhost:8000'}/automata-nexus-logo.png" alt="AutomataNexus" style="height: 50px; margin-bottom: 10px;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">Alarm Notification (Forwarded)</h1>
                <p style="color: #e0f2fe; margin: 5px 0 0 0; font-size: 14px;">NexusController System Alert - Location ${process.env.LOCATION || 'Unknown'}</p>
              </div>

              <!-- Severity Banner -->
              <div style="background-color: ${alarmData.severity === 'critical' ? '#fef2f2' : '#fffbeb'}; border-left: 4px solid ${alarmData.severity === 'critical' ? '#ef4444' : '#f59e0b'}; padding: 15px 20px; margin: 20px 20px 0 20px; border-radius: 4px;">
                <p style="margin: 0; color: ${alarmData.severity === 'critical' ? '#991b1b' : '#92400e'}; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">
                  ⚠️ ${alarmData.severity} SEVERITY ALARM
                </p>
              </div>

              <!-- Main Content -->
              <div style="padding: 30px;">
                <h2 style="color: #111827; margin: 0 0 20px 0; font-size: 20px; font-weight: 600;">Alarm Details</h2>

                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px; width: 35%;">
                      <strong>Equipment:</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 14px;">
                      ${equipmentName}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">
                      <strong>Description:</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 14px;">
                      ${alarmData.description}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">
                      <strong>Current Value:</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 14px;">
                      <span style="color: #ef4444; font-weight: 600;">${alarmData.value.toFixed(1)}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">
                      <strong>Threshold Value:</strong>
                    </td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 14px;">
                      ${alarmData.threshold.toFixed(1)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; color: #6b7280; font-size: 14px;">
                      <strong>Timestamp (EST):</strong>
                    </td>
                    <td style="padding: 12px 0; color: #111827; font-size: 14px;">
                      ${formattedTime}
                    </td>
                  </tr>
                </table>

                <!-- Action Button -->
                <div style="text-align: center; margin-top: 30px;">
                  <a href="${process.env.TUNNEL_DOMAIN ? 'https://' + process.env.TUNNEL_DOMAIN : 'http://localhost:8000'}/dashboard"
                     style="display: inline-block; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 6px rgba(20, 184, 166, 0.25);">
                    View Dashboard
                  </a>
                  <p style="color: #9ca3af; font-size: 12px; margin-top: 15px;">
                    Click the button above to view system status
                  </p>
                </div>
              </div>

              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  AutomataNexus Control Systems
                </p>
                <p style="color: #9ca3af; font-size: 11px; margin: 5px 0 0 0;">
                  Controller Serial: ${process.env.CONTROLLER_SERIAL || 'NEXUS-CONTROLLER'}
                </p>
                <p style="color: #9ca3af; font-size: 11px; margin: 5px 0 0 0;">
                  This alarm was forwarded by an authorized user.
                </p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      await this.emailTransporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: recipientEmail,
        subject: `🚨 [FORWARDED] ${alarmData.severity.toUpperCase()} Alarm - ${equipmentName}`,
        html: emailHtml
      });

      logger.info(`Alarm email forwarded to ${recipientEmail}`);
    } catch (error) {
      logger.error('Failed to forward alarm email:', error);
      throw error;
    }
  }

  // Recipient management
  async getRecipients() {
    try {
      if (!this.db) {
        logger.error('Database not initialized');
        return [];
      }
      
      const stmt = this.db.prepare('SELECT * FROM alarm_recipients ORDER BY name');
      return stmt.all();
    } catch (error) {
      logger.error('Failed to get recipients:', error);
      return [];
    }
  }

  async addRecipient(recipientData) {
    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      
      const stmt = this.db.prepare(`
        INSERT INTO alarm_recipients (email, name, active)
        VALUES (?, ?, ?)
      `);
      return stmt.run(recipientData.email, recipientData.name, recipientData.active ? 1 : 0);
    } catch (error) {
      logger.error('Failed to add recipient:', error);
      throw error;
    }
  }

  async updateRecipient(recipientId, updates) {
    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      
      const stmt = this.db.prepare(`
        UPDATE alarm_recipients 
        SET active = ?
        WHERE id = ?
      `);
      stmt.run(updates.active ? 1 : 0, recipientId);
    } catch (error) {
      logger.error('Failed to update recipient:', error);
      throw error;
    }
  }

  async deleteRecipient(recipientId) {
    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      
      const stmt = this.db.prepare('DELETE FROM alarm_recipients WHERE id = ?');
      stmt.run(recipientId);
    } catch (error) {
      logger.error('Failed to delete recipient:', error);
      throw error;
    }
  }
}

module.exports = AlarmMonitor;