// a remote backend is used when we checkout a branch on a server
const remoteBackend = {
    type: 'remote',
    readFile: async function({dir, name}) {
        const content = await fetch(`/api/download-file`, {
            body: JSON.stringify({
                socketId: window.socketId,
                dir,
                name
            }),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }

        });
        const json = await content.json();
        return json.content;
    },

    writeFile: async function({dir, name, content}) {
        await fetch(`/api/upload-file`, {
            body: JSON.stringify({
                socketId: window.socketId,
                dir,
                content,
                name
            }),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });
    }
}

const localBackend = {
    type: 'local',
    readFile: async function({dir, name}) {
        const dirHandle = dir ? await webFolder.getDirectoryHandle(dir) : webFolder;
        const handle = await dirHandle.getFileHandle(name);
        const fileObj = await handle.getFile();
        const landscapeYmlContent = await fileObj.text();
        return landscapeYmlContent;
    },
    writeFile: async function({dir, name, content}) {
        const dirHandle = dir ? await webFolder.getDirectoryHandle(dir) : webFolder;
        const handle = await dirHandle.getFileHandle(name, { create: true });
	const stream = await handle.createWritable();
	await stream.write(content);
	await stream.close();
    }
}
window.activeBackend = null;



function yaml2json(content) {
    var dump = jsyaml.dump(content, {lineWidth: 160});
    dump = dump.replace(/(- \w+:) null/g, '$1');
    dump = dump.replace(/(- \w+:) ''/g, '$1');
    dump = dump.split("\n").filter((x) => x.indexOf('!<tag:yaml.org,2002:js/undefined>') === -1).join("\n");
    return dump;
}

