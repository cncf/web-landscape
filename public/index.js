console.info('test');

async function collectAllFiles() {
    const files = {};
    const landscapeFiles = ['settings.yml', 'landscape.yml', 'processed_landscape.yml'];
    const landscapeFolders = ['images', 'cached_logos', 'hosted_logos'];
    for (var file of landscapeFiles) {
        const handle = await webFolder.getFileHandle(file);
        const fileObj = await handle.getFile();
        const content = await fileObj.text();
        files[file] = {
            file,
            content,
            lastModified: fileObj.lastModified
        }
    }

    for (var folder of landscapeFolders) {
        const dirHandle = await webFolder.getDirectoryHandle(folder);
        for await (const entry of dirHandle.values()) {
            const file = entry.name;
            const handle = await dirHandle.getFileHandle(file);
            const fileObj = await handle.getFile();
            const content = await fileObj.text();
            files[`${folder}/${file}`] = {
                file: `${folder}/${file}`,
                content,
                lastModified: fileObj.lastModified
            };
        }
    }
    return files;
}

// 
async function getChangedFiles(lastSnapshot) {
    const files = {};
    const existingFiles = {}; // to mark deleted files
    const landscapeFiles = ['settings.yml', 'landscape.yml', 'processed_landscape.yml'];
    const landscapeFolders = ['images', 'cached_logos', 'hosted_logos'];

    for (var file of landscapeFiles) {
        const handle = await webFolder.getFileHandle(file);
        const fileObj = await handle.getFile();
        const existingEntry = (lastSnapshot[file] || {});
        existingFiles[file] = true;
        if (existingEntry.lastModified !== fileObj.lastModified) {
            const content = await fileObj.text();
            files[file] = {
                file,
                content,
                lastModified: fileObj.lastModified
            }
        }
    }

    for (var folder of landscapeFolders) {
        const dirHandle = await webFolder.getDirectoryHandle(folder);
        for await (const entry of dirHandle.values()) {
            const file = entry.name;
            const handle = await dirHandle.getFileHandle(file);
            const fileObj = await handle.getFile();
            const existingEntry = (lastSnapshot[`${folder}/${file}`] || {});
            existingFiles[`${folder}/${file}`] = true;
            if (existingEntry.lastModified !== fileObj.lastModified) {
                const content = await fileObj.text();
                files[`${folder}/${file}`] = {
                    file: `${folder}/${file}`,
                    content,
                    lastModified: fileObj.lastModified
                };
            }
        }
    }

    const removedFiles = Object.values(lastSnapshot).filter( (entry) => !existingFiles[entry.file] ).map( (entry) => ({ file: entry.file, isDeleted: true}));

    return Object.values(files).concat(removedFiles);
}


