// a remote backend is used when we checkout a branch on a server
const isChrome = !!navigator.userAgent.match(/Chrome\/(\S+)/);
const remoteBackend = {
    type: 'remote',
    getDescription: () => `${remoteBackend.repo}#${remoteBackend.branch}`,
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
    getDescription: () => `local folder`,
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
    dump = dump.replace(/(  \w+:) originally-empty-null/g, '$1');
    dump = dump.split("\n").filter((x) => x.indexOf('!<tag:yaml.org,2002:js/undefined>') === -1).join("\n");
    return dump;
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

function getGithubSelector() {

    function generateBranchName() {
        return new Date().toISOString().substring(0, 16).replace(':','-');
    }

    const landscapes = `
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


    const defaultRepo = window.localStorage.getItem('repo') || 'cncf/landscape';


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
                data: landscapes.map( (x) => ({id: x, name: x}))
            }),
            editable: false,
            value: defaultRepo,
            queryMode: 'local',
            selectOnFocus: false,
            triggerAction: 'all',
            autoSelect: true,
            forceSelection: true
        }, {
            xtype: 'textfield',
            name: 'branch',
            fieldLabel: 'Branch',
            value: window.localStorage.getItem(`branch-${defaultRepo}`) || generateBranchName()
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

    form.down('[name=change]').on('click', function() {
        form.down('[name=branch]').setValue(generateBranchName());
        const repo = from.down('[name=repo]').getValue();
        window.localStorage.setItem(`branch-${repo}`, form.down('[name=branch]').getValue());

    });

    form.down('[name=repo]').on('change', function() {
        const repo = form.down('[name=repo]').getValue();
        window.localStorage.setItem('repo', repo);

        form.down('[name=branch]').setValue(window.localStorage.getItem(`branch-${repo}`) || generateBranchName())

    });

    form.down('[name=branch]').on('change', function() {
        const repo = form.down('[name=repo]').getValue();
        window.localStorage.setItem(`branch-${repo}`, form.down('[name=branch]').getValue());
    });

    form.down('[name=connect]').on('click', async function() {
        const repo = form.down('[name=repo]').getValue();
        const branch = form.down('[name=branch]').getValue();
        window.localStorage.setItem('repo', repo);
        window.localStorage.setItem(`branch-${repo}`, branch);

        form.fireEvent('connect');
    });
    return form;
}


function attachWebsocket() {
    const ws = new WebSocket(window.location.href.replace('http', 'ws'));
    ws.onmessage = async function(event) {
        const data = JSON.parse(event.data);
        if (data.type === 'id') {
            window.socketId = data.id;
            console.info(`Socket: ${data.id}`);
        }
        if (data.type === 'message') {
            Ext.globalEvents.fireEvent('message', {
                target: data.target,
                text: data.text
            });
        }
        if (data.type === 'finish') {
            Ext.globalEvents.fireEvent('finish');
        }
        if( data.type === 'files') {
            Ext.globalEvents.fireEvent('filesstarted', data.files.length);
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
            Ext.globalEvents.fireEvent('filesfinished', data.files.length);
            window.allFiles = await collectAllFiles();
        }
    };
}

function getInitialForm() {
    const githubSelector = getGithubSelector();
    const initialForm = Ext.ComponentMgr.create({
        height: 800,
        xtype: 'panel',
        title: 'Online landscape editor',
        bodyPadding: 10,
        items: [{
            xtype: 'box',
            listeners: {
                render: function() {
                    this.update(`
                            <img src="images/cncf-color.svg">
                            <h1> Welcome to CNCF online landscape editor. </h1>

                            <p>
                            This interactive landscape editor allows you connect to the existing landscape, either to the github repository or your local landscape folder, and add, edit or delete entries on the fly.
                            </p>

                            <p>
                            You may also fetch data from external services, such as crunchbase or github or bestpractices.
                            </p>

                            <p>
                            The most interesting feature is an ability to preview the results in real time.
                            </p>

                            <h1>Please choose how do you want to connect to an interactive landscape</h1>
                        `);
                }
            }
        }, {
            xtype: 'box',
            height: 20
        }, {
            xtype: 'container',
            width: 600,
            layout: {
                type: 'absolute',
            },
            height: 320,
            items: [{
                itemId: 'githubPanel',
                bodyPadding: 10,
                xtype: 'panel',
                title: 'Connect to the github',
                layout: 'fit',
                items: [githubSelector],
                width: 400,
                height: 300,
                x: 0,
                y: 0
            }, {
                x: 440,
                y: 120,
                xtype: 'box',
                autoEl: {
                    style: {
                        fontSize: '48px'
                    },
                    cn: 'OR'
                }
            }, {
                itemId: 'localPanel',
                xtype: 'panel',
                x: 550,
                y: 0,
                width: 400,
                height: 300,
                title: 'Connect to a local folder',
                layout: 'absolute',
                items: [{
                    x: 50,
                    y: 120,
                    width: 300,
                    xtype: 'button',
                    scale: 'large',
                    text: 'Connect to your local folder',
                    hidden: !isChrome
                } , {
                    x: 5,
                    y: 20,
                    xtype: 'box',
                    autoEl: {
                        style: { color: 'red', fontSize: 16 },
                        cn: 'Chrome browser version 87 or later is required to work with your local folder'
                    },
                    hidden: isChrome
                }]
            }]
        }, {
            xtype: 'progressbar',
            itemId: 'progress',
            height: 20
        }, {
            xtype: 'box',
            height: 5
        }, {
            xtype: 'component',
            height: 150,
            itemId: 'terminal',
            cls: 'output',
            style: {
                overflowY: 'auto'
            }
        }]


    });

    githubSelector.on('connect', async function() {
        initialForm.down('#githubPanel').disable();
        initialForm.down('#localPanel').disable();
        initialForm.down('#terminal').show();
        initialForm.down('#progress').show();
        initialForm.down('#progress').wait();

        const repo = githubSelector.down('[name=repo]').getValue();
        const branch = githubSelector.down('[name=branch]').getValue();

        try {
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
        } catch(ex) {
            initialForm.down('#progress').hide();
            initialForm.down('#githubPanel').enable();
            initialForm.down('#localPanel').enable();
            return;
        }
        initialForm.down('#progress').hide();
        window.activeBackend = remoteBackend;
        window.activeBackend.repo = repo;
        window.activeBackend.branch = branch;

        openMainApp();

    });
    initialForm.down('#terminal').hide();
    initialForm.down('#progress').hide();
    Ext.globalEvents.on('message', function(data) {
        if (data.target === 'connect') {
            const textEl = document.createElement('span');
            textEl.innerText = data.text;
            initialForm.down('#terminal').el.dom.appendChild(textEl);
        }
    });
    initialForm.down('#localPanel button').on('click', async function() {
        window.webFolder = await window.showDirectoryPicker();
        const permission = await webFolder.requestPermission({mode: 'readwrite'});
        if (permission !== 'granted') {
            console.info('Permission to the folder was not provided');
        }
        window.activeBackend = localBackend;
        openMainApp();
    });
    return initialForm;

}

async function getLandscapeYmlEditor() {
    const landscapeYmlContent = await activeBackend.readFile({name: 'landscape.yml'});
    const content = jsyaml.load(landscapeYmlContent);
    const items = [];
    const matchItem = /\s{8}- item:/gim;
    let prevMatch = matchItem.exec(landscapeYmlContent);
    for (var category of content.landscape) {
        for (var subcategory of category.subcategories) {
            for (var item of subcategory.items) {
                const currentMatch = matchItem.exec(landscapeYmlContent) || { index: 100000000};
                const originStr = landscapeYmlContent.substring(prevMatch.index, currentMatch.index);
                prevMatch = currentMatch;
                items.push({
                    category: category.name,
                    subcategory: subcategory.name,
                    id: `${category.name}:${subcategory.name}:${item.name}`,
                    original: item,
                    source: originStr,
                    ...item
                });
            }
        }
    }

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

    const fields = ['category', 'subcategory', 'id', 'item', 'original', 'source', ...allowedKeys];

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
            sortable: false,
            text: 'Category',
            dataIndex: 'category',
            width: 150
        }, {
            sortable: false,
            text: 'Subcategory',
            dataIndex: 'subcategory',
            width: 150
        }, {
            sortable: false,
            text: 'Name',
            dataIndex: 'name',
            width: 150
        }, {
            sortable: false,
            text: 'Crunchbase',
            dataIndex: 'crunchbase',
            renderer: (x) => x.replace('https://www.crunchbase.com/organization/', ''),
            width: 150
        }]
    });

    const updateLogo = async function() {
        const img = editor.down(`[name=logo]`).getValue();
        if (img !== editor.previousImg) {
            editor.previousImg = img;
            const imgEl = editor.down('[isImage]').el.dom;
            // imgEl.src = "data:image/svg+xml;base64," + btoa('<svg></svg>');
            if (img) {
                try {
                    const svg = await activeBackend.readFile({dir: 'hosted_logos', name: img});
                    imgEl.src= "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
                } catch(ex) {
                    imgEl.src = "";
                }
            } else {
                imgEl.src = "data:image/svg+xml;base64," + btoa('<svg></svg>');
            }
        }
    }
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
            const oldFocusRow = grid.view.focusRow;
            grid.view.focusRow = () => {};
            item.set(name, value);
            grid.view.focusRow = oldFocusRow;
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
        assign('open_source');
        assign('allow_duplicate_repo');
        assign('unnamed_organization');
        assign('organization');
        assign('joined');
        assign('extra');

        // if (editor.focusedElement) {
            // editor.focusedElement.focus();
        // }

        updateLogo();
        editor.doLayout();

        // update img
    }

    const descriptionPanel = new Ext.Panel({
        bodyPadding: 10,
        region: 'south',
        text: 'Selected Field Information',
        width: '100%',
        height: 100,
        layout: 'fit',
        items: [{ xtype: 'box' }]
    });

    const editor = new Ext.Panel({
        title: 'Edit selected item',
        layout: 'form',
        bodyPadding: 10,
        width: 500,
        flex: 1,
        region: 'center',
        bodyStyle: {
            overflowY: 'auto'
        },
        defaults: {
            width: 190,
            margins: '10 0'
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
                xtype: 'container',
                layout: 'absolute',
                height: 15,
                items: [{
                    x: 110,
                    y: 4,
                    xtype: 'box',
                    cls: 'x-form-item-label',
                    html: `<i>https://twitter.com/</i>`
                }]
            }, {
                xtype: 'textfield',
                name: 'twitter',
                fieldLabel: 'Twitter',
                description: 'Link to a working twitter. Should contain at least one tweet',
                setValue: function(v) {
                    const newValue = v === 'null' ? 'null' : v ? v.replace('https://twitter.com/', '') : '';
                    Ext.form.field.Text.prototype.setValue.call(this, newValue);
                },
                getValue: function() {
                    const originalValue = Ext.form.field.Text.prototype.getValue.call(this).replace('https://twitter.com/', '');
                    return originalValue === 'null' ? 'null' : originalValue  ?  `https://twitter.com/${originalValue}` : '' ;
                },
            }, {
                xtype: 'container',
                layout: 'absolute',
                height: 20,
                items: [{
                    x: 110,
                    y: 9,
                    xtype: 'box',
                    cls: 'x-form-item-label',
                    html: `<i>https://www.crunchbase.com/organization/</i>`
                }]
            }, {
                xtype: 'textfield',
                name: 'crunchbase',
                fieldLabel: 'Crunchbase',
                setValue: function(v) {
                    const newValue = v ? v.replace('https://www.crunchbase.com/organization/', '') : '';
                    Ext.form.field.Text.prototype.setValue.call(this, newValue);
                },
                getValue: function() {
                    const originalValue = Ext.form.field.Text.prototype.getValue.call(this).replace('https://www.crunchbase.com/organization/', '');
                    return originalValue ?  `https://www.crunchbase.com/organization/${originalValue}` : '' ;
                },
                description: 'A full url to the crunchbase entry. Allows to fetch additional information about the organization responsible for the entry'
            }, {
                xtype: 'container',
                layout: 'absolute',
                height: 20,
                items: [{
                    x: 110,
                    y: 9,
                    xtype: 'box',
                    cls: 'x-form-item-label',
                    html: `<i>https://github.com/</i>`
                }]
            }, {
                xtype: 'textfield',
                name: 'repo_url',
                fieldLabel: 'Github repo url',
                description: 'Github repo name, for example, <b>rails/rails</b> to read data from <b>https://github.com/rails/rails</b>',
                setValue: function(v) {
                    const newValue = v ? v.replace('https://github.com/', '') : '';
                    Ext.form.field.Text.prototype.setValue.call(this, newValue);
                },
                getValue: function() {
                    const originalValue = Ext.form.field.Text.prototype.getValue.call(this).replace('https://github.com/', '');
                    return originalValue ?  `https://github.com/${originalValue}` : '' ;
                }
            }, {
                xtype: 'container',
                layout: 'absolute',
                height: 20,
                items: [{
                    x: 110,
                    y: 9,
                    xtype: 'box',
                    cls: 'x-form-item-label',
                    html: `<i>https://github.com/</i>`
                }]
            }, {
                xtype: 'textfield',
                name: 'project_org',
                fieldLabel: 'project_org',
                description: 'Instead of repo_url, just provide a github organization, for example <b>cncf</b> to read data from <b>https://github.com/cncf</b>',
                setValue: function(v) {
                    const newValue = v ? v.replace('https://github.com/', '') : '';
                    Ext.form.field.Text.prototype.setValue.call(this, newValue);
                },
                getValue: function() {
                    const originalValue = Ext.form.field.Text.prototype.getValue.call(this).replace('https://github.com/', '');
                    return originalValue ?  `https://github.com/${originalValue}` : '' ;
                }
            }, {
                xtype: 'container',
                layout: 'absolute',
                height: 20,
                items: [{
                    x: 110,
                    y: 9,
                    xtype: 'box',
                    cls: 'x-form-item-label',
                    width: 350,
                    html: `One item per line. <i>https://github.com/</i> is added to each line`
                }]
            }, {
                xtype: 'textarea',
                grow: true,
                name: 'additional_repos',
                fieldLabel: 'Additional repos',
                description: `Extra repositories, one item per line, to calculate stars and other statistic, for example <pre>
                    cncf/landscape
                    cncf/logos</pre>`,
                setValue: function(v) {
                    const newValue = v && v.length ? v.map( (x) => x.repo_url.replace('https://github.com/', '')).join('\n') : '';
                    Ext.form.field.TextArea.prototype.setValue.call(this, newValue);
                },
                getValue: function() {
                    const originalValue = Ext.form.field.TextArea.prototype.getValue.call(this);
                    const repos = originalValue.split('\n').filter( (x) => x.trim()).map( (x) => x.trim()).filter( (x) => !!x).map( (x) => x.replace('https://github.com/', ''));
                    const result = repos.map( (repo) => ({repo_url: `https://github.com/${repo}`}));
                    return result.length > 0 ? result : '';
                }
            }, {
                xtype: 'textfield',
                name: 'stock_ticker',
                fieldLabel: 'Stock ticker',
                description: 'Allows to override a stock ticker when a stock ticker from a crunchbase is not correct'
            }, {
                xtype: 'textarea',
                grow: true,
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
                fieldLabel: 'Best practices',
                description: 'When a project follows best practices at https://bestpractices.coreinfrastructure.org/en/projects, please provide a project github url here.'
            }, {
                xtype: 'combo',
                name:  'enduser',
                fieldLabel: 'enduser',
                description: `CNCF specific field. Allows to mark a certain entry as an end user`,
                displayField: 'name',
                valueField: 'id',
                width: 120,
                store: new Ext.data.JsonStore({
                    fields: ['id', 'name'],
                    data: [{id: '', name: 'Not set'}, {id: true, name: 'true' }]
                }),
                editable: false,
                value: '',
                queryMode: 'local',
                selectOnFocus: false,
                triggerAction: 'all',
                autoSelect: true,
                forceSelection: true
            }, {
                xtype: 'combo',
                name: 'open_source',
                fieldLabel: 'open_source',
                description: `Sometimes a certain item is not considered opensource although it has a github repo. Choose <b>false</b> in this case. <b>Not set</b> means that a product is considered open source if it has a repo_url field set`,
                displayField: 'name',
                valueField: 'id',
                width: 120,
                store: new Ext.data.JsonStore({
                    fields: ['id', 'name'],
                    data: [{id: '', name: 'Not set'}, {id: false, name: 'false' }]
                }),
                editable: false,
                value: '',
                queryMode: 'local',
                selectOnFocus: false,
                triggerAction: 'all',
                autoSelect: true,
                forceSelection: true
            }, {
                xtype: 'combo',
                name: 'allow_duplicate_repo',
                fieldLabel: 'allow_duplicate_repo',
                description: `Usually two different items can not have the same repo_url. Rarely different items refer to the same github repo, in this case both should be marked as <b>true</b>`,
                displayField: 'name',
                valueField: 'id',
                width: 120,
                store: new Ext.data.JsonStore({
                    fields: ['id', 'name'],
                    data: [{id: '', name: 'Not set'}, {id: true, name: 'true' }]
                }),
                editable: false,
                value: '',
                queryMode: 'local',
                selectOnFocus: false,
                triggerAction: 'all',
                autoSelect: true,
                forceSelection: true
            }, {
                xtype: 'combo',
                name: 'unnamed_organization',
                fieldLabel: 'unnamed_organization',
                description: 'CNCF specific field to show a lack of organization. Choose <b>true</b> only in that case',
                cncfOnly: true,
                displayField: 'name',
                valueField: 'id',
                width: 120,
                store: new Ext.data.JsonStore({
                    fields: ['id', 'name'],
                    data: [{id: '', name: 'Not set'}, {id: true, name: 'true' }]
                }),
                editable: false,
                value: '',
                queryMode: 'local',
                selectOnFocus: false,
                triggerAction: 'all',
                autoSelect: true,
                forceSelection: true
            }, {
                xtype: 'textfield',
                name: 'organization',
                fieldLabel: 'organization',
                description: `If crunchbase is not provided, then this field is used to specify an organization name.`,
                setValue: function(v) {
                    this.assignedValue = v;
                    const newValue = v ? v.name : '';
                    Ext.form.field.Text.prototype.setValue.call(this, newValue);
                },
                getValue: function() {
                    const originalValue = Ext.form.field.Text.prototype.getValue.call(this);
                    return originalValue ? { ...this.assignedValue, name: originalValue } : '' ;
                },
            }, {
                xtype: 'textfield',
                name: 'joined',
                fieldLabel: 'joined',
                cncfOnly: true,
                description: `Provide a date in yyyy-mm-dd format when this organization joined the CNCF`
            }, {
                xtype: 'box',
                html: `<div><label class="x-form-item-label x-form-item-label-left">Extra:</label></div>`
            }, {
                xtype: 'textarea',
                grow: true,
                name: 'extra',
                description: `
                   extra fields can be added, please use this format: <pre>
                       my_field_name: asdf
                       my_other_field: test-it-now </pre> each non empty line is expected to be split by first <b>:</b>
                `,
                setValue: function(v) {
                    if (!v || v.length === 0) {
                        Ext.form.field.TextArea.prototype.setValue.call(this, '')
                    } else {
                        const lines = Object.keys(v).map(function(key) {
                            const value = v[key];
                            return `${key}: ${value}`;
                        }).join('\n');
                        Ext.form.field.TextArea.prototype.setValue.call(this, lines);
                    }
                },
                getValue: function() {
                    const v = Ext.form.field.TextArea.prototype.getValue.call(this);
                    const result = {};
                    const lines = v.split('\n').filter( (x) => x.trim());
                    for (let line of lines) {
                        const colonIndex = line.indexOf(':');
                        const key = line.substring(0, colonIndex);
                        const value =  line.substring(colonIndex + 1).trim();
                        result[key] = value;
                    }
                    return lines.length > 0 ? result : ''
                }
            }]
    });

    editor.on('afterrender', function() {
        const fields = editor.query('[name]');
        for (var item of fields) {
            const updateDescription = function(item) {
                descriptionPanel.setTitle('Info: ' + item.name);
                descriptionPanel.down('[xtype=box]').update(item.description || 'No description')
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
                    if (!fileName) {
                        Ext.Msg.alert('Error', 'Please fill in the <b>Logo:</b> field first with a name of the file');
                        editor.previousImg = -1; // to trigger the redraw
                        dom.value = '';
                    } else {
                        await activeBackend.writeFile({dir: 'hosted_logos', name: fileName, content: content });
                        editor.previousImg = -1; // to trigger the redraw
                        dom.value = '';
                    }
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
            const source = record.get('source') || '';

            for (var key of allowedKeys) {
                const value = record.get(key);
                if (value !== '') {
                    item[key] = value;
                    if (source.includes(`            ${key}:\n`) && value === null) {
                        item[key] = 'originally-empty-null';
                    }
                } else {
                    delete item[key];
                }
            }

            subcategories[subcategoryKey].items.push(item);

        }

        const yml = yaml2json(newContent);
        Ext.Msg.wait('Saving landscape.yml');
        await activeBackend.writeFile({name: 'landscape.yml', content: yml});
        Ext.Msg.hide();

        //wnd.close();
    }

    const bottom = new Ext.Panel({
        layout: {type: 'hbox', align: 'center'},
        height: 50,
        region: 'south',
        items: [{
            margins: 10,
            xtype: 'button',
            scale: 'medium',
            text: 'Save landscape.yml',
            handler: saveChanges
        }, {
            xtype: 'box',
            flex: 1
        }, {
            margins: 10,
            xtype: 'button',
            text: 'Reload',
            handler: function() {
                //wnd.close();
            }
        }]
    });

    const mainContainer = new Ext.Container({
        layout: 'border',
        title: 'Edit landscape.yml',
        items: [grid, {
            region: 'east',
            xtype: 'panel',
            width: 500,
            layout: {
                type: 'vbox',
                align: 'stretch'
            },
            items: [editor, descriptionPanel]
                // editor,
                // descriptionPanel]
        }, bottom],
        width: 1124,
        height: 818
    });

    sm.on('selectionchange', function() {
        checkSelection();
    });
    mainContainer.on('afterrender', () => checkSelection(), this, { delay: 1});

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
            assign('extra');
            updateLogo();
        }
        editor.doLayout();
    }

    return mainContainer;
}