function editLandscapeYml(content) {
    const items = [];
    for (var category of content.landscape) {
        for (var subcategory of category.subcategories) {
	    for (var item of subcategory.items) {
	        items.push({
		    category: category.name,
		    subcategory: subcategory.name,
		    id: `${category.name}:${subcategory.name}:${item.name}`,
                    original: item,
		    ...item
		});
	    }
	}
    }
    console.info(items);
    

    const allowedKeys = [
	'name',
	'description',
	'homepage_url',
	'project',
	'repo_url',
	'branch',
	'project_org',
	'url_for_bestpractices',
	'additional_repos',
	'stock_ticker',
	'logo',
	'enduser',
	'open_source',
	'twitter',
	'crunchbase',
	'allow_duplicate_repo',
	'joined',
	'extra',
	'organization',
	'unnamed_organization'
    ];

    const fields = ['category', 'subcategory', 'id', 'item', 'original', ...allowedKeys];

    const store = new Ext.data.JsonStore({
        fields: fields
    });

    store.loadData(items);

    const grid = new Ext.grid.Panel({
	region: 'center',
	store: store,
        tbar: [{
            xtype: 'button',
            text: 'Add new item',
            handler: function() {
                const selectedRecord = sm.getSelection()[0];
                const newEntry = {
                    category: selectedRecord ? selectedRecord.get('category') : '',
                    subcategory: selectedRecord ? selectedRecord.get('subcategory') : ''
                }
                const record = store.add(newEntry);
                sm.select(record);
            }
        }, '-', {
            xtype: 'button',
            text: 'Delete item',
            handler: function() {
                const record = sm.getSelection()[0];
                if (record) {
                    record.store.remove(record);
                }
            }
        }],
	columns: [{
	    text: 'Category',
	    dataIndex: 'category',
	    width: 150
	}, {
	    text: 'Subcategory',
	    dataIndex: 'subcategory',
	    width: 150
	}, {
	    text: 'Name',
	    dataIndex: 'name',
	    width: 150
	}, {
	    text: 'Crunchbase',
	    dataIndex: 'crunchbase',
	    renderer: (x) => x.replace('https://www.crunchbase.com/organization/', ''),
	    width: 150
	}]
    });

    const onUpdateEntry = async function() {
       const item = sm.getSelection()[0];
       if (!item) {
           return;
       }
       const assign = function(name) {
	   var value = editor.down(`[name=${name}]`).getValue();
	   if (value === "null") {
              value = null;
	   }
	   item.set(name, value);
       }
       assign('category');
       assign('subcategory');
       assign('name');
       assign('homepage_url');
       assign('logo');
       assign('twitter');
       assign('crunchbase');
       assign('repo_url');
       assign('project_org');
       assign('additional_repos');
       assign('stock_ticker');
       assign('description');
       assign('branch');
       assign('project');
       assign('url_for_bestpractices');
       assign('enduser');
       assign('organization');
       assign('joined');
       if (editor.focusedElement) {
            editor.focusedElement.focus();
       }
    
       // update img
       const img = editor.down(`[name=logo]`).getValue();
       if (img && img !== editor.previousImg) {
           editor.previousImg = img;
           const imgEl = editor.down('[isImage]').el.dom;
           try {
                const svg = await activeBackend.readFile({dir: 'hosted_logos', name: img});
                imgEl.src= "data:image/svg+xml;base64," + btoa(svg);
           } catch(ex) {
               imgEl.src = "";
           }
       }
    }

    const editor = new Ext.Panel({
        title: 'Edit selected item',
	layout: 'form',
	width: 500,
	region: 'east',
        bodyStyle: {
            overflowY: 'auto'
        },
	defaults: {
            width: 190
	},
        items: [
            {
                xtype: 'combo',
                name: 'category',
                fieldLabel: 'Category',
                displayField: 'name',
                valueField: 'id',
                width: 120,
                store: new Ext.data.JsonStore({
                    fields: ['id', 'name'],
                    data: content.landscape.map( (x) => ({ id: x.name, name: x.name }))
                }),
                editable: false,
                value: 'all',
                queryMode: 'local',
                selectOnFocus: false,
                triggerAction: 'all',
                autoSelect: true,
                forceSelection: true
            }, {
                xtype: 'combo',
                name: 'subcategory',
                fieldLabel: 'Subcategory',
                displayField: 'name',
                valueField: 'id',
                width: 120,
                store: new Ext.data.JsonStore({
                    fields: ['id', 'name'],
                    data: []
                }),
                editable: false,
                value: 'all',
                queryMode: 'local',
                selectOnFocus: false,
                triggerAction: 'all',
                autoSelect: true,
                forceSelection: true
            }, {
                xtype: 'textfield',
                name: 'name',
            fieldLabel: 'Name:',
            description: 'A name of the item, should be unique'
	}, {
	    xtype: 'textfield',
	    name: 'logo',
	    fieldLabel: 'Logo:',
	    qtip: 'Logo',
	    description: 'A path to an svg file inside a host_logos folder'
        }, {
            xtype: 'container',
            id: 'preview',
            height: 60,
            layout: { type: 'absolute' },
            items: [{
                xtype: 'box',
                width: 180,
                height: 60,
                x: 105,
                y: 0,
                isImage: true,
                autoEl: {
                    tag: 'img',
                    styles: { border: '1px solid green' }
                }
            }, {
                x: 295,
                y: 0,
                xtype: 'box',
                width: 100,
                height: 60,
                isUpload: true,
                autoEl: {
                    tag: 'input',
                    accept: '*.svg',
                    type: 'file',
                    value: 'Choose a file to upload...'
                }
            }]
        }, {
	    xtype: 'textfield',
	    name: 'homepage_url',
	    fieldLabel: 'Homepage url:',
	    description: 'A full link to the homepage'
	}, {
	    xtype: 'textfield',
	    name: 'twitter',
	    fieldLabel: 'Twitter',
	    description: 'Link to a working twitter. Should contain at least one tweet'
	}, {
	    xtype: 'textfield',
	    name: 'crunchbase',
	    fieldLabel: 'Crunchbase',
	    description: 'A full url to the crunchbase entry. Allows to fetch additional information about the organization responsible for the entry'
	}, {
	    xtype: 'textfield',
	    name: 'repo_url',
	    fieldLabel: 'Github repo url',
	    description: 'A full url to the github repository'
	}, {
	    xtype: 'textfield',
	    name: 'project_org',
	    fieldLabel: 'project_org',
	    description: 'When a project belongs to multiple repositories, please provide this field'
	}, {
	    xtype: 'textfield',
	    name: 'additional_repos',
	    fieldLabel: 'Additional repos',
	    description: 'Extra repositories to calculate stars and other statistic'
	}, {
	    xtype: 'textfield',
	    name: 'stock_ticker',
	    fieldLabel: 'Stock ticker',
	    description: 'Allows to overrid a stock ticker when a stock ticker from a crunchbase is not correct'
	}, {
	    xtype: 'textarea',
	    name: 'description',
	    fieldLabel: 'Description',
	    description: 'Provide a description to the filed here, if the one from the crunchbase is not good enough'
	}, {
	    xtype: 'textfield',
	    name: 'branch',
	    fieldLabel: 'branch',
	    description: 'A branch on a github when a default one is not suitable'
	}, {
	    xtype: 'textfield',
	    name: 'project',
	    fieldLabel: 'project',
	    description: 'Which internal project this entry belongs to'
	}, {
	    xtype: 'textfield',
	    name: 'url_for_bestpractices',
	    fieldLabel: 'url_for_bestpractices',
	    description: 'When a project follows best practices, please provide an url here.'
	}, {
	    xtype: 'textfield',
	    name:  'enduser',
	    fieldLabel: 'enduser'
	}, {
	    xtype: 'checkbox',
	    name: 'open_source',
	    boxLabel: 'open_source'
	}, {
	    xtype: 'checkbox',
	    name: 'allow_duplicate_repo',
	    boxLabel: 'allow_duplicate_repo'
	}, {
	    xtype: 'checkbox',
	    name: 'unnamed_organization',
	    boxLabel: 'unnamed_organization'
	}, {
	    xtype: 'textfield',
	    name: 'organization',
	    fieldLabel: 'organization'
	}, {
	    xtype: 'textfield',
	    name: 'joined',
	    fieldLabel: 'joined'
	}, {
	    xtype: 'panel',
	    text: 'Selected Field Information',
	    width: '100%',
	    height: 100,
	    layout: 'fit',
	    items: [{ xtype: 'box' }]
	}]
    });

    editor.on('afterrender', function() {
	const fields = editor.query('[name]');
	const panel = editor.down('[xtype=panel]');
	for (var item of fields) {
	    const updateDescription = function(item) {
	        panel.setTitle('Info: ' + item.name);
		panel.down('[xtype=box]').update(item.description || 'No description')
	    }
	    item.on('focus', updateDescription);
            item.on('focus', (cmp) => editor.focusedElement = cmp );
	    item.on('mouseover', updateDescription);
	}
        editor.down('[name=category]').on('change', function() {
            updateSubcategoryList();
        });
        editor.timeoutId = setInterval(onUpdateEntry, 500);

        editor.down('[isUpload]').el.on('change', function(e, dom) {
            const fileInfo = dom.files[0];
            if (fileInfo) {
                let fileReader = new FileReader();
                fileReader.onload = async function(event) {
                    const content = fileReader.result;
                    const fileName = editor.down(`[name=logo]`).getValue();
                    await activeBackend.writeFile({dir: 'hosted_logos', name: fileName, content: content });
                    editor.previousImg = -1; // to trigger the redraw
                    dom.value = '';
                };
                fileReader.readAsText(fileInfo);
            }
        });

    });
    editor.on('destroy', function() { clearTimeout(editor.timeoutId) });

    const sm = grid.getSelectionModel();

    async function saveChanges() {
        const rows = store.getRange();
	const newContent = { landscape: [] };
	const categories = {};
	const subcategories = {};

	for (var record of rows) {
	    const categoryKey = record.get('category');
	    if (!categories[categoryKey]) {
	        categories[categoryKey] = {
		    category: '',
		    name: categoryKey,
		    subcategories: []
		}
		newContent.landscape.push(categories[categoryKey]);
	    }
	    const subcategoryKey = `${record.get('category')}:${record.get('subcategory')}`;
	    if (!subcategories[subcategoryKey]) {
	        subcategories[subcategoryKey] = {
		    subcategory: '',
		    name: record.get('subcategory'),
		    items: []
		}
		categories[categoryKey].subcategories.push(subcategories[subcategoryKey]);
	    }

	    const item = record.get('original') || {
	        item: ''
	    };

	    for (var key of allowedKeys) {
		const value = record.get(key);
		if (value !== '') {
		    item[key] = value;
		} else {
		    delete item[key];
		}
	    }

	    subcategories[subcategoryKey].items.push(item);

	}

	const yml = yaml2json(newContent);
        await activeBackend.writeFile({name: 'landscape.yml', content: yml});

	wnd.close();
    }

    const bottom = new Ext.Panel({
        layout: 'absolute',
	height: 50,
	region: 'south',
	items: [{
	    xtype: 'button',
	    scale: 'medium',
	    text: 'Save settings.yml',
	    x: 5,
	    y: 5,
	    handler: saveChanges
	}, {
	    xtype: 'button',
	    text: 'Cancel',
	    x: 1005,
	    y: 5,
	    handler: function() {
                wnd.close();
	    }
	}]
    });

    const wnd = new Ext.Window({
        title: 'landscape.yml online editor',
	layout: 'border',
	items: [grid, editor, bottom],
	width: 1124,
	height: 818
    });
    wnd.show();

    sm.on('selectionchange', function() {
	checkSelection();
    });
    checkSelection();

    function updateSubcategoryList() {
        const category = editor.down('[name=category]').getValue();
        const categoryEntry = content.landscape.filter( (x) => x.name === category)[0];
        let list = [];
        if (categoryEntry) {
            list = categoryEntry.subcategories.map( (x) => ({ id: x.name, name: x.name }));
        }
        editor.down('[name=subcategory]').store.loadData(list);
    }

    function checkSelection() {
        const item = sm.getSelection()[0];
	if (!item) {
	  editor.mask();
	} else {
            const data = item.data;
	    editor.unmask();
	    const assign = function(name) {
		let value = item.get(name);
		if (value === null) {
		    value = "null";
		}
		editor.down(`[name=${name}]`).setValue(value);
	    }
            assign('category');
            updateSubcategoryList();
            assign('subcategory');
	    assign('name');
	    assign('homepage_url');
	    assign('logo');
	    assign('twitter');
	    assign('crunchbase');
	    assign('repo_url');
	    assign('project_org');
	    assign('additional_repos');
	    assign('stock_ticker');
	    assign('description');
	    assign('branch');
	    assign('project');
	    assign('url_for_bestpractices');
	    assign('enduser');
	    assign('open_source');
	    assign('allow_duplicate_repo');
	    assign('unnamed_organization');
	    assign('organization');
	    assign('joined');
	}
    }

}

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

    await Promise.all(landscapeFolders.map(async folder => {
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
    }));
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

