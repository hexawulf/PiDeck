module.exports = {
  apps: [{
    name: 'pideck',
    script: './dist/index.js',
    cwd: '/home/zk/projects/PiDeck',
    interpreter: 'node',
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '120M',
    env_file: '.env',
    env: {
      NODE_ENV: 'production',
      PORT: 5006
    }
  }]
}
