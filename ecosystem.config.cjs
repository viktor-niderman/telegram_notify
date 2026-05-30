module.exports = {
  apps: [
    {
      name: "telegram_notify",
      script: "server.ts",
      interpreter: "./node_modules/.bin/tsx",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      max_memory_restart: "512M",
      time: true,
    },
  ],
};
