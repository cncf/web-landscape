console.info('test');


function init() {
    const tmpDiv = document.createElement('div');
    document.body.appendChild(tmpDiv);
    tmpDiv.outerHTML = `
        <div id="main" style="height: 100%;">
            <div style="height: 40px;">
                <span style="font-size: 24px;"><b>yarn fecth demo</b></span>
                <input id="dir" type="button" value="1. Select folder with a landscape"></input>
                <input id="run" type="button" value="2. Run yarn fetch (takes areound a minute)"></input>
                <input id="server" type="button" value="3. Run yarn dev (takes around a minute)"></input>
                <div id="status" style="display: inline-block; font-weight: bold;"></div>
            </div>
            <div style="height: calc(100% - 40px)">
                <div class="output" id="output-fetch" style="position: absolute; width: 50%; height: 100%; left: 0">
                  <div><b>yarn fetch</b> output</div>
                </div>
                <div class="output" id="output-dev" style="position: absolute; width: 50%; height: 100%; left: 50%">
                  <div><b>yarn dev</b> output</div>
                </div>
            </div>
        </div>
    `;
    const mainDiv = document.querySelector('#main');

    const ws = new WebSocket(window.location.href.replace('http', 'ws'));
    ws.onmessage = async function(event) {
        const data = JSON.parse(event.data);
        if (data.type === 'id') {
            window.socketId = data.id;
            console.info(`Socket: ${data.id}`);
        }
        if (data.type === 'message') {
            const textEl = document.createElement('span');
            textEl.innerText = data.text;
            const outputDiv = data.target = 'fetch' ? outputFetchDiv : outputDevDiv;
            outputDiv.appendChild(textEl);
            statusDiv.innerText = `Fetching data`;
        }
        if (data.type === 'finish') {
            statusDiv.innerText = `Waiting for updated files`;
        }
        if( data.type === 'files') {
            statusDiv.innerText = `Got files to update : ${data.files.length}`;
            for (let entry of data.files) {
                const parts = entry.file.split('/');
                const { dirHandle, fileHandle } = await (async function() {
                    if (parts.length === 1) {
                        const fileHandle = await webFolder.getFileHandle(parts[0]);
                        return {fileHandle, dirHandle: webFolder };
                    } else {
                        const dirHandle = await webFolder.getDirectoryHandle(parts[0]);
                        const fileHandle =  await dirHandle.getFileHandle(parts[1], { create: true});
                        return {fileHandle, dirHandle };
                    }
                })(); 
                if (entry.isDeleted) {
                    dirHandle.removeEntry(entry.file.split('/').slice(-1)[0]);
                    console.info('file deleted! ', entry.file);
                } else {
                    const stream = await fileHandle.createWritable();
                    await stream.write(entry.content);
                    await stream.close();
                    console.info('file saved! ', entry.file);
                }
            }
            statusDiv.innerText = `Fetch finished. ${data.files.length} files updated`;
            serverButton.disabled = false;
        }
    };

    const inputButton = mainDiv.querySelector('#run');
    const serverButton = mainDiv.querySelector('#server');
    const dirButton = mainDiv.querySelector('#dir');
    const outputFetchDiv = mainDiv.querySelector('#output-fetch');
    const outputDevDiv = mainDiv.querySelector('#output-dev');
    const statusDiv = mainDiv.querySelector('#status');

    inputButton.disabled = true;
    serverButton.disabled = true;

    async function collectAllFiles() {
        const files = [];
        const landscapeFiles = ['settings.yml', 'landscape.yml', 'processed_landscape.yml'];
        const landscapeFolders = ['images', 'cached_logos', 'hosted_logos'];
        for (var file of landscapeFiles) {
            const handle = await webFolder.getFileHandle(file);
            const content = await (await handle.getFile()).text();
            files.push({file, content});
        }
        for (var folder of landscapeFolders) {
            const dirHandle = await webFolder.getDirectoryHandle(folder);
            for await (const entry of dirHandle.values()) {
                const file = entry.name;
                const handle = await dirHandle.getFileHandle(file);
                const content = await (await handle.getFile()).text();
                files.push({file: `${folder}/${file}`, content});
            }
        }
        return files;
    }

    inputButton.addEventListener('click', async function() {
        statusDiv.innerText = `Collecting local files`;
        const files = await collectAllFiles();
        statusDiv.innerText = `Uploading local files`;
        await fetch('api/fetch', {
            body: JSON.stringify({ socketId: socketId, files: files}),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });
        statusDiv.innerText = `Waiting for response from the server`;
    });

    serverButton.addEventListener('click', async function() {
        statusDiv.innerText = `Starting a dev server`;
        await fetch('api/server', {
            body: JSON.stringify({ socketId: socketId }),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });
        statusDiv.innerText = `Dev server started`;
    });

    dirButton.addEventListener('click', async function() {
        window.webFolder = await window.showDirectoryPicker();
        const permission = await webFolder.requestPermission({mode: 'readwrite'});
        if (permission !== 'granted') {
            console.info('Permission to the folder was not provided');
        }
        inputButton.disabled = false;
    });
}

window.addEventListener('DOMContentLoaded', init);
