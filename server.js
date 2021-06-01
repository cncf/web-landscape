const path = require('path');
const express = require('express');
const childProcess = require('child_process');
const WebSocket = require("ws");
const httpProxy = require('http-proxy');
const proxy = httpProxy.createProxyServer();
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json({limit: '1gb'}));
app.use(express.static('public'));
app.use(cookieParser());

const utils = require('./utils');
const port = process.env.PORT || 3000;
const tmpFolder = process.env.TMP_FOLDER || 'tmp';
let serverPort = 3010;


app.post('/api/fetch', async (req, res) => {
    const socketId = req.body.socketId;
    const clientSocket = webSocketServer.allClients[socketId];
    console.info({socketId});
    if (!clientSocket) {
        res.json({success: false, message: 'Not valid socketId: ' + socketId, clients: Object.keys(webSocketServer.allClients)});
        return;
    }

    const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
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

app.post('/api/server', async function(req, res) {
    const socketId = req.body.socketId;

    const clientSocket = webSocketServer.allClients[socketId];
    console.info({socketId});
    if (!clientSocket) {
        res.json({success: false, message: 'Not valid socketId: ' + socketId, clients: Object.keys(webSocketServer.allClients)});
        return;
    }

    const appPath = path.resolve(tmpFolder, socketId, 'landscapeapp');
    const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
    await utils.cloneLandscapeApp({ srcPath: '../landscapeapp', appPath: appPath });
    // get a new port
    serverPort += 1;
    const cmd = `PORT=${serverPort} FORCE_COLOR=0 PROJECT_NAME=landscape PROJECT_PATH=../landscape yarn dev`;
    const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: appPath });
    console.info({cmd, appPath});
    res.cookie('serverPort', serverPort);
    res.end('');

    pid.stdout.on('data', (data) => {
        console.info(data.toString());
        clientSocket.send(JSON.stringify({type: 'message', text: data.toString()}));
    });

    pid.stderr.on('data', (data) => {
        console.info(data.toString());
        clientSocket.send(JSON.stringify({type: 'message', text: data.toString()}));
    });
    // set a cookie with a port!
});

// allow a client to just update files
app.post('/api/upload', function(req, res) {


});

app.use('/landscape', function(req, res) {
    const serverPort = req.cookies.serverPort;
    if (!serverPort) {
        res.end('<h1>Server is not ready</h1>');
    } else {
        req.url = req.originalUrl;
        proxy.web(req, res, { target: `http://localhost:${serverPort}` });
    }
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
