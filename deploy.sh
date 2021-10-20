ssh -t root@86.109.11.205 <<'EOL'
  tmux -c 'cd web-landscape && git pull && pm2 status && pm2 stop all && pm2 start'
EOL

