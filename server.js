const fs = require('fs/promises');
const util = require('util');
const path = require('path');
const express = require('express');
const childProcess = require('child_process');
const exec = util.promisify(childProcess.exec);
const WebSocket = require("ws");
const send = require('send');
const cookieParser = require('cookie-parser');
const parseUrl = require('parseurl');


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
const maxTimeoutInMinutes = 720;

const serverData = {}; // builds for every socket

const httpsInfo = process.env.DOMAIN ? {
    key: require('fs').readFileSync(`/etc/letsencrypt/live/${process.env.DOMAIN}/privkey.pem`, 'utf-8'),
    cert: require('fs').readFileSync(`/etc/letsencrypt/live/${process.env.DOMAIN}/cert.pem`, 'utf-8'),
    ca: require('fs').readFileSync(`/etc/letsencrypt/live/${process.env.DOMAIN}/chain.pem`, 'utf-8')
} : null;

require('fs').mkdirSync(tmpFolder, { recursive: true });

const githubRepoLandscapes = `
        cncf/landscape
        AcademySoftwareFoundation/aswf-landscape
        cdfoundation/cdf-landscape
        finos/FINOS-landscape
        hyperledger-landscape/hl-landscape
        graphql/graphql-landscape
        jmertic/lf-landscape
        lfai/landscape
        State-of-the-Edge/lfedge-landscape
        lf-energy/lfenergy-landscape
        lfph/lfph-landscape
        openmainframeproject/omp-landscape
        ossf/ossf-landscape
        todogroup/ospolandscape
        prestodb/presto-landscape
        TarsCloud/TARS_landscape
        ucfoundation/ucf-landscape
    `.split('\n').map( (x) => x.trim()).filter( (x) => !!x);


const isUpdatingLandscape = {};
async function fetchGithubRepoLandscapes() {
    await fs.mkdir('tmp-landscapes', { recursive: true});
    for (const landscape of githubRepoLandscapes) {
        if (!isUpdatingLandscape[landscape]) {
            isUpdatingLandscape[landscape] = true;
            const repoUrl = `https://github.com/${landscape}`;
            const githubRepoPath = path.resolve('tmp-landscapes', landscape.replace('/' , '-'));
            await fs.rm(githubRepoPath, { force: true, recursive: true });

            const cmd = `git clone ${repoUrl} ${landscape.replace('/', '-')}`;
            const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: 'tmp-landscapes', stdio: 'inherit' });

            const p = new Promise(function(resolve) {
                pid.on('close', () => resolve());
            });
            await p;
            isUpdatingLandscape[landscape] = false;
        }
    }
}



async function cleanup() {
    const log = function(x) {
        console.info(`[Cleanup] ${x}`);
    }
    const folders = await fs.readdir(tmpFolder);
    for (let folder of folders) {
        const createdTime = (await fs.stat(path.resolve(tmpFolder, folder))).ctimeMs;
        if (new Date().getTime() > createdTime + maxTimeoutInMinutes * 60 * 1000) {
            log(`[Cleanup] Deleting a folder ${folder}`);
            exec(`rm -rf "${path.join(tmpFolder, folder)}"`);
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

app.post('/api/connect', async function(req, res) {

    const repoFolder = req.body.repo.replace('/', '-');
    const repoHost = `https://$GITHUB_USER:$GITHUB_TOKEN@github.com`;
    const repoUrl = `https://$GITHUB_USER:$GITHUB_TOKEN@github.com/${req.body.repo}`;
    const branch = `web-landscape-${req.body.branch}`;

    const socketId = req.body.socketId;
    const clientSocket = webSocketServer.allClients[socketId];
    console.info({socketId});
    if (!clientSocket) {
        res.json({success: false, message: 'Not valid socketId: ' + socketId, clients: Object.keys(webSocketServer.allClients)});
        return;
    }

    const fn = async () => {
        isUpdatingLandscape[req.body.repo] = true;
        const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
        await fs.mkdir(tmpPath, { recursive: true});

        const defaultBranch = (await exec(`cd tmp-landscapes/${repoFolder} && git rev-parse --abbrev-ref HEAD`)).stdout.trim();

        clientSocket.send(JSON.stringify({type: 'message', target: 'connect', text: `default branch is ${defaultBranch}\n`}));
        const cmd = ` git clone ../../../tmp-landscapes/${repoFolder} . && \
                    git remote rm origin && \
                    git remote add origin ${repoUrl} && \
                    git fetch && \
                    git reset --hard origin/${defaultBranch} && \
                    (git checkout -t origin/${branch} || git checkout -b ${branch}) \
                    `
        const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: tmpPath });

        pid.stdout.on('data', (data) => {
            clientSocket.send(JSON.stringify({type: 'message', target: 'connect', text: data.toString()}));
        });

        pid.stderr.on('data', (data) => {
            clientSocket.send(JSON.stringify({type: 'message', target: 'connect', text: data.toString()}));
        });

        pid.on('close', async (code) => {
            isUpdatingLandscape[req.body.repo] = false;
            clientSocket.send(JSON.stringify({type: 'finish', target: 'connect', code }));
            res.json({success: true, pid: pid.pid});
        });
    }

    if (isUpdatingLandscape[req.body.repo]) {
        setTimeout(fn, 100);
    } else {
        fn();
    }

});

// get a content of a single file
app.post('/api/download-file', async function(req, res) {

    const socketId = req.body.socketId;
    const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
    try {
        const content = await fs.readFile(path.resolve(tmpPath, req.body.dir || '', req.body.name), 'utf-8');
        res.json({success: true, content: content });
    } catch(ex) {
        res.json({success: false, content: '' });
    }
});

app.post('/api/upload-file', async function(req, res) {
    const socketId = req.body.socketId;
    const clientSocket = webSocketServer.allClients[socketId];
    const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
    try {
        await fs.writeFile(path.resolve(tmpPath, req.body.dir || '', req.body.name), req.body.content);
    } catch(ex) {
        res.status(404);
        res.end('failed');
        return;
    }

    const cmd = `git add . && git commit -m 'update ${req.body.name}' && git push origin HEAD`;
    const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: tmpPath });

    pid.stdout.on('data', (data) => {
        clientSocket.send(JSON.stringify({type: 'message', target: 'connect', text: data.toString()}));
    });

    pid.stderr.on('data', (data) => {
        clientSocket.send(JSON.stringify({type: 'message', target: 'connect', text: data.toString()}));
    });

    pid.on('close', async (code) => {
        clientSocket.send(JSON.stringify({type: 'finish', target: 'connect', code }));
        res.json({success: true, code: code });
    });
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
        if (req.body.files) {
            const files = await utils.collectFiles(tmpPath);
            const diff = utils.calculateDifference({oldFiles: req.body.files, newFiles: files});
            console.info('Got files: ', files.length, 'Diff: ', diff.length);
            clientSocket.send(JSON.stringify({type: 'files', files: diff }));
            clientSocket.send(JSON.stringify({type: 'finish', target: 'fetch', code }));
        } else {
            const cmd = `git add . && git commit -m 'yarn fetch' && git push origin HEAD`;
            const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: tmpPath });

            pid.stdout.on('data', (data) => {
                clientSocket.send(JSON.stringify({type: 'message', target: 'fetch', text: data.toString()}));
            });

            pid.stderr.on('data', (data) => {
                clientSocket.send(JSON.stringify({type: 'message', target: 'fetch', text: data.toString()}));
            });

            pid.on('close', async (code) => {
                clientSocket.send(JSON.stringify({type: 'finish', target: 'fetch', code }));
            });
        }
    });
    res.json({success: true, pid: pid.pid});
});

