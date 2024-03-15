module.exports = {
  apps : [{
      name: "server",
      script: ". ~/landscapes.env && yarn node ./server.js",
      watch: false,
      autorestart: false,
      cwd: require('path').resolve(__dirname)
  }]
}


