ssh -t root@86.109.11.205 <<'EOL'
  cd web-landscape
  git pull
  yarn
  pm2 stop all
  pm2 start
  service nginx restart
EOL