app.get('/api/build', async function(req) {
    res.json(serverData[req.query.socketId]);
});

async function build({req, res }) {
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

    try {
        await fs.access(appPath)
    } catch (ex) {
        const freeFolder = await getFreeFolder();
        if (freeFolder) {
            await fs.rename(path.resolve(tmpFolder, freeFolder), appPath);
        } else {
            await utils.cloneLandscapeApp({ srcPath: landscapeAppFolder, appPath: appPath });
        }
    }

    if (serverData[socketId]) {
        if (serverData[socketId].pid) {
            process.kill(serverData[socketId].pid);
        }
    }

    const cmd = `FORCE_COLOR=0 PROJECT_NAME=landscape PROJECT_PATH=../landscape yarn preview`;
    const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: appPath });
    console.info({cmd, appPath, pid: pid.pid});

    serverData[socketId] = {
        pid: pid.pid,
        status: 'progress'
    }
    clientSocket.send(JSON.stringify({type: 'status', target: 'server', status: serverData[socketId].status }));

    pid.stdout.on('data', (data) => {
        const text = data.toString();
        clientSocket.send(JSON.stringify({type: 'message', target: 'server', text: data.toString()}));
    });

    pid.stderr.on('data', (data) => {
        clientSocket.send(JSON.stringify({type: 'message', target: 'server', text: data.toString()}));
    });

    pid.on('close', (code) => {
        serverData[socketId] = {
          pid: null,
          status: code ? 'fail' : 'success'
        }
        clientSocket.send(JSON.stringify({type: 'finish', target: 'server', code: code }));
        clientSocket.send(JSON.stringify({type: 'status', target: 'server', status: serverData[socketId].status }));
    });
}

app.post('/api/build', async function(req, res) {
    await build({ req, res });
    res.json({success: true});
});

app.use('/landscape', function(req, res) {
    const socketId = req.cookies.socketId;
    const entry = serverData[socketId];
    if (!entry) {
        res.end('<h1>Server is not ready</h1>');
    } else {
        // root is tmp/${socketId}/landscapeapp/out
        const root = path.resolve('tmp', socketId, 'landscapeapp', 'out');
        send(req, parseUrl(req).pathname.replace('/landscape', ''), { root }).pipe(res)
    }
});

app.use('/api/status', function(req, res) {

});

app.use(function (err, req, res, next) {
  console.error(err.stack)
  res.status(500).send('Something broke!')
})


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
if (!process.env.SKIP_UPDATES) {
    autoUpdate();
    setInterval(autoUpdate, 1 * 60 * 1000);

    fetchGithubRepoLandscapes();
    setInterval(fetchGithubRepoLandscapes, 4 * 3600 * 1000); //every 4 hour get a fresh repo
}
setInterval(cleanup, 1 * 60 * 1000);
setInterval(prepareServerFolders, 1 * 60 * 1000);

process.on('unhandledRejection', function(err) {
    console.log(err);
});
