require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'nexus-portal',
      script: './server.js',
      cwd: '/home/Automata/remote-access-portal',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: process.env.PORT || 8000,
        HOST: process.env.HOST || '0.0.0.0',
        HOME: '/home/Automata',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'local-controller',
      script: './src/services/localControllerService.js',
      cwd: '/home/Automata/remote-access-portal',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOME: '/home/Automata',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      },
      error_file: './logs/controller-error.log',
      out_file: './logs/controller-out.log',
      log_file: './logs/controller-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'logic-executor',
      script: './src/services/logicExecutorService.js',
      cwd: '/home/Automata/remote-access-portal',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOME: '/home/Automata',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      },
      error_file: './logs/logic-executor-error.log',
      out_file: './logs/logic-executor-out.log',
      log_file: './logs/logic-executor-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'bms-reporter',
      script: './bms-reporter.js',
      cwd: '/home/Automata/remote-access-portal',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOME: '/home/Automata',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      },
      error_file: './logs/bms-reporter-error.log',
      out_file: './logs/bms-reporter-out.log',
      log_file: './logs/bms-reporter-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'processing-reporter',
      script: './processing-reporter.js',
      cwd: '/home/Automata/remote-access-portal',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOME: '/home/Automata',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      },
      error_file: './logs/processing-reporter-error.log',
      out_file: './logs/processing-reporter-out.log',
      log_file: './logs/processing-reporter-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'vibration-monitor',
      script: './src/services/vibrationMonitorService.js',
      cwd: '/home/Automata/remote-access-portal',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOME: '/home/Automata',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      },
      error_file: './logs/vibration-error.log',
      out_file: './logs/vibration-out.log',
      log_file: './logs/vibration-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};