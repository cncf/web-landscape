module.exports = {
  apps : [{
      name: "server",
      script: ". ~/landscapes.env && yarn node ./server.js",
      watch: true,
      cwd: require('path').resolve(__dirname)
  }]
}