function showGithubSelector() {

    function generateBranchName() {
        return new Date().toISOString().substring(0, 16).replace(':','-');
    }


    const form = new Ext.Container({
        layout: 'form',
        items: [{
            xtype: 'combo',
            name: 'repo',
            fieldLabel: 'Repository',
            displayField: 'name',
            valueField: 'id',
            width: 120,
            store: new Ext.data.JsonStore({
                fields: ['id', 'name'],
                data: ['cncf/landscape'].map( (x) => ({id: x, name: x}))
            }),
            editable: false,
            value: 'cncf/landscape',
            queryMode: 'local',
            selectOnFocus: false,
            triggerAction: 'all',
            autoSelect: true,
            forceSelection: true
        }, {
            xtype: 'textfield',
            name: 'branch',
            fieldLabel: 'Branch',
            value: window.localStorage.getItem('branch') || generateBranchName()
        }, {
            name: 'change',
            xtype: 'button',
            width: 120,
            text: 'Change branch name'
        }, {
            xtype: 'box',
            height: 20
        }, {
            name: 'connect',
            xtype: 'button',
            scale: 'large',
            text: 'CONNECT'
        }]
    })

    const wnd = new Ext.Window({
        modal: true,
        width: 300,
        height: 200,
        title: 'Choose a github repo and a branch name',
        items: [form]
    });
    wnd.show();

    wnd.down('[name=change]').on('click', function() {
        wnd.down('[name=branch]').setValue(generateBranchName());
        window.localStorage.setItem('branch', wnd.down('[name=branch]').getValue());
    });

    wnd.down('[name=branch]').on('change', function() {
        window.localStorage.setItem('branch', wnd.down('[name=branch]').getValue());
    });

    wnd.down('[name=connect]').on('click', async function() {
        const repo = wnd.down('[name=repo]').getValue();
        const branch = wnd.down('[name=branch]').getValue();
        window.localStorage.setItem('branch', branch);

        await fetch('api/connect', {
            body: JSON.stringify({
                socketId: window.socketId,
                repo,
                branch
            }),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });

        window.activeBackend = remoteBackend;
        wnd.close();
    });

}


