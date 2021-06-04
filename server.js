const fs = require('fs/promises');
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

const serverData = {};

async function cleanup() {
    const log = function(x) {
        console.info(`[Cleanup] ${x}`);
    }
    // 1 - remove entry from serverData with no more requests than X minutes ago
    // 2 - get folders not in serverData more than 5 minutes ago and remove those folders. 
    // 3 - get processes (ps aux | grep next dev | grep -v grep) not in serverData and kill those processes
    for (let key in serverData) {
        const serverInfo = serverData[key];
        if (new Date().getTime() > serverInfo.lastRequest + 30 * 60 * 1000) {
            log(`Deleting an entry ${key}`);
            delete serverData[key];
        }
    }

    const folders = await fs.readdir(tmpFolder);
    for (let folder of folders) {
        const folderParts = folder.split(':');
        const createdTime = + folderParts[1];
        const serverInfo = Object.values(serverData).filter( (x) => x.socketId === folder)[0];
        if (!serverInfo && new Date().getTime() > createdTime + 30 * 60 * 1000) {
            log(`Deleting a folder ${folder}`);
            await fs.rm(path.join(tmpFolder, folder), { recursive: true, force: true});
        }
    }

    const pids = childProcess.execSync('ps aux | grep "yarn-berry.js dev" | grep -v grep || echo').toString()
        .split('\n').filter( (x) => !!x).map( (x) => +x.split(' ').filter( (x) => !!x)[1]);
    // detect not managed processes
    for (let pid of pids) {
        const serverInfo = Object.values(serverData).filter( (x) => x.pid === pid)[0];
        if (!serverInfo) {
            console.info(pids, Object.values(serverData));
            log(`Killing process ${pid}`);
            process.kill(pid);
        }
    }
    // detect killed processes
    for (let key in serverData) {
        const serverInfo = serverData[key];
        if (!pids.includes(serverInfo.pid)) {
            console.info(pids, serverInfo);
            log(`Deleting an entry ${key}`);
            delete serverData[key];
        }
    }

}

async function uploadFiles(req, res) {
    if (req.body.files) {
        const socketId = req.body.socketId;
        const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
        await utils.uploadFiles({files: req.body.files, landscapePath: tmpPath});
    }
}

app.post('/api/upload', async function(req, res) {
    await uploadFiles(req, res);
});



app.post('/api/fetch', async (req, res) => {
    await uploadFiles(req, res);
    const socketId = req.body.socketId;
    const clientSocket = webSocketServer.allClients[socketId];
    console.info({socketId});
    if (!clientSocket) {
        res.json({success: false, message: 'Not valid socketId: ' + socketId, clients: Object.keys(webSocketServer.allClients)});
        return;
    }

    const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
    // upload files to a temp folder

    const cmd = `FORCE_COLOR=0 PROJECT_PATH="${tmpPath}" yarn fetch`;
    const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: path.resolve('../landscapeapp') });

    pid.stdout.on('data', (data) => {
        clientSocket.send(JSON.stringify({type: 'message', target: 'fetch', text: data.toString()}));
    });

    pid.stderr.on('data', (data) => {
        clientSocket.send(JSON.stringify({type: 'message', target: 'fetch', text: data.toString()}));
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
    await uploadFiles(req, res);
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
    console.info({cmd, appPath, pid: pid.pid});

    serverData[serverPort] = {
        pid: pid.pid,
        serverPort,
        socketId,
        lastRequest: new Date().getTime()
    }

    pid.stdout.on('data', (data) => {
        const text = data.toString();
        if (text.includes('started server on')) {
            // now we are ready
            res.cookie('serverPort', serverPort);
            res.end('');
        }
        console.info(data.toString());
        clientSocket.send(JSON.stringify({type: 'message', target: 'server', text: data.toString()}));
    });

    pid.stderr.on('data', (data) => {
        console.info(data.toString());
        clientSocket.send(JSON.stringify({type: 'message', target: 'server', text: data.toString()}));
    });
});

app.use('/landscape', function(req, res) {
    const serverPort = req.cookies.serverPort;
    if (!serverPort) {
        res.end('<h1>Server is not ready</h1>');
    } else {
        const serverInfo = serverData[serverPort];
        if (!serverInfo) {
            res.end('<h1>No server is running at this port</h1>');
        } else {
            req.url = req.originalUrl;
            proxy.web(req, res, { target: `http://localhost:${serverPort}` });
            serverInfo.lastRequest = new Date().getTime();
        }
    }
});

app.use('/api/status', function(req, res) {

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

// autocleanup everything regularly
cleanup();
setTimeout(cleanup, 5 * 60 * 1000);
