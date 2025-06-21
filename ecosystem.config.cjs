module.exports = {
  apps: [{
    name: 'pideck',
    script: './dist/index.js',
    env: {
      NODE_ENV: 'production',
      PORT: 5006
    }
  }]
}
