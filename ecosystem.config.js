module.exports = {
  apps : [{
      name: "server",
      script: ". ~/landscapes.env && node ./server.js",
      watch: true,
      cwd: require('path').resolve(__dirname)
  }]
}


