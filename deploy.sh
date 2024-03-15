ssh -t root@136.144.51.247 <<'EOL'
  cd web-landscape
  git pull
  yarn
  pm2 stop all
  pm2 start
  service nginx restart
EOL