function getYarnFetchPanel() {
    const panel = new Ext.Panel({
        bodyPadding: 10,
        title: 'Fetch external data',
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
            xtype: 'box',
            autoEl: {
                cn: `Click 'Fetch' to get external data. The output is added to logs. Usually it takes 30 seconds`
            }
        }, {
            xtype: 'container',
            layout: {
                type: 'vbox',
                align: 'center'
            },
            height: 70,
            items: [{
                itemId: 'fetch',
                height: 50,
                width: 300,
                xtype: 'button',
                scale: 'large',
                text: 'FETCH'
            }]
        }, {
            xtype: 'box',
            itemId: 'terminal',
            flex: 1,
            cls: 'output'
        }]
    });

    const button = panel.down('#fetch');
    const addMessage = function(text) {
        const textEl = document.createElement('span');
        textEl.innerText = text + '\n';
        panel.down('#terminal').el.dom.appendChild(textEl);
    }

    Ext.globalEvents.on('message', function(data) {
        if (data.target === 'fetch') {
            const textEl = document.createElement('span');
            textEl.innerText = data.text;
            panel.down('#terminal').el.dom.appendChild(textEl);
        }
    });

    Ext.globalEvents.on('finish', function() {
        addMessage('Finished fetching data');
        button.enable();
        button.setText('FETCH');
    });

    Ext.globalEvents.on('filesstarted', function(count) {
        addMessage(`${count} files changed. Receiving content`);
    });
    Ext.globalEvents.on('filesfinished', function(count) {
        addMessage(`All ${count} local files have been updated`);
    });

    panel.down('#fetch').on('click', async function() {
        button.disable();
        button.setText('Fecthing data, please wait ...')


        let files = null;
        if (activeBackend.type === 'local') {
            addMessage(`Collecting local files`);
            files = await collectAllFiles();
            window.allFiles = files;
            addMessage(`Uploading local files`);
        }

        await fetch('api/fetch', {
            body: JSON.stringify({ socketId: socketId, files: files ? Object.values(files) : null}),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });

        addMessage( `Fecthing data at ${new Date().toISOString().substring(0, 20)}`);
    });

    return panel;
}

