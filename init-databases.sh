#!/bin/bash

# AutomataNexus Remote Portal - Database Initialization Script
# This script creates and initializes all required SQLite databases

echo "=== AutomataNexus Database Initialization ==="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Create data directory if it doesn't exist
if [ ! -d "data" ]; then
    echo -e "${YELLOW}[*]${NC} Creating data directory..."
    mkdir -p data/archives
    echo -e "${GREEN}[✓]${NC} Data directory created"
else
    echo -e "${GREEN}[✓]${NC} Data directory exists"
fi

# Function to create database with error handling
create_database() {
    local db_file=$1
    local db_name=$2
    local sql_commands=$3

    echo -e "${YELLOW}[*]${NC} Initializing $db_name..."

    if [ -f "$db_file" ]; then
        echo -e "${GREEN}[✓]${NC} $db_name already exists"
    else
        # Create the database and execute SQL commands
        sqlite3 "$db_file" "$sql_commands" 2>/dev/null
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}[✓]${NC} $db_name created successfully"
        else
            echo -e "${RED}[✗]${NC} Failed to create $db_name"
            return 1
        fi
    fi

    # Set proper permissions
    chmod 644 "$db_file"
    return 0
}

# 1. Create metrics.db
METRICS_SQL="
CREATE TABLE IF NOT EXISTS system_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    cpu_temp REAL,
    cpu_usage REAL,
    mem_percent INTEGER,
    disk_usage INTEGER,
    uptime INTEGER,
    load_average TEXT
);

CREATE TABLE IF NOT EXISTS nodered_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    setpoint REAL,
    space_temp REAL,
    supply_temp REAL,
    return_temp REAL,
    triac_1 INTEGER DEFAULT 0,
    triac_2 INTEGER DEFAULT 0,
    triac_3 INTEGER DEFAULT 0,
    valve_position REAL,
    alarm_status TEXT,
    extra_data TEXT
);

CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON system_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_nodered_timestamp ON nodered_readings(timestamp);
"
create_database "data/metrics.db" "metrics database" "$METRICS_SQL"

# 2. Create users.db
USERS_SQL="
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'operator',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
"
create_database "data/users.db" "users database" "$USERS_SQL"

# 3. Create audit.db
AUDIT_SQL="
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    resource TEXT,
    details TEXT,
    ip_address TEXT,
    status TEXT DEFAULT 'success'
);

CREATE TABLE IF NOT EXISTS system_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    event_type TEXT NOT NULL,
    severity TEXT DEFAULT 'info',
    source TEXT,
    message TEXT,
    details TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON system_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type ON system_events(event_type);
"
create_database "data/audit.db" "audit database" "$AUDIT_SQL"

# 4. Create alarms.db
ALARMS_SQL="
CREATE TABLE IF NOT EXISTS alarm_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    threshold_low REAL,
    threshold_high REAL,
    delay_seconds INTEGER DEFAULT 0,
    email_enabled BOOLEAN DEFAULT 0,
    sms_enabled BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alarm_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alarm_id INTEGER NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    value REAL,
    status TEXT NOT NULL,
    acknowledged BOOLEAN DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_at DATETIME,
    notes TEXT,
    FOREIGN KEY (alarm_id) REFERENCES alarm_configs(id)
);

CREATE TABLE IF NOT EXISTS alarm_recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alarm_history_timestamp ON alarm_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_alarm_history_alarm ON alarm_history(alarm_id);
"
create_database "data/alarms.db" "alarms database" "$ALARMS_SQL"

# 5. Create weather.db
WEATHER_SQL="
CREATE TABLE IF NOT EXISTS weather_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    temperature REAL,
    humidity REAL,
    pressure REAL,
    wind_speed REAL,
    wind_direction INTEGER,
    conditions TEXT,
    icon TEXT,
    sunrise INTEGER,
    sunset INTEGER,
    location TEXT
);

CREATE TABLE IF NOT EXISTS weather_forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    forecast_time DATETIME,
    temperature REAL,
    humidity REAL,
    conditions TEXT,
    precipitation_chance REAL,
    wind_speed REAL,
    location TEXT
);

CREATE INDEX IF NOT EXISTS idx_weather_timestamp ON weather_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_forecast_timestamp ON weather_forecasts(forecast_time);
"
create_database "data/weather.db" "weather database" "$WEATHER_SQL"

# Create default admin user if users.db is new
echo -e "${YELLOW}[*]${NC} Checking for default admin user..."
USER_COUNT=$(sqlite3 data/users.db "SELECT COUNT(*) FROM users WHERE username='DevOps';" 2>/dev/null)

if [ "$USER_COUNT" = "0" ] || [ -z "$USER_COUNT" ]; then
    echo -e "${YELLOW}[*]${NC} Creating default admin user..."
    # Default password: Invertedskynet2$
    # Hash: $2a$10$xH3.vEaHIJQZPKT3Ck.3MuH/KdV9XCZX8eXm16X9.KYZFGp6gC7.K
    sqlite3 data/users.db "
        INSERT INTO users (username, password, role)
        VALUES ('DevOps', '\$2a\$10\$xH3.vEaHIJQZPKT3Ck.3MuH/KdV9XCZX8eXm16X9.KYZFGp6gC7.K', 'admin');
    " 2>/dev/null

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[✓]${NC} Default admin user created (DevOps)"
    else
        echo -e "${YELLOW}[!]${NC} Could not create default user"
    fi
else
    echo -e "${GREEN}[✓]${NC} Admin user already exists"
fi

# Display database information
echo -e "\n${GREEN}=== Database Status ===${NC}"
for db in metrics users audit alarms weather; do
    if [ -f "data/$db.db" ]; then
        SIZE=$(du -h "data/$db.db" | cut -f1)
        TABLES=$(sqlite3 "data/$db.db" ".tables" 2>/dev/null | wc -w)
        echo -e "${GREEN}[✓]${NC} $db.db - Size: $SIZE, Tables: $TABLES"
    else
        echo -e "${RED}[✗]${NC} $db.db - Not found"
    fi
done

echo -e "\n${GREEN}=== Quick Database Commands ===${NC}"
echo "View tables: sqlite3 data/[database].db '.tables'"
echo "View schema: sqlite3 data/[database].db '.schema [table]'"
echo "Count records: sqlite3 data/metrics.db 'SELECT COUNT(*) FROM nodered_readings;'"
echo "Recent data: sqlite3 data/metrics.db 'SELECT * FROM nodered_readings ORDER BY id DESC LIMIT 10;'"

echo -e "\n${GREEN}[✓] Database initialization complete!${NC}"