function init() {
    const tmpDiv = document.createElement('div');
    document.body.appendChild(tmpDiv);
    tmpDiv.outerHTML = `
        <div id="main" style="height: 100%;">
            <div style="height: 40px; background: #ddd;">
                <span style="font-size: 24px;"><b>yarn fecth demo</b></span>
                <input id="dir" type="button" value="1. Select folder with a landscape"></input>
                <input id="run" type="button" value="2. Run yarn fetch"></input>
                <input id="server" type="button" value="3. Run yarn dev"></input>
                <span id="overlay-wrapper"><input id="overlay" type="checkbox" checked></input><label for="overlay">Show Overlay</label></span>
                <a href="/landscape" target="_blank">View Landscape</a>
                <div id="status" style="display: inline-block; font-weight: bold;"></div>
            </div>
            <div style="height: calc(100% - 60px); position: relative;">
                <div class="output" id="output-fetch" style="position: absolute; z-index: 100; width: 50%; height: 100%; left: 0">
                  <div><b>yarn fetch</b> output</div>
                </div>
                <div class="output" id="output-dev" style="position: absolute; z-index: 100; width: 50%; height: 100%; left: 50%">
                  <div><b>yarn dev</b> output</div>
                </div>
                <iframe id="iframe" style="border: 0; position: absolute; z-index: 1; width: 100%; height: 100%; left: 0; top: 0;"></iframe>
            </div>
        </div>
    `;
    const mainDiv = document.querySelector('#main');

    function disableButtons() {
        dirButton.disabled = true;
        inputButton.disabled = true;
        serverButton.disabled = true;
    }
    function enableButtons() {
        dirButton.disabled = false;
        inputButton.disabled = false;
        serverButton.disabled = false;
    };

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
            const outputDiv = data.target === 'fetch' ? outputFetchDiv : outputDevDiv;
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
            window.allFiles = await collectAllFiles();
            enableButtons();
        }
    };

    const inputButton = mainDiv.querySelector('#run');
    const serverButton = mainDiv.querySelector('#server');
    const dirButton = mainDiv.querySelector('#dir');
    const outputFetchDiv = mainDiv.querySelector('#output-fetch');
    const outputDevDiv = mainDiv.querySelector('#output-dev');
    const statusDiv = mainDiv.querySelector('#status');
    const landscapeLink = mainDiv.querySelector('a');
    const iframeTag = mainDiv.querySelector('iframe');
    const overlayWrapper = mainDiv.querySelector('#overlay-wrapper');

    overlayWrapper.style.display = "none";
    inputButton.disabled = true;
    serverButton.disabled = true;
    landscapeLink.style.visibility = "hidden";
    iframeTag.style.opacity = 0;





    inputButton.addEventListener('click', async function() {
        disableButtons();
        statusDiv.innerText = `Collecting local files`;
        const files = await collectAllFiles();
        window.allFiles = files;
        statusDiv.innerText = `Uploading local files`;
        await fetch('api/fetch', {
            body: JSON.stringify({ socketId: socketId, files: Object.values(files)}),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });
        statusDiv.innerText = `Waiting for response from the server`;
        overlayWrapper.querySelector('input').checked = true;
        updateOverlayVisibility();
    });

    function listenForFileChanges() {
        if (!window.changesTimerSet) {
            window.changesTimerSet = true;
            setInterval(async function() {
                if (!window.allFiles) {
                    return;
                }
                console.time('changes');
                const changedFiles = await getChangedFiles(window.allFiles);
                console.timeEnd('changes');
                console.info(changedFiles);
                if (changedFiles.length > 0) {
                    statusDiv.innerText = `Uploading local file changes`;
                    const files = await collectAllFiles();
                    window.allFiles = files;
                    await fetch('api/upload', {
                        body: JSON.stringify({ socketId: socketId, files: Object.values(files)}),
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json' 
                        }
                    });
                    statusDiv.innerText = `Changes uploaded`;
                }
            }, 2000);
        }
    }

    serverButton.addEventListener('click', async function() {
        disableButtons();
        statusDiv.innerText = `Collecting local files`;
        const files = await collectAllFiles();
        window.allFiles = files;
        statusDiv.innerText = `Uploading local files and starting a dev server`;
        await fetch('api/server', {
            body: JSON.stringify({ socketId: socketId, files: Object.values(files) }),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });
        statusDiv.innerText = `Dev server started`;
        enableButtons();
        landscapeLink.style.visibility = "";
        listenForFileChanges();
        serverButton.style.visibility = "hidden";
        iframeTag.src = "/landscape";
        iframeTag.style.opacity = 1;
        overlayWrapper.style.display = "";
        outputFetchDiv.style.opacity = 0.3;
        outputFetchDiv.style.pointerEvents = 'none';
        outputDevDiv.style.opacity = 0.3;
        outputDevDiv.style.pointerEvents = 'none';
    });

    function updateOverlayVisibility() {
        const isChecked = overlayWrapper.querySelector('input').checked;
        outputFetchDiv.style.visibility = isChecked ? "" : "hidden";
        outputDevDiv.style.visibility = isChecked ? "" : "hidden";
    }

    overlayWrapper.querySelector('input').addEventListener('click', updateOverlayVisibility);
    overlayWrapper.querySelector('input').addEventListener('change', updateOverlayVisibility);

    dirButton.addEventListener('click', async function() {
        window.webFolder = await window.showDirectoryPicker();
        const permission = await webFolder.requestPermission({mode: 'readwrite'});
        if (permission !== 'granted') {
            console.info('Permission to the folder was not provided');
        }
        enableButtons();
    });
}

window.addEventListener('DOMContentLoaded', init);
window.getChangedFiles = getChangedFiles;
window.collectAllFiles = collectAllFiles;