function getPreviewPanel() {
    const panel = new Ext.Container({
        bodyPadding: 10,
        layout: 'border',
        items: [{
            region: 'north',
            height: 40,
            items: [{
                layout: 'absolute',
                xtype: 'container',
                items: [{
                    itemId: 'start',
                    xtype: 'button',
                    x: 20,
                    y: 5,
                    text: 'Start dev server',
                }]
            }]
        }, {
            region: 'center',
            xtype: 'box',
            itemId: 'iframe',
            autoEl: {
                tag: 'iframe',
                style: "border: 0; position: absolute; z-index: 1; width: 100%; height: 100%; left: 0; top: 0;"
            }
        }, {
            xtype: 'box',
            region: 'east',
            width: 400,
            cls: 'output',
            itemId: 'terminal'
        }]
    });

    const addMessage = function(text) {
        const textEl = document.createElement('span');
        textEl.innerText = text + '\n';
        panel.down('#terminal').el.dom.appendChild(textEl);
    }

    Ext.globalEvents.on('message', function(data) {
        if (data.target === 'server') {
            const textEl = document.createElement('span');
            textEl.innerText = data.text;
            panel.down('#terminal').el.dom.appendChild(textEl);
        }
    });

    panel.down('#start').on('click', async function() {
        panel.down('#start').disable();
        let files = null;
        if (activeBackend.type === 'local') {
            addMessage(`Collecting local files`);
            files = await collectAllFiles();
            window.allFiles = files;
            addMessage(`Uploading local files`);
        }

        await fetch('api/server', {
            body: JSON.stringify({ socketId: socketId, files: files ? Object.values(files) : null}),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });

        addMessage(`Dev server started`);

        panel.down('#start').setText('Dev server is already running');

        const iframeTag = panel.down('#iframe').el.dom;
        iframeTag.src = "/landscape";
        iframeTag.style.opacity = 1;

        if (activeBackend.type === 'local') {
            listenForFileChanges();
        }
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
                addMessage('Changes detected: uploading changes');
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
                addMessage('Changes uploaded');
            }
            setTimeout(fn, 1000);
        };
        if (!window.changesTimerSet) {
            window.changesTimerSet = true;
            fn();
        }
    }

    return panel;
}

