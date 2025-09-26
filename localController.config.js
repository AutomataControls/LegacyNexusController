module.exports = {
  apps: [
    {
      name: 'local-controller',
      script: './src/services/localControllerService.js',
      cwd: '/home/Automata/remote-access-portal',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/controller-error.log',
      out_file: './logs/controller-out.log',
      log_file: './logs/controller-combined.log',
      time: true
    }
  ]
};