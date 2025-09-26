#!/usr/bin/env node

/**
 * Test script for alarm email notifications
 */

require('dotenv').config();
const AlarmMonitor = require('./src/services/alarmMonitor');
const db = require('./src/services/databaseManager');

async function testAlarmEmail() {
  console.log('Starting alarm email test...');

  // Initialize alarm monitor
  const alarmMonitor = new AlarmMonitor(db);

  // Wait for initialization
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Enable email notifications
  console.log('Enabling email notifications...');
  await alarmMonitor.updateSettings({
    monitoring_enabled: true,
    email_notifications: true
  });

  // Create a test alarm
  console.log('Creating test alarm...');
  const testAlarmData = {
    type: 'pump_3_current_0_10v_0_50a',
    description: 'Test Alarm: Pump 3 Current exceeds maximum 45.0A',
    value: 47.5,
    threshold: 45.0,
    severity: 'critical'
  };

  try {
    await alarmMonitor.createAlarm(testAlarmData);
    console.log('✅ Test alarm created and email sent successfully!');
    console.log('Check your email at:', process.env.DEFAULT_RECIPIENT);

    // Also check for additional recipients
    const recipients = await alarmMonitor.getRecipients();
    if (recipients.length > 0) {
      console.log('Additional recipients:', recipients.map(r => r.email).join(', '));
    }
  } catch (error) {
    console.error('❌ Error sending test alarm email:', error);
  }

  // Close database
  db.close();
  process.exit(0);
}

// Run the test
testAlarmEmail().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});