async function getMainPanel() {
    const landscapeYmlEditor = await getLandscapeYmlEditor();
    const yarnFetchPanel = getYarnFetchPanel();
    const previewPanel = getPreviewPanel();


    const mainPanel = new Ext.Panel({
        title: 'Interactive Landscape Editor V1.0',
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
            xtype: 'container',
            layout: {
                type: 'hbox',
                align: 'stretch'
            },
            height: 30,
            items: [{
                xtype: 'box',
                autoEl: {
                    style: {
                        padding: 10,
                        fontSize: 16
                    },
                    cn: `Connected to ${activeBackend.getDescription()}`
                }
            }, {
                itemId: 'pullrequest',
                xtype: 'button',
                scale: 'medium',
                text: 'Create a Pull Request',
                handler: function() {
                    window.open(this.urlLink, '_blank').focus();
                    this.hide();
                },
                style: {
                    background: 'red'
                }
            }]
        }, {
            flex: 1,
            xtype: 'tabpanel',
            items: [{
                title: 'Edit landscape.yml',
                layout: 'fit',
                items: [ landscapeYmlEditor ]
            }, {
                title: 'Fetch data',
                layout: 'fit',
                items: [ yarnFetchPanel ]
            }, {
                title: 'Preview in real time',
                layout: 'fit',
                items: [ previewPanel]
            }]
        }]
    });

    mainPanel.down('#pullrequest').hide();

    Ext.globalEvents.on('message', function(data) {
        const match = data.text.match(/https:\/\/github.com(.*?)\/pull\/new\/(\S+)/);
        if (match && match[0]) {
            const url = match[0];
            mainPanel.down('#pullrequest').show();
            mainPanel.down('#pullrequest').el.highlight();
            mainPanel.down('#pullrequest').urlLink = url;
        }
    });

    return mainPanel;

}

async function openMainApp() {
    const mainPanel = await getMainPanel();
    mainContainer.add(mainPanel);
    mainContainer.getLayout().setActiveItem(mainPanel);
}

function init() {
    attachWebsocket();
    Ext.QuickTips.enable();
    const initialForm = getInitialForm();
    const mainContainer = new Ext.Viewport({
        layout: 'card',
        items: [{
            layout: {
                type: 'vbox',
                align: 'center',
                pack: 'center'
            },
            xtype: 'container',
            items: [initialForm]
        }]
    });
    window.mainContainer = mainContainer;

}

window.getChangedFiles = getChangedFiles;
window.collectAllFiles = collectAllFiles;
Ext.onReady(function() {
    init();
});
