#!/usr/bin/env node

/**
 * Script to add additional admin users to the AutomataNexus Remote Portal
 */

const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

// Database path
const dbPath = path.join(__dirname, 'data', 'users.db');
const db = new Database(dbPath);

// Admin users to create
const adminUsers = [
  { username: 'Leon', email: 'leon@automatacontrols.com', password: 'Invertedskynet2$' },
  { username: 'John', email: 'john@automatacontrols.com', password: 'Invertedskynet2$' },
  { username: 'Nick', email: 'nick@automatacontrols.com', password: 'Invertedskynet2$' },
  { username: 'Deniro', email: 'deniro@automatacontrols.com', password: 'Invertedskynet2$' }
];

async function createAdminUser(username, email, password) {
  try {
    // Check if user already exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      console.log(`✓ User '${username}' already exists`);
      return;
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Insert the new admin user
    const stmt = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, is_active)
      VALUES (?, ?, ?, 'admin', 1)
    `);
    
    stmt.run(username, email, passwordHash);
    console.log(`✅ Created admin user: ${username}`);
  } catch (error) {
    console.error(`❌ Failed to create user '${username}':`, error.message);
  }
}

async function main() {
  console.log('=== Adding Admin Users to AutomataNexus Portal ===\n');
  
  // Create each admin user
  for (const user of adminUsers) {
    await createAdminUser(user.username, user.email, user.password);
  }
  
  // Show all users
  console.log('\n=== Current Users ===');
  const users = db.prepare('SELECT username, email, role FROM users').all();
  users.forEach(user => {
    console.log(`- ${user.username} (${user.email}) - Role: ${user.role}`);
  });
  
  db.close();
  console.log('\n✅ Admin users setup complete!');
}

main().catch(console.error);