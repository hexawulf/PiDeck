module.exports = {
  apps: [{
    name: 'pideck',
    script: './dist/index.js',
    cwd: '/home/zk/projects/PiDeck',
    interpreter: 'node',
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '256M',
    restart_delay: 5000,
    max_restarts: 10,
    merge_logs: true,
    env_file: '.env',
    env: {
      NODE_ENV: 'production',
      PORT: 5006
    }
  }]
}
