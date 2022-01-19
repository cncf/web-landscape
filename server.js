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
            await fs.rm(path.join(tmpFolder, folder),    { force: true, recursive: true });
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
        const previewPath = path.resolve(tmpFolder, socketId, 'preview');
        await utils.uploadFiles({files: req.body.files, landscapePath: previewPath});
    }
}

app.post('/api/upload', async function(req, res) {
    await uploadFiles(req, res);
    res.json({success: true});
});

async function initializePreview(socketId) {
    const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
    const previewPath = path.resolve(tmpFolder, socketId, 'preview');
    const files = ['settings.yml', 'landscape.yml', 'processed_landscape.yml', 'images/', 'hosted_logos/', 'cached_logos/'];
    const fullFiles = files.map( (x) => path.resolve(tmpPath, x));
    await fs.rm(previewPath, {force: true, recursive: true});
    await fs.mkdir(previewPath, {recursive: true });
    await exec(`cp -r ${fullFiles.join(' ')} ${previewPath} `);
}

async function updatePreview({socketId, dir, name}) {
    const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
    const previewPath = path.resolve(tmpFolder, socketId, 'preview');

    const srcFile = path.resolve(tmpPath, dir || '', name);
    const dstFile = path.resolve(previewPath, dir || '', name);
    await fs.copyFile(srcFile, dstFile);
}

async function getPullRequest({req, res}) {
    const repo = req.body.repo;
    const branch = `web-landscape-${req.body.branch}`;

    const client = require('@octokit/core').Octokit;
    const octokit = new client({
        auth: (process.env.GITHUB_KEY || '').split(',')[0]
    });

    const response = await octokit.request(`GET /repos/${repo}/pulls`);

    const baseBranches = response.data.map( (x) => ({ url: x.html_url, branch: x.head.ref }));

    const myBranch = baseBranches.filter( (x) => x.branch === branch)[0];
    return myBranch;

}

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
        const isPredefinedRepo = githubRepoLandscapes.indexOf(req.body.repo) !== -1;
        console.info({isPredefinedRepo, repo: req.body.repo});
        const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
        const previewPath = path.resolve(tmpFolder, socketId, 'preview');
        await fs.mkdir(tmpPath, { recursive: true});

        if (isPredefinedRepo) {
            isUpdatingLandscape[req.body.repo] = true;
            const defaultBranch = (await exec(`cd tmp-landscapes/${repoFolder} && git rev-parse --abbrev-ref HEAD`)).stdout.trim();
            const pullRequest = await getPullRequest({req, res});
            const createPullRequest = `https://github.com/${req.body.repo}/compare/${defaultBranch}...${branch}`;
            // check if there is a pull request for a given branch;

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
                if (code === 0) {
                    await initializePreview(socketId);
                }
                clientSocket.send(JSON.stringify({type: 'finish', target: 'connect', code }));
                res.json({success: true, pid: pid.pid, pr: (pullRequest || {}).url, createPr: createPullRequest});
            });
        } else {
            // that is not our landscape, lets clone it
            const repo = req.body.repo;
            const repoName = req.body.repo.split('/')[1];
            const client = require('@octokit/core').Octokit;
            const octokit = new client({
                auth: (process.env.GITHUB_KEY || '').split(',')[0]
            });
            console.info(`This is a custom repo ${req.body.repo} ${repoName}`);

            try {
                await octokit.request(`GET /repos/CNCF-Bot/${repoName}`);
                console.info(`Fork exists`);
            } catch(err) {
                // the repo does not exist!
                clientSocket.send(JSON.stringify({type: 'message', target: 'connect', text: 'Forking the repo!'}));
                const url = `/repos/${repo}/forks`;
                console.info(`Forking ${url}`);
                await octokit.request(`POST ${url}`);
            }

            const repoUrl = `https://$GITHUB_USER:$GITHUB_TOKEN@github.com/CNCF-Bot/${repoName}`;
            await exec(`cd ${tmpPath} && git clone https://github.com/${repo} && git remote add copy ${repoUrl} && git fetch -a`);
            const defaultBranch = (await exec(`cd ${tmpPath} && git rev-parse --abbrev-ref HEAD`)).stdout.trim();
            await exec(`cd ${tmpPath} && (git checkout -t copy/${branch} || git checkout -b ${branch})`);
            const pullRequest = await getPullRequest({req, res});
            const createPullRequest = `https://github.com/${req.body.repo}/compare/${defaultBranch}...CNCF-Bot:${branch}`;

            await initializePreview(socketId);
            clientSocket.send(JSON.stringify({type: 'finish', target: 'connect', code }));
            res.json({success: true, pid: pid.pid, pr: (pullRequest || {}).url, createPr: createPullRequest});

        }
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
        const content = await fs.readFile(path.resolve(tmpPath, req.body.dir || '', req.body.name), req.body.encoding === 'base64' ? 'base64' : 'utf-8');
        res.json({success: true, content: content });
    } catch(ex) {
        res.json({success: false, content: '' });
    }
});

app.post('/api/upload-file', async function(req, res) {
    const socketId = req.body.socketId;
    const clientSocket = webSocketServer.allClients[socketId];
    const tmpPath = path.resolve(tmpFolder, socketId, 'landscape');
    const previewPath = path.resolve(tmpFolder, socketId, 'preview');
    const isPreview = req.body.mode === 'preview';
    const targetPath = isPreview ? previewPath : tmpPath;

    try {
        const content = req.body.encoding === 'base64' ? Buffer.from(req.body.content, 'base64') : req.body.content;
        await fs.writeFile(path.resolve(targetPath, req.body.dir || '', req.body.name), content);
    } catch(ex) {
        console.info(ex.message);
        res.status(404);
        res.end('failed');
        return;
    }

    if (!isPreview) {
        await updatePreview({socketId, dir: req.body.dir, name: req.body.name });

        const cmd = `git add . && git commit -m 'update ${req.body.name}' && (git push copy HEAD || git push origin HEAD)`;
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
    } else {
        build({req, res});
        res.json({success: true, code: 0});
    }
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

    const tmpPath = path.resolve(tmpFolder, socketId, req.body.mode === 'preview' ? 'preview' : 'landscape');
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
            const cmd = `git add . && git commit -m 'yarn fetch' && (git push copy HEAD || git push origin HEAD)`;
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

app.post('/api/item-id', async function(req, res) {
    const socketId = req.body.socketId;
    const fileName = path.resolve(tmpFolder, socketId, 'landscapeapp', 'out', 'data', 'items.json');
    const content = JSON.parse(await fs.readFile(fileName, 'utf-8'));
    const item = content.filter( (x) => x.path === req.body.path && x.name === req.body.name)[0]
    if (item) {
        res.json({id: item.id});
    } else  {
        res.json({success: false});
    }
});

async function build({req, res }) {
    const socketId = req.body.socketId;
    if (serverData[socketId]) {
        if (serverData[socketId].pid) {
            process.kill(-serverData[socketId].pid);
        }
    }
    await uploadFiles(req, res);

    const clientSocket = webSocketServer.allClients[socketId];
    console.info({socketId});
    if (!clientSocket) {
        res.json({success: false, message: 'Not valid socketId: ' + socketId, clients: Object.keys(webSocketServer.allClients)});
        return;
    }

    const appPath = path.resolve(tmpFolder, socketId, 'landscapeapp');

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

    const cmd = `PREVIEW=1 FORCE_COLOR=0 PROJECT_NAME=landscape PROJECT_PATH=../preview yarn preview`;
    const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: appPath, detached: true });
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
        if (pid.pid !== serverData[socketId].pid) {
            return; // obsolete process
        }
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
