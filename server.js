const path = require('path');
const express = require('express');
const childProcess = require('child_process');
const WebSocket = require("ws");
const httpProxy = require('http-proxy');
const proxy = httpProxy.createProxyServer();

const app = express();
app.use(express.json({limit: '1gb'}));
app.use(express.static('public'));

const utils = require('./utils');
const port = 3000;


app.post('/api/fetch', async (req, res) => {
    const socketId = req.body.socketId;
    const clientSocket = webSocketServer.allClients[socketId];
    console.info({socketId});
    if (!clientSocket) {
        res.json({success: false, message: 'Not valid socketId: ' + socketId, clients: Object.keys(webSocketServer.allClients)});
        return;
    }

    const tmpPath = path.resolve('tmp', socketId);
    // upload files to a temp folder
    await utils.uploadFiles({files: req.body.files, landscapePath: tmpPath});

    const cmd = `FORCE_COLOR=0 PROJECT_PATH="${tmpPath}" yarn fetch`;
    const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: path.resolve('../landscapeapp') });

    pid.stdout.on('data', (data) => {
        clientSocket.send(JSON.stringify({type: 'message', text: data.toString()}));
    });

    pid.stderr.on('data', (data) => {
        clientSocket.send(JSON.stringify({type: 'message', text: data.toString()}));
    });

    pid.on('close', async (code) => {
        clientSocket.send(JSON.stringify({type: 'finish', code }));
        const files = await utils.collectFiles(tmpPath);
        const diff = utils.calculateDifference({oldFiles: req.body.files, newFiles: files});
        console.info('Got files: ', files.length, 'Diff: ', diff.length);
        clientSocket.send(JSON.stringify({type: 'files', files: diff }));
    });
    res.json({success: true, pid: pid.pid});
});
app.use('/landscape', function(req, res) {
    req.url = req.originalUrl;
    proxy.web(req, res, { target: 'http://localhost:3001' });
});


const server = require('http').createServer(app);
const webSocketServer = new WebSocket.Server({ server });
webSocketServer.allClients = {};
webSocketServer.on("connection", (webSocket) => {
    const id = Math.random() + ':' + new Date().getTime();
    webSocket.send(JSON.stringify({type: "id", id })); 
    webSocket.internalId = id;
    webSocketServer.allClients[id] = webSocket;
    console.info("Total connected clients:", Object.keys(webSocketServer.allClients));
});

server.listen(process.env.PORT || 3000);
