module.exports = {
  apps: [{
    name: 'logic-executor',
    script: './src/services/logicExecutorService.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/logic-executor-error.log',
    out_file: './logs/logic-executor-out.log',
    log_file: './logs/logic-executor-combined.log',
    time: true,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};