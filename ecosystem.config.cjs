// pm2 config — `pm2 start ecosystem.config.cjs` from the checkout.
// Portable: the app directory is wherever this file is; PORT, CSP_ENFORCE and
// everything else come from .env (read by the app via dotenv). Only
// NODE_ENV is pinned here.
module.exports = {
  apps: [{
    name: 'pideck',
    script: './dist/index.js',
    cwd: __dirname,
    interpreter: 'node',
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '512M',
    restart_delay: 5000,
    max_restarts: 10,
    merge_logs: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
}