function init() {
    Ext.QuickTips.enable();
    const tmpDiv = document.createElement('div');
    document.body.appendChild(tmpDiv);
    tmpDiv.outerHTML = `
        <div id="main" style="height: 100%;">
            <div style="height: 40px; background: #ddd;">
                <span style="font-size: 24px;"><b>yarn fecth demo</b></span>
                <input id="dir" type="button" value="1a. Select folder with a landscape"></input>
                <span>or</span>
                <input id="github" type="button" value="1b. Select a github repository"></input>
                <input id="run" type="button" value="2. Run yarn fetch"></input>
                <input id="server" type="button" value="3. Run yarn dev"></input>
                <input id="landscapeyml" type="button" value="Edit landscape.yml"></input>
                <span id="overlay-wrapper"><input id="overlay" type="checkbox" checked></input><label for="overlay">Show Overlay</label></span>
                <a href="/landscape" target="_blank">View Landscape</a>
                <div id="status" style="display: inline-block; font-weight: bold;"></div>
            </div>
            <div style="height: calc(100% - 60px); position: relative;">
                <div class="output" id="output-fetch" style="position: absolute; z-index: 100; width: 30%; height: 60%; left: 0; top: 10%">
                  <div class="switch">+</div>
                  <div><b>yarn fetch</b> output</div>
                </div>
                <div class="output" id="output-dev" style="position: absolute; z-index: 100; width: 30%; height: 60%; left: 70%; top: 10%;">
                  <div class="switch">+</div>
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
            if (data.target === 'fetch') {
                statusDiv.innerText = `Fetching data`;
            }
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
    const landscapeYmlButton = mainDiv.querySelector('#landscapeyml');
    const dirButton = mainDiv.querySelector('#dir');
    const githubButton = mainDiv.querySelector('#github');

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
        // overlayWrapper.querySelector('input').checked = true;
        // updateOverlayVisibility();
        outputFetchDiv.classList.remove('collapsed');
    });

    function listenForFileChanges() {
        const fn = async function() {
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
            setTimeout(fn, 1000);
        };
        if (!window.changesTimerSet) {
            window.changesTimerSet = true;
            fn();
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
        // outputFetchDiv.classList.add('overlay');
        // outputDevDiv.classList.add('overlay');
        outputDevDiv.classList.remove('collapsed');
    });

    landscapeYmlButton.addEventListener('click', async function() {
        const landscapeYmlContent = await activeBackend.readFile({name: 'landscape.yml'});
	const content = jsyaml.load(landscapeYmlContent);
	console.info(content);

	editLandscapeYml(content);

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
        window.activeBackend = localBackend;
        enableButtons();
    });

    githubButton.addEventListener('click', showGithubSelector);

    outputDevDiv.querySelector('.switch').addEventListener('click', function() {
        outputDevDiv.classList.toggle('collapsed');
    });
    outputFetchDiv.querySelector('.switch').addEventListener('click', function() {
        outputFetchDiv.classList.toggle('collapsed');
    });
}

window.addEventListener('DOMContentLoaded', init);
window.getChangedFiles = getChangedFiles;
window.collectAllFiles = collectAllFiles;
