Dev notes:
Should use same node.js version as landscapeapp (16.12.0)

Prod server: 86.109.11.205	
to deploy: 
  - ssh to prod: ssh root@86.109.11.205
  - cd `web-landscape`
  - git pull
  - ps2 stop all
  - ps2 start

Local mode - only "preview" folder will be used instead of a landscape.

1) On connect - all files are uploaded (to landscape and preview)

2) Direct file changes are ignored and not tracked anymore. Only changes via UI are uploaded

3) Yarn fetch is still available and only yarn fetch will update a local folder(download files back after a yarn fetch)
On yarn fetch all changes will be saved
