module.exports = {
  apps: [
    {
      name: 'exporter',
      script: 'dist/scripts/export.js',
    },
    {
      name: 'server_testnet',
      script: 'dist/server/index.js',
      args: ['-p', '3420', '-c', 'config.testnet.json'],
      instances: 2,
      wait_ready: true,
      listen_timeout: 10000,
    },
    {
      name: 'server_mainnet',
      script: 'dist/server/index.js',
      args: ['-p', '3421', '-c', 'config.mainnet.json'],
      instances: 2,
      wait_ready: true,
      listen_timeout: 10000,
    },
  ],
}
