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
const landscapeAppFolder = process.env.LANDSCAPEAPP_FOLDER || "../landscapeapp";
let serverPort = 3010;
const maxServers = 20;
const maxTimeoutInMinutes = 15;

const serverData = {};

const httpsInfo = process.env.DOMAIN ? {
    key: require('fs').readFileSync(`/etc/letsencrypt/live/${process.env.DOMAIN}/privkey.pem`, 'utf-8'),
    cert: require('fs').readFileSync(`/etc/letsencrypt/live/${process.env.DOMAIN}/cert.pem`, 'utf-8'),
    ca: require('fs').readFileSync(`/etc/letsencrypt/live/${process.env.DOMAIN}/chain.pem`, 'utf-8')
} : null;

require('fs').mkdirSync(tmpFolder, { recursive: true });

async function cleanup() {
    const log = function(x) {
        console.info(`[Cleanup] ${x}`);
    }
    // 1 - remove entry from serverData with no more requests than X minutes ago
    // 2 - get folders not in serverData more than 5 minutes ago and remove those folders. 
    // 3 - get processes (ps aux | grep next dev | grep -v grep) not in serverData and kill those processes
    console.info({serverData});
    for (let key in serverData) {
        const serverInfo = serverData[key];
        if (new Date().getTime() > serverInfo.lastRequest + maxTimeoutInMinutes * 60 * 1000) {
            log(`Deleting an entry ${key} because of timeout`);
            delete serverData[key];
        }
    }

    const folders = await fs.readdir(tmpFolder);
    for (let folder of folders) {
        const createdTime = (await fs.stat(path.resolve(tmpFolder, folder))).ctimeMs;
        const serverInfo = Object.values(serverData).filter( (x) => x.socketId === folder)[0];
        console.info({ folder, createdTime, serverInfo });
        if (!serverInfo && new Date().getTime() > createdTime + maxTimeoutInMinutes * 60 * 1000) {
            log(`Deleting a folder ${folder}`);
            childProcess.exec(`rm -rf "${path.join(tmpFolder, folder)}"`);
        }
    }

    const pids1 = childProcess.execSync('ps aux | grep "yarn-berry.js dev" | grep -v grep || echo').toString()
        .split('\n').filter( (x) => !!x).map( (x) => +x.split(' ').filter( (x) => !!x)[1]);
    const pids = pids1.length > 0
        ?  pids1
        : childProcess.execSync('ps aux | grep "yarn dev" | grep -v grep || echo').toString()
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
            log(`Deleting an entry ${key} - no pid ${serverInfo.pid}`);
            delete serverData[key];
        }
    }
}

async function prepareServerFolders() {
    const folders = await fs.readdir(tmpFolder);
    if (folders.length < maxServers ) {
        const folderName = `tmp${Math.random()}`;
        const finalFolderName = folderName.replace('tmp', 'server');
        const appPath = path.resolve(tmpFolder, folderName);
        await utils.cloneLandscapeApp({ srcPath: landscapeAppFolder, appPath: appPath });
        await fs.rename(path.resolve(tmpFolder, folderName), path.resolve(tmpFolder, finalFolderName));
        console.info(`Server prepared`);
    }
}

async function getFreeFolder() {
    const folders = await fs.readdir(tmpFolder);
    const temporaryFolders = folders.filter( (x) => x.startsWith('server'));
    return temporaryFolders[0];
}

async function autoUpdate() {
    const autoUpdatePid = childProcess.spawn('bash', ['-c', ` git pull && yarn`], {
        cwd: path.resolve(landscapeAppFolder),
        stdio: 'inherit'
    });
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
    const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: path.resolve(landscapeAppFolder) });

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

    const freeFolder = await getFreeFolder();
    if (freeFolder) {
        await fs.rename(path.resolve(tmpFolder, freeFolder), appPath);
    } else {
        await utils.cloneLandscapeApp({ srcPath: landscapeAppFolder, appPath: appPath });
    }


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


const server = httpsInfo ? require('https').createServer(httpsInfo, app) : require('http').createServer(app);
const webSocketServer = new WebSocket.Server({ server });
webSocketServer.allClients = {};
webSocketServer.on("connection", (webSocket) => {
    const id = Math.random() + ':' + new Date().getTime();
    webSocket.send(JSON.stringify({type: "id", id })); 
    webSocket.internalId = id;
    webSocketServer.allClients[id] = webSocket;
    console.info("Total connected clients:", Object.keys(webSocketServer.allClients));
});

server.listen(httpsInfo ? 443 : process.env.PORT || 3000);

// autocleanup everything regularly
cleanup();
prepareServerFolders();
autoUpdate();
setInterval(cleanup, 1 * 60 * 1000);
setInterval(prepareServerFolders, 1 * 60 * 1000);
setInterval(autoUpdate, 1 * 60 * 1000);
