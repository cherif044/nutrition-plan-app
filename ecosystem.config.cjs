module.exports = {
  apps: [
    {
      name: 'nutrition-plan-app',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
      },
      max_memory_restart: '350M',
      time: true,
    },
  ],
};
