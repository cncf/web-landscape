const isChrome = !!navigator.userAgent.match(/Chrome\/(\S+)/);
const remoteBackend = {
    type: 'remote',
    getDescription: () => `${remoteBackend.repo}#${remoteBackend.branch}`,
    readFile: async function({dir, name, encoding}) {
        const content = await fetch(`/api/download-file`, {
            body: JSON.stringify({
                socketId: window.socketId,
                dir,
                name,
                encoding
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

    writeFile: async function({dir, name, content, encoding}) {
        await fetch(`/api/upload-file`, {
            body: JSON.stringify({
                socketId: window.socketId,
                dir,
                content,
                name,
                encoding
            }),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });
    },

    writePreview: async function({dir, name, content, encoding}) {
        await fetch(`/api/upload-file`, {
            body: JSON.stringify({
                socketId: window.socketId,
                dir,
                content,
                name,
                encoding,
                mode: 'preview'
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
    readFile: async function({ dir, name, encoding }) {
        const dirHandle = dir ? await webFolder.getDirectoryHandle(dir) : webFolder;
        const handle = await dirHandle.getFileHandle(name);
        const fileObj = await handle.getFile();
        const landscapeYmlContent = await fileObj.text();
        return landscapeYmlContent;
    },
    writeFile: async function({ dir, name, content, encoding }) {
        const dirHandle = dir ? await webFolder.getDirectoryHandle(dir) : webFolder;
        const handle = await dirHandle.getFileHandle(name, { create: true });
        const stream = await handle.createWritable();
        await stream.write(content);
        await stream.close();
        await remoteBackend.writePreview({dir, name, content});
    },
    writePreview: async function({dir, name, content, encoding }) {
        await remoteBackend.writePreview({dir, name, content});
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

const yesNoComboboxOptions = {
    xtype: 'combo',
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
};

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
            width: 160,
            text: 'Change branch name'
        }, {
            xtype: 'box',
            height: 20
        }, {
            name: 'connect',
            xtype: 'button',
            scale: 'large',
            text: 'CONNECT',
            width: 370,
            height: 100
        }]
    })

    form.down('[name=change]').on('click', function() {
        form.down('[name=branch]').setValue(generateBranchName());
        const repo = form.down('[name=repo]').getValue();
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
            Ext.util.Cookies.set('socketId', data.id);
            console.info(`Socket: ${data.id}`);
        }
        if (data.type === 'message') {
            Ext.globalEvents.fireEvent('message', {
                target: data.target,
                text: data.text
            });
        }

        if (data.type === 'finish') {
            Ext.globalEvents.fireEvent('finish', {
                target: data.target,
                code: data.code
            });
        }

        if (data.type === 'status') {
            Ext.globalEvents.fireEvent('status', {
                target: data.target,
                status: data.status
            });
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
        }
    };
}

function getInitialForm() {
    const githubSelector = getGithubSelector();
    const initialForm = Ext.ComponentMgr.create({
        width: 1020,
        height: 800,
        xtype: 'panel',
        title: 'Online landscape editor',
        bodyPadding: 10,
        items: [{
            xtype: 'box',
            width: 1000,
            listeners: {
                render: function() {
                    this.update(`
                            <img src="images/cncf-color.svg" style="height: 120px;">
                            <p>
                            This interactive landscape editor allows you connect to the existing landscape, either to the github repository or your local landscape folder, and add, edit or delete entries on the fly.
                            You may also fetch data from external services, such as crunchbase or github or bestpractices.
                            The most interesting feature is an ability to preview the results in real time.
                            </p>
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
                frame: true,
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
                        fontSize: '48px',
                        left: '440px',
                        top: '120px'
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
                frame: true,
                layout: 'absolute',
                items: [{
                    x: 20,
                    y: 20,
                    width: 300,
                    xtype: 'box',
                    autoEl: {
                        cn: `
                        Connect to your local folder with any landscape.
                        All changes will be applied to your local folder.
                        You'll need to give a read and write permission to it.
                        `
                    },
                    hidden: !isChrome
                }, {
                    x: 50,
                    y: 120,
                    width: 300,
                    xtype: 'button',
                    scale: 'large',
                    text: ` CONNECT `,
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

        let pr, createPr;
        try {
            const response = await fetch('api/connect', {
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
            const result = await response.json();
            pr = result.pr;
            createPr = result.createPr;
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
        window.activeBackend.pr = pr;
        window.activeBackend.createPr = createPr;

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
            Ext.Msg.alert('info', 'Please try again. We need a permission to read/write to the folder with a local checkout of a landscape');
            return;
        }
        window.activeBackend = localBackend;
        // upload files
        const files = await collectAllFiles();
        await fetch('api/upload', {
            body: JSON.stringify({ socketId, files: Object.values(files) }),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });
        openMainApp();
    });
    return initialForm;

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

async function loadYmlFiles() {
    const settingsYmlContent = await activeBackend.readFile({name: 'settings.yml'});
    const settingsContent = jsyaml.load(settingsYmlContent);
    const projects = (settingsContent.relation.values.filter( (x) => x.id === 'hosted')[0] || { children: []}).children.map(
        (x) => ({id: x.id, name: x.tag })
    );
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

    return {
        projects,
        items,
        settings: settingsContent,
        landscape: content.landscape
    }

}

function prepareLandscapeYmlFromStore(store) {
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
    return yml;
}

async function saveChanges(store) {
    const yml = prepareLandscapeYmlFromStore(store);
    Ext.Msg.wait('Saving landscape.yml');
    await activeBackend.writeFile({name: 'landscape.yml', content: yml});
    Ext.Msg.hide();
}

async function savePreview(store) {
    const yml = prepareLandscapeYmlFromStore(store);
    await activeBackend.writePreview({name: 'landscape.yml', content: yml });
}

async function saveSettingsPreview(values) {
    const yml = yaml2json(values);
    await activeBackend.writePreview({name: 'settings.yml', content: yml });
}

async function saveSettings(values) {
    const yml = yaml2json(values);
    await activeBackend.writeFile({name: 'settings.yml', content: yml });
}

function getSettingsYmlEditor() {

    const defaultEditorSettings = {
        layout: 'form',
        bodyPadding: 10,
        margin: 10,
        labelWidth: 200,
        defaults: {
            width: 190,
            margins: '10 0'
        }
    };
    const editorGlobal = new Ext.Panel({
        ...defaultEditorSettings,
        title: 'settings.yml global:',
        section: 'global',
        frame: true,
        items: [{
            xtype: 'textfield',
            fieldLabel: 'name',
            name: 'name',
            description: 'A full description'
        }, {
            xtype: 'textfield',
            fieldLabel: 'short_name',
            name: 'short_name',
            description: `

            `
        }, {
            xtype: 'textfield',
            fieldLabel: 'repo',
            name: 'repo',
            description: ` A repository name in a format like <b>cncf/landscape</b> where this repository is stored. Used for an automatic updater
            `
        }, {
            xtype: 'textfield',
            fieldLabel: 'website',
            name: 'website',
            description: ` a full url like https://landscape.cncf.io where this
            site is deployed `
        }, {
            xtype: 'textfield',
            fieldLabel: 'short_domain',
            name: 'short_domain',
            description: ` short domain `
        }, {
            xtype: 'textfield',
            fieldLabel: 'company_url',
            name: 'company_url',
            description: `
              a url to the company like https://cncf.io
            `
        }, {
            xtype: 'textfield',
            fieldLabel: 'email',
            name: 'email',
            description: ``
        }, {
            xtype: 'textfield',
            fieldLabel: 'membership',
            name: 'membership',
            description: `A category name which contains a list of members.`
        }, {
            xtype: 'textfield',
            fieldLabel: 'self',
            name: 'self',
            description: `A full link to the crunchbase company of your primary organization`
        }, {
            fieldLabel: 'skip_funding',
            name: 'skip_funding',
            description: `Set to true when you do not need a funding page. You may need this for a private repo too`,

            ...yesNoComboboxOptions
        }, {
            fieldLabel: 'skip_crunchbase',
            name: 'skip_crunchbase',
            description: `Set to true if you don't want this project to use crunchbase at all. In landscape.yml items will use <b> organization</b> field instead of the <b>crunchbase</b> field`,

            ...yesNoComboboxOptions
        }, {
            xtype: 'textfield',
            fieldLabel: 'slack_channel',
            name: 'slack_channel',
            description: `A link to a special url in the slack channel, where deploy results are logged to`
        }, {
            xtype: 'textfield',
            fieldLabel: 'meta.title',
            name: 'meta.title',
            description: `Meta tag used for a facebook and twitter. Name of a project`
        }, {
            xtype: 'textfield',
            fieldLabel: 'meta.fb_admin',
            name: 'meta.fb_admin',
            description: `Meta tag used for a facebook and twitter. Name of a fb admin`
        }, {
            xtype: 'textfield',
            fieldLabel: 'meta.description',
            name: 'meta.description',
            description: `Meta tag used for a facebook and twitter. Description of a website`
        }, {
            xtype: 'textfield',
            fieldLabel: 'meta.twitter',
            name: 'meta.twitter',
            description: `A twitter account associated with this website. Used by twitter`
        }, {
            xtype: 'textfield',
            fieldLabel: 'meta.google_site_verification',
            name: 'meta.google_site_verification',
            description: `For a google search console. When you add your website to a google search console - choose an html tag verification and update this field with a value which is shown from a google search console. This way you can proove to google that a site belongs to you.`
        }, {
            xtype: 'textfield',
            fieldLabel: 'meta.ms_validate',
            name: 'meta.ms_validate',
            description: `For a bing search engine. When you add your website to bing analytics - choose an html tag verification and update this field with a recommended value from Bing. This way you can prove to MS that a site belongs to you`
        }, {
            xtype: 'textfield',
            fieldLabel: 'flags.companies',
            name: 'flags.companies',
            description: `It is possible to mark a sertain Category as a list of companies`
        }, {
            xtype: 'textarea',
            grow: true,
            fieldLabel: 'flags.hide_license_for_categories',
            name: 'flags.hide_license_for_categories',
            description: `Please list here a list of categories, items under this categories will have their licenses hidden. One category name per line`,
            setValue: function(v) {
                const newValue = v && v.length ? v.join('\n') : '';
                Ext.form.field.TextArea.prototype.setValue.call(this, newValue);
            },
            getValue: function() {
                const originalValue = Ext.form.field.TextArea.prototype.getValue.call(this);
                const values = originalValue.split('\n').filter( (x) => x.trim()).map( (x) => x.trim()).filter( (x) => !!x).map( (x) => (x));
                const result = values;
                return result.length > 0 ? result : '';
            }
        }, {
            xtype: 'textarea',
            grow: true,
            fieldLabel: 'flags.hide_category_from_subcategories',
            name: 'flags.hide_category_from_subcategories',
            description: `a list of categories. For those categories the grouping label will be just <i>subcategory</i> while usually it is <i>category - subcategory</i>`,
            setValue: function(v) {
                const newValue = v && v.length ? v.join('\n') : '';
                Ext.form.field.TextArea.prototype.setValue.call(this, newValue);
            },
            getValue: function() {
                const originalValue = Ext.form.field.TextArea.prototype.getValue.call(this);
                const values = originalValue.split('\n').filter( (x) => x.trim()).map( (x) => x.trim()).filter( (x) => !!x).map( (x) => (x));
                const result = values;
                return result.length > 0 ? result : '';
            }
        }]
    });

    const editorTwitter = new Ext.Panel({
        title: 'settings.yml twitter:',
        section: 'twitter',
        ...defaultEditorSettings,
        frame: true,
        items: [{
            xtype: 'textfield',
            fieldLabel: 'url',
            name: 'url',
            description: 'A full description'
        }, {
            xtype: 'textfield',
            fieldLabel: 'search',
            name: 'search',
            description: 'A full description'
        }, {
            xtype: 'textfield',
            fieldLabel: 'text',
            name: 'text',
            description: 'What text would be twitted'
        }]
    });

    const editorValidator = new Ext.Panel({
        title: 'settings.yml validator:',
        section: 'validator',
        ...defaultEditorSettings,
        frame: true,
        items: [{
            xtype: 'textarea',
            fieldLabel: 'validator',
            name: '.',
            description: `A javascript code which will validate every field in the <b>extra</b> section of a landscape item. The code works with only 3 variables: <b>field</b>, <b>value</b> and <b>error</b>, for example: <pre> if(field === "my_demo_field" && value === "my_demo_value") { error = "Wrong my_demo_field ! "}  </pre>`,
        }]
    });

    const subsection = function(id) {
        const hostedDescription = `This is a section for a hosted project. Here you can specify how you name your hosted project and make children like incubated, graduated or similar ids`;
        const idNames = {
            member: 'member',
            company: 'company',
            false: 'non-member'
        };
        const normalDescription = `This is a section for a ${idNames[id]} project. Specify all the necessary property.`;
        const childrenDescription = `This is a section for a hosted project type. Specify all the necessary property. If you don't need this child just delete it`;
        const panel = new Ext.Panel({
            title: id !== null ? `id: ${id}` : null,
            memberId: id,
            frame: true,
            ignoreAssignment: true,
            margin: 5,
            layout : {
                type: 'vbox',
                align: 'stretch'
            },
            items: [{
                xtype: 'box',
                margin: 10,
                html: id === 'hosted' ? hostedDescription : id !== null ? normalDescription : childrenDescription
            }, {
                xtype: 'container',
                layout: {
                    type: 'hbox'
                },
                items: [{
                    ...defaultEditorSettings,
                    xtype: 'container',
                    layout: 'form',
                    flex: 1,
                    labelWidth: 200,
                    items: [{
                        xtype: 'textfield',
                        fieldLabel: 'id',
                        readOnly: id !== null,
                        disabled: id !== null,
                        labelWidth: 100,
                        name: 'id',
                        value: id,
                        getValue: function(x) {
                            const value = Ext.form.field.Text.prototype.getValue.apply(this, arguments);
                            return value === 'false' ? false : value;
                        }
                    }, {
                        xtype: 'textfield',
                        fieldLabel: 'label',
                        labelWidth: 100,
                        name: 'label',
                        description: 'The text which appears in the select tag'
                    }, {
                        xtype: 'textfield',
                        fieldLabel: 'url',
                        labelWidth: 100,
                        name: 'url',
                        description: 'How that value is displayed in the browser url'
                    }, {
                        xtype: 'textfield',
                        fieldLabel: 'prefix',
                        labelWidth: 100,
                        itemId: 'prefix',
                        name: 'prefix'
                    }, {
                        xtype: 'textfield',
                        fieldLabel: 'tag',
                        labelWidth: 100,
                        itemId: 'tag',
                        name: 'tag'
                    }]
                }, {
                    ...defaultEditorSettings,
                    xtype: 'container',
                    layout: 'form',
                    flex: 1,
                    labelWidth: 200,
                    items: [{
                        xtype: 'textfield',
                        fieldLabel: 'color',
                        labelWidth: 100,
                        itemId: 'color',
                        name: 'color'
                    }, {
                        xtype: 'numberfield',
                        fieldLabel: 'big_picture_order',
                        labelWidth: 100,
                        itemId: 'big_picture_order',
                        name: 'big_picture_order',
                        getValue: function() {
                            const result = Ext.form.field.Number.prototype.getValue.apply(this, arguments);
                            return result === null ? '' : result;
                        }
                    }, {
                        xtype: 'textfield',
                        fieldLabel: 'big_picture_label',
                        labelWidth: 100,
                        itemId: 'big_picture_label',
                        name: 'big_picture_label'
                    }, {
                        xtype: 'textfield',
                        fieldLabel: 'big_picture_color',
                        labelWidth: 100,
                        itemId: 'big_picture_color',
                        name: 'big_picture_color'
                    }, {
                        xtype: 'textfield',
                        fieldLabel: 'additional_relation',
                        labelWidth: 100,
                        itemId: 'additional_relation',
                        name: 'additional_relation'
                    }]
                }]
            }, {
                xtype: 'box',
                getValue: function() {
                    const subpanels = panel.items.getRange().filter( (x) => !!x.ignoreAssignment);
                    const result = subpanels.map( (x) => x.getValue());
                    if (result.length === 0) {
                        return '';
                    } else {
                        return result;
                    }
                },
                setValue: function(value) {
                    this.value = value;
                    for (var child of value) {
                        const newItem = subsection(null);
                        panel.add(newItem);
                        for (var key in child) {
                            const field = newItem.queryBy( (x) => x.name === key)[0];
                            field.setValue(child[key]);
                        }
                        panel.doLayout();
                    }
                },
                name: 'children'
            }, id === 'hosted' ? {
                xtype: 'container',
                layout : {
                    type: 'hbox',
                    align: 'stretch'
                },
                height: 40,
                items: [{
                    xtype: 'box',
                    width: 115
                }, {
                    xtype: 'button',
                    text: 'Add hosted project',
                    handler: function() {
                        panel.add(subsection(null));
                        panel.doLayout();
                    },
                    height: 20,
                    margin: '10 0'
                }]
            } : id === null ? {
                xtype: 'container',
                layout : {
                    type: 'hbox',
                    align: 'stretch'
                },
                height: 30,
                items: [{
                    xtype: 'box',
                    flex: 1
                }, {
                    xtype: 'button',
                    text: 'DELETE',
                    style: {
                        color: 'red'
                    },
                    margin: '0 10 10 0',
                    handler: function() {
                        panel.ownerCt.remove(panel);
                    },
                    height: 20
                }]


            } : { xtype: 'box'}],
            getValue: function() {
                const result = {};
                const fields = this.queryBy( (x) => !!x.name);
                for (var field of fields) {
                    const parent = field.up('[ignoreAssignment]');
                    if (parent === this) {
                        const value = field.getValue();
                        if (value !== '') {
                            result[field.name] = value;
                        }
                    }
                }
                if (Object.keys(result).length === 0) {
                    return null;
                }
                if (Object.keys(result).length === 1 && Object.keys(result)[0] === 'id') {
                    return null;
                }
                return result;
            }
        });

        return panel;
    }

    const editorRelation = new Ext.Panel({
        title: 'settings.yml relation:',
        frame: true,
        section: 'relation',
        margin: 10,
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
            ...defaultEditorSettings,
            xtype: 'container',
            items: [{
                xtype: 'textfield',
                fieldLabel: 'label',
                name: 'label',
                description: 'How do we label this relation?'
            }, {
                xtype: 'textfield',
                fieldLabel: 'url',
                name: 'url',
                description: 'How do we name this relation in the search part of the url?'
            }]
        }, {
            xtype: 'container',
            items: [subsection('hosted'), subsection('company'), subsection('member'), subsection(false)],
            name: 'values',
            setValue: function(v) {
                this.value = v;
                for (let entry of v) {
                    const form = this.queryBy( (x) => x.memberId === entry.id)[0];
                    for (let key in entry) {
                        const field = form.queryBy( (x) => x.name === key)[0];
                        field.setValue(entry[key]);
                    }
                }
            },
            getValue: function() {
                const sections = this.queryBy( (x) => Ext.isDefined(x.memberId));
                const values = sections.map(function(section) {
                    if (!section.up('[memberId]')) {
                        const value = section.getValue();
                        return value;
                    }
                }).filter( (x) => !!x);
                return values;
            }
        }]
    });

    // key, name, label, funding, enduser, crunchbase_and_children, is_large, end_user_label
    const membershipSection = function() {
        const panel = new Ext.Panel({
            isMembershipSection: true,
            frame: true,
            ignoreAssignment: true,
            margin: 5,
            layout : {
                type: 'vbox',
                align: 'stretch'
            },
            items: [{
                xtype: 'container',
                layout: {
                    type: 'hbox'
                },
                items: [{
                    ...defaultEditorSettings,
                    xtype: 'container',
                    layout: 'form',
                    flex: 1,
                    labelWidth: 200,
                    items: [{
                        xtype: 'textfield',
                        name: 'key',
                        fieldLabel: 'key',
                        description: `Which member are we describing? Should be the exact subcategory name from the Member subcategories or 'cncf' or 'linux_foundation'`
                    }, {
                        xtype: 'textfield',
                        name: 'name',
                        fieldLabel: 'name'
                    }, {
                        xtype: 'textfield',
                        name: 'label',
                        fieldLabel: 'label'
                    }, {
                        xtype: 'textfield',
                        name: 'funding',
                        fieldLabel: 'funding'
                    }]
                }, {
                    ...defaultEditorSettings,
                    xtype: 'container',
                    layout: 'form',
                    flex: 1,
                    labelWidth: 200,
                    items: [{
                        name: 'enduser',
                        fieldLabel: 'enduser',
                        description: 'This member is an enduser. CNCF specific field.',
                        ...yesNoComboboxOptions
                    }, {
                        xtype: 'textfield',
                        name: 'crunchbase_and_children',
                        fieldLabel: 'crunchbase_and_children'
                    }, {
                        name: 'is_large',
                        fieldLabel: 'is_large',
                        description: 'Show as a big icon',
                        ...yesNoComboboxOptions
                    }, {
                        xtype: 'textfield',
                        name: 'end_user_label',
                        fieldLabel: 'end_user_label'
                    }]
                }]
            }, {
                xtype: 'container',
                layout : {
                    type: 'hbox',
                    align: 'stretch'
                },
                height: 30,
                items: [{
                    xtype: 'box',
                    flex: 1
                }, {
                    xtype: 'button',
                    text: 'DELETE',
                    style: {
                        color: 'red'
                    },
                    margin: '0 10 10 0',
                    handler: function() {
                        panel.ownerCt.remove(panel);
                    },
                    height: 20
                }]


            }],
            setValue: function(v) {
                panel.value = v;
                for (var key in v) {
                    var value = v[key];
                    const item = panel.queryBy( (x) => x.name === key)[0];
                    item.setValue(value);
                }
            },
            getValue: function() {
                const value = panel.value || {};
                const fields = panel.queryBy( (x) => !!x.name);
                for (var field of fields) {
                    if (field.getValue() === '') {
                        delete value[field.name];
                    } else {
                        value[field.name] = field.getValue();
                    }
                }
                return value;
            }
        });
        return panel;
    };

    const editorMembership = new Ext.Panel({
        title: 'settings.yml membership:',
        frame: true,
        section: 'membership',
        margin: 10,
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
            xtype: 'container',
            ignoreAssignment: true,
            name: '.',
            layout : {
                type: 'hbox',
                align: 'stretch'
            },
            height: 40,
            items: [{
                xtype: 'box',
                width: 115
            }, {
                xtype: 'button',
                text: 'Add section',
                handler: function() {
                    editorMembership.add(membershipSection());
                    editorMembership.doLayout();
                },
                height: 20,
                margin: '10 0'
            }],
            getValue: function() {
                const sections = editorMembership.queryBy( (x) => !!x.isMembershipSection);
                const result = {};
                for (var section of sections) {
                    const value = section.getValue();
                    const key = value.key;
                    delete value.key;
                    result[key] = value;
                }
                return result;
            },
            setValue: function(v) {
                this.value = v;
                for (var k in v) {
                    const item = {
                        key: k,
                        ...v[k]
                    }
                    const section = membershipSection();
                    editorMembership.add(section);
                    editorMembership.doLayout();
                    section.setValue(item);
                }
            }
        }]
    });

    const editorHome = new Ext.Panel({
        title: 'settings.yml home:',
        section: 'home',
        ...defaultEditorSettings,
        frame: true,
        items: [{
            xtype: 'textarea',
            grow: true,
            height: 100,
            fieldLabel: 'header',
            name: 'header',
            description: 'An html fragment which is displayed at the top of a landscape page'
        }, {
            xtype: 'textarea',
            grow: true,
            height: 100,
            fieldLabel: 'footer',
            name: 'footer',
            description: 'An html fragment which is displayed at the bottom of a landscape page'
        }]
    });

    const adsSection = function() {
        const panel = new Ext.Panel({
            isAdsSection: true,
            ignoreAssignment: true,
            frame: true,
            margin: 5,
            items: [{
                xtype: 'container',
                ...defaultEditorSettings,
                items: [{
                    xtype: 'textfield',
                    fieldLabel: 'url',
                    name: 'url',
                    description: 'A full link to the event'
                }, {
                    xtype: 'textfield',
                    fieldLabel: 'title',
                    name: 'title',
                    description: 'An event description'
                }, {
                    xtype: 'container',
                    layout: 'absolute',
                    height: 15,
                    items: [{
                        x: 110,
                        y: 1,
                        xtype: 'box',
                        cls: 'x-form-item-label',
                        html: `<i>/images/</i>`
                    }]
                }, {
                    xtype: 'textfield',
                    fieldLabel: 'image',
                    name: 'image',
                    description: `a file name in the images/ folder, can be of any image type. Please try to keep it easy like info1.jpg, info2.jpg and so on for every new ad`,
                    setValue: function(v) {
                        v = v ? v.replace('/images/', '') : v;
                        Ext.form.field.Text.prototype.setValue.call(this, v);
                    },
                    getValue: function() {
                        let v = Ext.form.field.Text.prototype.getValue.call(this);
                        v = v.replace('/images/', '');
                        return `/images/${v}`;
                    }
                }, {
                    xtype: 'container',
                    height: 90,
                    layout: { type: 'absolute' },
                    items: [{
                        xtype: 'box',
                        height: 90,
                        x: 105,
                        y: 0,
                        isSettingsImg: true,
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
                            type: 'file',
                            value: 'Choose a file to upload...'
                        }
                    }]
                }]
            }, {
                xtype: 'container',
                layout : {
                    type: 'hbox',
                    align: 'stretch'
                },
                height: 30,
                items: [{
                    xtype: 'box',
                    flex: 1
                }, {
                    xtype: 'button',
                    text: 'DELETE',
                    style: {
                        color: 'red'
                    },
                    margin: '0 10 10 0',
                    handler: function() {
                        panel.ownerCt.remove(panel);
                    },
                    height: 20
                }]
            }],
            setValue: function(v) {
                panel.value = v;
                for (var key in v) {
                    var value = v[key];
                    const item = panel.queryBy( (x) => x.name === key)[0];
                    item.setValue(value);
                }
            },
            getValue: function() {
                const value = panel.value || {};
                const fields = panel.queryBy( (x) => !!x.name);
                for (var field of fields) {
                    if (field.getValue() === '') {
                        delete value[field.name];
                    } else {
                        value[field.name] = field.getValue();
                    }
                }
                return value;
            }
        });

        panel.on('afterrender', function() {

            const updateLogo = async function() {
                const img = panel.down(`[name=image]`).getValue();
                if (img !== panel.previousImg) {
                    panel.previousImg = img;
                    const imgEl = panel.down('[isSettingsImg]').el.dom;
                    // imgEl.src = "data:image/svg+xml;base64," + btoa('<svg></svg>');
                    if (img) {
                        try {
                            const imgData = await activeBackend.readFile({encoding: 'base64', dir: 'images', name: img.split('/images/')[1]});
                            imgEl.src= "data:image;base64," + imgData;
                        } catch(ex) {
                            imgEl.src = "";
                        }
                    } else {
                        imgEl.src = "data:image/svg+xml;base64," + btoa('<svg></svg>');
                    }
                }
            }

            panel.down('[isUpload]').el.on('change', function(e, dom) {
                const fileInfo = dom.files[0];
                if (fileInfo) {
                    let fileReader = new FileReader();
                    fileReader.onload = async function(event) {
                        const content = fileReader.result.split('base64,')[1];
                        const fileName = panel.down(`[name=image]`).getValue().replace('/images/', '');
                        panel.previousImg = -1; // to trigger the redraw
                        dom.value = '';
                        if (!fileName) {
                            Ext.Msg.alert('Error', 'Please fill in the <b>image</b> field first with a name of the file');
                        } else {
                            await activeBackend.writeFile({dir: 'images', name: fileName, content: content, encoding: 'base64' });
                        }
                    };
                    fileReader.readAsDataURL(fileInfo);
                }
            });

            setInterval(function() {
                updateLogo();

            }, 1000);

        });


        return panel;
    }

    const editorAds = new Ext.Panel({
        title: 'settings.yml ads:',
        frame: true,
        section: 'ads',
        margin: 10,
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
            xtype: 'container',
            ignoreAssignment: true,
            name: '.',
            layout : {
                type: 'hbox',
                align: 'stretch'
            },
            height: 40,
            items: [{
                xtype: 'box',
                width: 115
            }, {
                xtype: 'button',
                text: 'Add section',
                handler: function() {
                    editorAds.add(adsSection());
                    editorAds.doLayout();
                },
                height: 20,
                margin: '10 0'
            }],
            getValue: function() {
                const sections = editorAds.queryBy( (x) => !!x.isAdsSection);
                return sections.map( (section) => section.getValue() );
            },
            setValue: function(v) {
                this.value = v;
                for (var k of v) {
                    const section = adsSection();
                    editorAds.add(section);
                    editorAds.doLayout();
                    section.setValue(k);
                }
            }
        }]
    });

    const presetsSection = function() {
        const panel = new Ext.Panel({
            isSection: true,
            ignoreAssignment: true,
            frame: true,
            margin: 5,
            items: [{
                xtype: 'container',
                ...defaultEditorSettings,
                items: [{
                    xtype: 'textfield',
                    fieldLabel: 'url',
                    name: 'url',
                    description: 'A relative url with search parameters, for example, <i>/license=open-source</i>'
                }, {
                    xtype: 'textfield',
                    fieldLabel: 'label',
                    name: 'label',
                    description: 'How it is appeared in a landscape'
                }]
            }, {
                xtype: 'container',
                layout : {
                    type: 'hbox',
                    align: 'stretch'
                },
                height: 30,
                items: [{
                    xtype: 'box',
                    flex: 1
                }, {
                    xtype: 'button',
                    text: 'DELETE',
                    style: {
                        color: 'red'
                    },
                    margin: '0 10 10 0',
                    handler: function() {
                        panel.ownerCt.remove(panel);
                    },
                    height: 20
                }]
            }],
            setValue: function(v) {
                panel.value = v;
                for (var key in v) {
                    var value = v[key];
                    const item = panel.queryBy( (x) => x.name === key)[0];
                    item.setValue(value);
                }
            },
            getValue: function() {
                const value = panel.value || {};
                const fields = panel.queryBy( (x) => !!x.name);
                for (var field of fields) {
                    if (field.getValue() === '') {
                        delete value[field.name];
                    } else {
                        value[field.name] = field.getValue();
                    }
                }
                return value;
            }
        });
        return panel;
    };

    const editorPresets = new Ext.Panel({
        title: 'settings.yml presets:',
        frame: true,
        section: 'presets',
        margin: 10,
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
            xtype: 'container',
            ignoreAssignment: true,
            name: '.',
            layout : {
                type: 'hbox',
                align: 'stretch'
            },
            height: 40,
            items: [{
                xtype: 'box',
                width: 115
            }, {
                xtype: 'button',
                text: 'Add section',
                handler: function() {
                    editorPresets.add(presetsSection());
                    editorPresets.doLayout();
                },
                height: 20,
                margin: '10 0'
            }],
            getValue: function() {
                const sections = editorPresets.queryBy( (x) => !!x.isSection);
                return sections.map( (section) => section.getValue() );
            },
            setValue: function(v) {
                this.value = v;
                for (var k of v) {
                    const section = presetsSection();
                    editorPresets.add(section);
                    editorPresets.doLayout();
                    section.setValue(k);
                }
            }
        }]
    });

    const prerenderSection = function() {
        const panel = new Ext.Panel({
            isSection: true,
            ignoreAssignment: true,
            frame: true,
            margin: 5,
            items: [{
                xtype: 'container',
                ...defaultEditorSettings,
                items: [{
                    xtype: 'textfield',
                    fieldLabel: 'name',
                    name: 'name',
                    description: 'How will we call this page. It will be accessible as /pages/[name], for example, if you call it <i>members</i>, it will be accessible as <i>/pages/members</i>'
                }, {
                    xtype: 'textfield',
                    fieldLabel: 'label',
                    name: 'url',
                    description: 'The search parameters of the page. For example, <i>/card-mode?category=open-mainframe-project-member-company&grouping=category&embed=yes&style=borderless</i>'
                }]
            }, {
                xtype: 'container',
                layout : {
                    type: 'hbox',
                    align: 'stretch'
                },
                height: 30,
                items: [{
                    xtype: 'box',
                    flex: 1
                }, {
                    xtype: 'button',
                    text: 'DELETE',
                    style: {
                        color: 'red'
                    },
                    margin: '0 10 10 0',
                    handler: function() {
                        panel.ownerCt.remove(panel);
                    },
                    height: 20
                }]
            }],
            setValue: function(v) {
                panel.value = v;
                for (var key in v) {
                    var value = v[key];
                    const item = panel.queryBy( (x) => x.name === key)[0];
                    item.setValue(value);
                }
            },
            getValue: function() {
                const value = panel.value || {};
                const fields = panel.queryBy( (x) => !!x.name);
                for (var field of fields) {
                    if (field.getValue() === '') {
                        delete value[field.name];
                    } else {
                        value[field.name] = field.getValue();
                    }
                }
                return value;
            }
        });
        return panel;
    };

    const editorPrerender = new Ext.Panel({
        title: 'settings.yml prerender:',
        frame: true,
        section: 'prerender',
        margin: 10,
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
              xtype: 'box',
              margin: 5,
              html: `This is a prerender section. It allows you to specify which pages with given filters and options you want to prerender, this way a page is rendered as html and can be displayed significantly faster`
            },{
            xtype: 'container',
            ignoreAssignment: true,
            name: '.',
            layout : {
                type: 'hbox',
                align: 'stretch'
            },
            height: 40,
            items: [{
                xtype: 'box',
                width: 115
            }, {
                xtype: 'button',
                text: 'Add section',
                handler: function() {
                    editorPrerender.add(prerenderSection());
                    editorPrerender.doLayout();
                },
                height: 20,
                margin: '10 0'
            }],
            getValue: function() {
                const sections = editorPrerender.queryBy( (x) => !!x.isSection);
                const values = sections.map( (section) => section.getValue() );
                const result = {};
                for (var v of values) {
                    result[v.name] = v.url;
                }
                return result;
            },
            setValue: function(v) {
                this.value = v;
                for (var k in v) {
                    const section = prerenderSection();
                    editorPrerender.add(section);
                    editorPrerender.doLayout();
                    section.setValue({ name: k, url: v[k] });
                }
            }
        }]
    });

    const exportSection = function() {
        const panel = new Ext.Panel({
            isSection: true,
            ignoreAssignment: true,
            frame: true,
            margin: 5,
            items: [{
                xtype: 'container',
                ...defaultEditorSettings,
                items: [{
                    xtype: 'textfield',
                    fieldLabel: 'name',
                    name: 'name',
                    description: 'How will we call this page. It will be accessible as /data/exports/[name].json, for example, if you call it <i>members</i>, it will be accessible as <i>/data/exports/members.json</i>'
                }, {
                    xtype: 'textfield',
                    fieldLabel: 'label',
                    name: 'url',
                    description: 'The search parameters of the page. For example, <i>/card-mode?category=open-mainframe-project-member-company&grouping=category&embed=yes&style=borderless</i>'
                }]
            }, {
                xtype: 'container',
                layout : {
                    type: 'hbox',
                    align: 'stretch'
                },
                height: 30,
                items: [{
                    xtype: 'box',
                    flex: 1
                }, {
                    xtype: 'button',
                    text: 'DELETE',
                    style: {
                        color: 'red'
                    },
                    margin: '0 10 10 0',
                    handler: function() {
                        panel.ownerCt.remove(panel);
                    },
                    height: 20
                }]
            }],
            setValue: function(v) {
                panel.value = v;
                for (var key in v) {
                    var value = v[key];
                    const item = panel.queryBy( (x) => x.name === key)[0];
                    item.setValue(value);
                }
            },
            getValue: function() {
                const value = panel.value || {};
                const fields = panel.queryBy( (x) => !!x.name);
                for (var field of fields) {
                    if (field.getValue() === '') {
                        delete value[field.name];
                    } else {
                        value[field.name] = field.getValue();
                    }
                }
                return value;
            }
        });
        return panel;
    };

    const editorExport = new Ext.Panel({
        title: 'settings.yml export:',
        frame: true,
        section: 'export',
        margin: 10,
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
              xtype: 'box',
              margin: 5,
              html: `This is an export section. It allows you to specify which data will be stored as json files `
            },{
            xtype: 'container',
            ignoreAssignment: true,
            name: '.',
            layout : {
                type: 'hbox',
                align: 'stretch'
            },
            height: 40,
            items: [{
                xtype: 'box',
                width: 115
            }, {
                xtype: 'button',
                text: 'Add section',
                handler: function() {
                    editorExport.add(exportSection());
                    editorExport.doLayout();
                },
                height: 20,
                margin: '10 0'
            }],
            getValue: function() {
                const sections = editorExport.queryBy( (x) => !!x.isSection);
                const values = sections.map( (section) => section.getValue() );
                const result = {};
                for (var v of values) {
                    result[v.name] = v.url;
                }
                return result;
            },
            setValue: function(v) {
                this.value = v;
                for (var k in v) {
                    const section = exportSection();
                    editorExport.add(section);
                    editorExport.doLayout();
                    section.setValue({ name: k, url: v[k] });
                }
            }
        }]
    });

    const editorTest = new Ext.Panel({
        title: 'settings.yml test:',
        section: 'test',
        ...defaultEditorSettings,
        frame: true,
        items: [{
            xtype: 'textfield',
            fieldLabel: 'header',
            name: 'header',
            description: 'Which text needs to be tested for a presence on every page'
        }, {
            xtype: 'textfield',
            fieldLabel: 'section',
            name: 'section',
            description: 'Which sections should be present on a /cards tab'
        }, {
            xtype: 'textfield',
            fieldLabel: 'logo',
            name: 'logo',
            description: 'Which logo should be present on in the section of a /cards tab'
        }]
    });



    const editor = new Ext.Container({
        flex: 1,
        style: {
            overflowY: 'auto'
        },
        items: [editorGlobal, editorTwitter, editorValidator, editorRelation, editorMembership, editorHome, editorAds, editorPresets, editorPrerender, editorExport, editorTest] 
    });

    const descriptionPanel = new Ext.Panel({
        flex: 1,
        frame: true,
        bodyPadding: 10,
        title: 'Choose a field to get its description',
        layout: 'fit',
        items: [{ xtype: 'box' }]
    });

    editor.on('afterrender', function() {
        setInterval(function() {
            const fields = editor.query('[name]');
            for (var item of fields) {
                if (!item.subscribedForDescription) {
                    item.subscribedForDescription = true;
                    const updateDescription = function(item) {
                        descriptionPanel.setTitle('Info: ' + item.name);
                        descriptionPanel.down('[xtype=box]').update(item.description || 'No description')
                    }
                    item.on('focus', updateDescription);
                    item.on('mouseover', updateDescription);
                }
            }
        }, 1000);
    });

    const bottom = new Ext.ComponentMgr.create({
        xtype: 'container',
        layout: {type: 'hbox', align: 'center'},
        height: 50,
        region: 'south',
        items: [{
            margins: 10,
            xtype: 'button',
            scale: 'medium',
            text: 'Save settings.yml',
            handler: async function() {
                const values = mainContainer.getValues();
                await saveSettings(values);
            }
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

    const getValues = function() {
        const sections = mainContainer.queryBy( (x) => !!x.section);
        const copy = JSON.parse(JSON.stringify(this.data.settings));

        for (var sectionContainer of sections) {
            let result = copy[sectionContainer.section] || {};
            const fields = sectionContainer.queryBy( (x) => !!x.name);
            for (var field of fields) {
                const ignore = field.up('[ignoreAssignment]');
                const value = field.getValue();
                if (field.name === '.') {
                    result = field.getValue()
                } else if (!ignore) {
                    const parts = field.name.split('.');
                    if (parts.length === 2) {
                        result[parts[0]] = result[parts[0]] || {};
                        if (value !== '') {
                            result[parts[0]][parts[1]] = value;
                        } else {
                            delete result[parts[0]][parts[1]];
                        }
                    } else {
                        if (value !== '') {
                            result[field.name] = value;
                        } else {
                            delete result[field.name];
                        }
                    }
                }
            }

            // remove empty {} fields
            if (Ext.isObject(result)) {
                for (var k in result) {
                    if (JSON.stringify(result[k]) === '{}') {
                        delete result[k];
                    }
                }
            }

            if (result === '') {
                delete copy[sectionContainer.section];
            } else {
                copy[sectionContainer.section] = result;
            }
        }

        return copy;
    }

    const mainContainer = new Ext.Container({
        itemId: 'settings',
        layout: 'border',
        items: [{
            region: 'center',
            xtype: 'container',
            bodyPadding: 15,
            layout: {
                padding: 5,
                type: 'vbox',
                align: 'stretch'
            },
            items: [editor]
        }, {
            xtype: 'container',
            region: 'east',
            width: 300,
            layout: {
                padding: 5,
                type: 'vbox',
                align: 'stretch',
            },
            items: [ descriptionPanel]
        }, bottom],
        loadData: function(data) {
            if (data) {
                this.data = data;
            } else {
                data = this.data;
            }
            if (!this.rendered) {
                this.on('afterrender', () => this.loadData());
            } else {
                // assign items here
                const settings = data.settings;
                const fields = editor.query('[name]');
                for (let field of fields) {
                    const section = field.up('[section]').section;
                    const ignore = field.up('[ignoreAssignment]');
                    const path = [section].concat(field.name.split('.'));
                    const value = (function() {
                        let target = settings;
                        for (var part of path) {
                            if (part !== '') {
                                target = (target || {})[part];
                            }
                        }
                        return target;
                    })();
                    if (!ignore && Ext.isDefined(value)) {
                        field.setValue(value);
                    }
                }
            }
        },
        getValues: getValues
    });

    setInterval(function() {
        const values = mainContainer.getValues();
        if (mainContainer.previousValues !== JSON.stringify(values)) {
            mainContainer.previousValues = JSON.stringify(values);
            // trigger a change
            mainContainer.fireEvent('save-preview', values);
        }
    }, 1000);

    mainContainer.on('save-preview', (values) => saveSettingsPreview(values), null, { buffer: 1000 });




    return mainContainer;
}

function getLandscapeYmlEditor() {


    const fields = ['category', 'subcategory', 'id', 'item', 'original', 'source', ...allowedKeys];

    const store = new Ext.data.JsonStore({
        fields: fields
    });

    const subscribeStore = () => {
        store.on('datachanged', () => mainContainer.fireEvent('save-preview'));
    }

    const grid = new Ext.grid.Panel({
        flex: 1,
        padding: 5,
        frame: true,
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
        }, '-', {
            xtype: 'button',
            text: 'Categories / Subcategories editor',
            handler: () => {
                const panel = getCategoriesEditor();
                const wnd = new Ext.Window({
                    header: false,
                    modal: true,
                    minimizable: false,
                    maximizable: false,
                    resizable: false,
                    width: 1050, 
                    height: 600,
                    layout: 'fit',
                    items: [panel]
                });

                panel.on('category-renamed', ({from, to}) => {
                    const category = mainContainer.data.landscape.filter( (x) => x.name === from )[0];
                    const categorySelector = mainContainer.down('[name=category]');
                    category.name = to;
                    categorySelector.store.loadData(mainContainer.data.landscape.map( (x) => ({ id: x.name, name: x.name })));
                    if (categorySelector.getValue() === from) {
                        categorySelector.setValue(to);
                    }
                    for (let record of store.getRange()) {
                        if (record.get('category') === from) {
                            record.set('category', to);
                            record.commit();
                        }
                    }
                });

                panel.on('subcategory-renamed', ({category, from, to}) => {
                    const categoryEntry = mainContainer.data.landscape.filter( (x) => x.name === category )[0];
                    const subcategory = categoryEntry.subcategories.filter( (x) => x.name === from )[0];
                    subcategory.name = to;
                    const categorySelector = mainContainer.down('[name=category]');
                    const subcategorySelector = mainContainer.down('[name=subcategory]');
                    if (categorySelector.getValue() === category) {
                        if (subcategorySelector.getValue() === from) {
                            updateSubcategoryList();
                            subcategorySelector.setValue(to);
                        } else {
                            updateSubcategoryList();
                        }
                    }

                    for (let record of store.getRange()) {
                        if (record.get('category') === category && record.get('subcategory') === from) {
                            record.set('subcategory', to);
                            record.commit();
                        }
                    }
                });

                panel.on('category-added', ({category}) => {
                    mainContainer.data.landscape.push({ name: category, subcategories: [] });
                    const categorySelector = mainContainer.down('[name=category]');
                    categorySelector.store.loadData(mainContainer.data.landscape.map( (x) => ({ id: x.name, name: x.name })));
                });

                panel.on('category-removed', ({category}) => {
                    mainContainer.data.landscape = mainContainer.data.landscape.filter( (x) => x.name !== category);
                    const categorySelector = mainContainer.down('[name=category]');
                    categorySelector.store.loadData(mainContainer.data.landscape.map( (x) => ({ id: x.name, name: x.name })));
                    if (categorySelector.getValue() === category) {
                        categorySelector.setValue('');
                        updateSubcategoryList();
                    }
                    for (let record of store.getRange()) {
                        if (record.get('category') === category) {
                            store.remove(record);
                        }
                    }
                });

                panel.on('subcategory-added', ({category, subcategory}) => {
                    const categoryEntry = mainContainer.data.landscape.filter( (x) => x.name === category )[0];
                    categoryEntry.subcategories.push({ name: subcategory, items: [] });
                    const categorySelector = mainContainer.down('[name=category]');
                    if (categorySelector.getValue() === category) {
                        updateSubcategoryList();
                    }
                });

                panel.on('subcategory-removed', ({category, subcategory}) => {
                    const categoryEntry = mainContainer.data.landscape.filter( (x) => x.name === category )[0];
                    categoryEntry.subcategories = categoryEntry.subcategories.filter( (x) => x.name !== subcategory)

                    const categorySelector = mainContainer.down('[name=category]');
                    const subcategorySelector = mainContainer.down('[name=subcategory]');

                    if (categorySelector.getValue() === category) {
                        updateSubcategoryList();
                        if (subcategorySelector.getValue() === subcategory) {
                            categorySelector.setValue('');
                        }
                    }
                    for (let record of store.getRange()) {
                        if (record.get('category') === category && record.get('subcategory') === subcategory) {
                            store.remove(record);
                        }
                    }
                });

                wnd.show();
                panel.loadData(mainContainer.data);
            }
        }, '-', {
            xtype: 'button',
            enableToggle: true,
            toggled: true,
            text: 'Enable preview'
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
        const prevValue = JSON.stringify(item.data);
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

        item.commit();
        const newValue = JSON.stringify(item.data);
        if (newValue !== prevValue) {
            mainContainer.fireEvent('save-preview');
        }
    }

    // keep a current selection

    const descriptionPanel = new Ext.Panel({
        frame: true,
        bodyPadding: 10,
        region: 'south',
        text: 'Selected Field Information',
        width: '100%',
        height: 130,
        layout: 'fit',
        items: [{ xtype: 'box' }]
    });

    const editor = new Ext.Panel({
        frame: true,
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
                    y: 1,
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
                    y: 6,
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
                    y: 6,
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
                    y: 6,
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
                    y: 6,
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
                xtype: 'combo',
                name: 'project',
                fieldLabel: 'project',
                description: 'Which internal project this entry belongs to',
                displayField: 'name',
                valueField: 'id',
                width: 120,
                store: new Ext.data.JsonStore({
                    fields: ['id', 'name'],
                    data: []
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
                name: 'url_for_bestpractices',
                fieldLabel: 'Best practices',
                description: 'When a project follows best practices at https://bestpractices.coreinfrastructure.org/en/projects, please provide a project github url here.'
            }, {
                name:  'enduser',
                fieldLabel: 'enduser',
                description: `CNCF specific field. Allows to mark a certain entry as an end user`,
                ...yesNoComboboxOptions
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
                name: 'allow_duplicate_repo',
                fieldLabel: 'allow_duplicate_repo',
                description: `Usually two different items can not have the same repo_url. Rarely different items refer to the same github repo, in this case both should be marked as <b>true</b>`,
                ...yesNoComboboxOptions
            }, {
                xtype: 'combo',
                name: 'unnamed_organization',
                fieldLabel: 'unnamed_organization',
                description: 'CNCF specific field to show a lack of organization. Choose <b>true</b> only in that case',
                cncfOnly: true,
                ...yesNoComboboxOptions
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


    const mainContainer = new Ext.Container({
        layout: 'border',
        title: 'landscape.yml',
        items: [{
            xtype: 'container',
            region: 'center',
            items: [ grid ],
            layout: {
                padding: 5,
                type: 'vbox',
                align: 'stretch'
            }
        }, {
            region: 'east',
            xtype: 'container',
            width: 500,
            bodyPadding: 15,
            layout: {
                padding: 5,
                type: 'vbox',
                align: 'stretch'
            },
            items: [editor, { xtype: 'box', height: 20 }, descriptionPanel]
            // editor,
            // descriptionPanel]
        }],
        loadData: function(data) {
            if (data) {
                this.data = data;
            } else {
                data = this.data;
            }
            if (!this.rendered) {
                this.on('afterrender', () => this.loadData());
            } else {
                store.loadData(data.items);
                subscribeStore;
                this.down('[name=category]').store.loadData(data.landscape.map( (x) => ({ id: x.name, name: x.name })));
                this.down('[name=project]').store.loadData([{id: '', name: '(no project)'}].concat(data.projects));
                const selectedItemId = window.localStorage.getItem('selected-' + window.activeBackend.getDescription());
                const selectedItem = store.getRange().filter( (x) => x.data.id === selectedItemId)[0];
                if (selectedItem) {
                    setTimeout( () => {
                        grid.getSelectionModel().select([selectedItem]);
                        grid.on('viewready', function() {
                            grid.getView().el.dom.querySelector('.x-grid-row-selected').scrollIntoView();
                        });
                    }, 100);
                }
            }
        },
        width: 1124,
        height: 818
    });

    const previewSelectedItem = async function(options = {}) {
        const selectedItem = sm.getSelection()[0];
        const iframe = document.querySelector('#grid-preview iframe');
        if (!selectedItem) {
            iframe.src = '';
            return;
        }
        const response = await fetch('/api/item-id', {
            method: 'POST',
            body: JSON.stringify({
                socketId: window.socketId, 
                name: selectedItem.get('name'),
                path: selectedItem.get('category') + ' / ' + selectedItem.get('subcategory')
            }),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });
        const itemInfo = await response.json();
        if (itemInfo.id) {
            if (!options.forceReload && iframe.contentWindow.landscapeRouter) {
                iframe.contentWindow.landscapeRouter.push(`/card-mode?selected=${itemInfo.id}`);
            } else {
                iframe.src = `/landscape/card-mode.html?selected=${itemInfo.id}&style="body{zoom:0.7}"`;
            }
        } else {
            iframe.src = '';
        }
    }

    grid.on('afterrender', function() {
        const parent = grid.el.dom;
        Ext.DomHelper.append(Ext.getBody(), `
          <div id="grid-preview" style="position: absolute; z-index: 1; width: 620px ; height: 400px; right: 490px; bottom: 0px;
                       background: white; border: 1px solid black; border-radius: 5px; overflow: hidden;">
              <div id="grid-preview-status" style="z-index: 2;position: absolute; top: 0; right: 0; height: 15px; width: 100px; color: white; text-align: center; background: rgb(21, 127,204);" ></div>
              <iframe style="border: 0; position: relative; width: 1200px; height: 800px; left: -290px; top: -200px;"></iframe>
          </div>
        `);
        grid.preview = document.querySelector('#grid-preview');
        const iframe = grid.preview.querySelector('iframe');

        Ext.globalEvents.on('finish', function(data) {
            if (data.target === 'server') {
                if (data.code === 0) {
                    // we need to actually reload a page!
                    previewSelectedItem({forceReload: true});
                }
            }
        });

        Ext.globalEvents.on('status', function(data) {
            if (data.target === 'server') {
                const el = document.querySelector('#grid-preview-status');
                if (data.status === 'progress') {
                    el.innerText = 'Building preview...'
                } else if (data.status === 'success') {
                    el.innerText = 'Preview ready'
                } else if (data.status === 'failure') {
                    el.innerText = 'Preview failed'
                }
            }
        });

        Ext.globalEvents.on('tabchange', function(tabId) {
            const isVisible = tabId === 'landscape';
            Ext.get(grid.preview).setVisible(isVisible);
        });

        grid.dockedItems.findBy( (x) => x.xtype === 'toolbar').items.insert(0,
            new Ext.Button({
                xtype: 'button',
                text: 'Save landscape.yml',
                handler: () => saveChanges(store),
                scale: 'medium'
            })
        );

    });

    sm.on('selectionchange', async function() {
        checkSelection();
        const selectedItem = sm.getSelection()[0];
        if (selectedItem) {
            window.localStorage.setItem('selected-' + window.activeBackend.getDescription(), selectedItem.get('id'));
            await previewSelectedItem();

        }
    });
    mainContainer.on('afterrender', () => checkSelection(), this, { delay: 1});
    mainContainer.on('save-preview', () => savePreview(store), null, { buffer: 1000 });


    function updateSubcategoryList() {
        const category = editor.down('[name=category]').getValue();
        const categoryEntry = mainContainer.data.landscape.filter( (x) => x.name === category)[0];
        let list = [];
        if (categoryEntry) {
            list = categoryEntry.subcategories.map( (x) => ({ id: x.name, name: x.name }));
        }
        editor.down('[name=subcategory]').store.loadData(list);
        const value = editor.down('[name=subcategory]').getValue();
        if (!categoryEntry.subcategories.filter( (x) => x.name === value)[0]) {
            editor.down('[name=subcategory]').setValue('');
        }
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

function getCategoriesEditor() {
    const panel = new Ext.Panel({
        header: false,
        bodyPadding: 10,
        layout: {
            type: 'border',
        },
        items: [{
            xtype: 'container',
            region: 'north',
            height: 80,
            html: ` <pre style="color: white;">
Here you can add, rename and delete categories and subcategores.  Double click on category or subcategory to change the name.
Click once to select a row, then choose a 'Delete' button to delete an item or 'New' to add one
After adding a new category or subcategory - close this modal window and add at least one item to the new category/subcategory
              </pre> `,
            items: [{
                xtype: 'button',
                text: 'X',
                style: {
                    position: 'absolute',
                    right: '5px'
                },
                handler: function() {
                    panel.ownerCt.close();
                }
            }]
        }, {
            region: 'center',
            xtype: 'container',
            layout: {
                type: 'hbox',
                align: 'stretch'
            },
            items: [{
                width: 500,
                xtype: 'grid',
                tbar: [{
                    xtype: 'button',
                    text: 'Add',
                    handler: function() {
                        Ext.Msg.prompt('Name', 'Category Name', function(button,  text) {
                            if (text) {
                                const newRecord = panel.down('#categories').store.add({ name: text, children: []})[0];
                                panel.down('#categories').getSelectionModel().select(newRecord);
                                handleSelectedCategory();
                                panel.fireEvent('category-added', { category: text });
                            }
                        });
                    }
                }, '-', {
                    xtype: 'button',
                    text: 'Delete',
                    handler: function() {
                        const record = panel.down('#categories').getSelectionModel().getSelection()[0];
                        if (!record) {
                            return;
                        }
                        panel.down('#categories').store.remove(record);
                        handleSelectedCategory();
                        panel.fireEvent('category-removed', { category: record.get('name') });
                    }
                }],
                itemId: 'categories',
                title: 'Categories',
                columns: [{text: 'name', dataIndex: 'name', flex: 1, sortable: false, editor: { xtype: 'textfield' }}],
                plugins: [Ext.create('Ext.grid.plugin.CellEditing', { clicksToEdit: 2 })],
                store: new Ext.data.JsonStore({
                    fields: ['id', 'name', 'children']
                })
            }, { xtype: 'box', width: 10 }, {
                width: 500,
                xtype: 'grid',
                tbar: [{
                    xtype: 'button',
                    text: 'Add',
                    handler: function() {
                        const categoryRecord = panel.down('#categories').getSelectionModel().getSelection()[0];
                        if (!categoryRecord) {
                            return;
                        }
                        Ext.Msg.prompt('Add to ' + categoryRecord.get('name'), 'Subcategory Name', function(button,  text) {
                            if (text) {
                                const newRecord = panel.down('#subcategories').store.add({ name: text, count: 0 })[0];
                                panel.down('#subcategories').getSelectionModel().select(newRecord);
                                panel.fireEvent('subcategory-added', { category: categoryRecord.get('name'), subcategory: text });
                            }
                        });
                    }
                }, '-', {
                    xtype: 'button',
                    text: 'Delete',
                    handler: function() {
                        const categoryRecord = panel.down('#categories').getSelectionModel().getSelection()[0];
                        if (!categoryRecord) {
                            return;
                        }
                        const record = panel.down('#subcategories').getSelectionModel().getSelection()[0];
                        if (!record) {
                            return;
                        }
                        panel.down('#subcategories').store.remove(record);
                        panel.fireEvent('subcategory-removed', { category: categoryRecord.get('name'), subcategory: record.get('name') });
                    }
                }],
                itemId: 'subcategories',
                title: 'Subcategories',
                columns: [{text: 'name', dataIndex: 'name', flex: 1, sortable: false, editor: { xtype: 'textfield' }}, { text: '#', width: 40, sortable: false, dataIndex: 'count'}],
                plugins: [Ext.create('Ext.grid.plugin.CellEditing', { clicksToEdit: 2 })],
                store: new Ext.data.JsonStore({
                    fields: ['id', 'name', 'count']
                })
            }]
        }],
        loadData: function(data) {
            if (data) {
                this.data = data;
            } else {
                data = this.data;
            }
            if (!this.rendered) {
                this.on('afterrender', () => this.loadData());
            } else {
                const storeCategories = this.down('#categories').store;
                const storeSubcategories = this.down('#subcategories').store;

                // data is just records
                // const categories = {};
                // for (var item of data) {
                // if (!categories[item.get('category')]) {
                // categories[item.get('category')] = {
                // name: item.get('category'),
                // subcategories: {}
                // }
                // }
                // const category = categories[item.get('category')];
                // if (!category.subcategories[item.get('subcategory')]) {
                // category.subcategories[item.get('subcategory')] = {
                // name: item.get('subcategory'),
                // items: []
                // }
                // }
                // const subcategory = category.subcategories[item.get('subcategory')];
                // subcategory.items.push(item);
                // }

                storeCategories.loadData(data.landscape.map( (x) => ({ id: x.name, name: x.name, children: x.subcategories })));
            }
        }
    });

    const handleSelectedCategory = () => {
        const gridCategories = panel.down('#categories');
        const gridSubcategories = panel.down('#subcategories');
        const selected = gridCategories.getSelectionModel().getSelection()[0];
        if (!selected) {
            gridSubcategories.store.loadData([]);
        } else {
            const children = selected.get('children');
            gridSubcategories.store.loadData(children.map( (x) => ({ id: x.name, name: x.name, count: x.items.length })));
        }
    }

    panel.on('afterrender', function() {
        const gridCategories = this.down('#categories');
        const gridSubcategories = this.down('#subcategories');

        gridCategories.getSelectionModel().on('selectionchange', handleSelectedCategory);

        gridCategories.store.on('update', (store, record) => {
            if (gridCategories.ignoreUpdate) {
                return;
            }
            const prevName = record.modified.name;
            const newName = record.data.name;
            panel.fireEvent('category-renamed', { from: prevName, to: newName });
            gridCategories.ignoreUpdate = true;
            record.commit();
            gridCategories.ignoreUpdate = false;
        });
        gridSubcategories.store.on('update', (store, record) => {
            if (gridSubcategories.ignoreUpdate) {
                return;
            }
            const category = gridCategories.getSelectionModel().getSelection()[0].get('name');
            const prevName = record.modified.name;
            const newName = record.data.name;
            panel.fireEvent('subcategory-renamed', { category, from: prevName, to: newName });
            gridSubcategories.ignoreUpdate = true;
            record.commit();
            gridSubcategories.ignoreUpdate = false;
        });

    });
    return panel;
}

function getYarnFetchPanel() {
    const panel = new Ext.Panel({
        bodyPadding: 10,
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
            xtype: 'box',
            autoEl: {
                cn: `Fetch and update external data from crunchbase, github, twitter and bestpractices. Preprocess svg images.
                <br> Note: this command is used automatically during a netlify preview or a daily update.
                <br> Changes to <b>landscape.yml</b> and <b>settings.yml</b> files will be saved first`
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

    Ext.globalEvents.on('finish', function(data) {
        if (data.target === 'fetch') {
            addMessage('Finished fetching data');
            button.enable();
            button.setText('FETCH');
        }
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
            addMessage(`Uploading local files`);
        }

        await fetch('api/fetch', {
            body: JSON.stringify({
                socketId: socketId,
                files: files ? Object.values(files) : null,
                mode: activeBackend.type === 'local' ? 'preview' : ''
            }),
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
                    text: 'Trigger a preview build',
                }, {
                    xtype: 'box',
                    itemId: 'status',
                    x: 190,
                    y: 9
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

    const clearMessages = function() {
        panel.down('#terminal').el.setHTML('');
    }

    Ext.globalEvents.on('message', function(data) {
        if (data.target === 'server') {
            const textEl = document.createElement('span');
            textEl.innerText = data.text;
            panel.down('#terminal').el.dom.appendChild(textEl);
        }
    });
    Ext.globalEvents.on('status', function(data) {
        if (data.target === 'server') {
            panel.down('#status').el.setHTML(`Server status: ${data.status}`);
            if (data.status === 'progress') {
                clearMessages();
                addMessage('Build started');
            }
        }
    });
    Ext.globalEvents.on('finish', function(data) {
        if (data.target === 'server') {
            if (data.code === 0) {
                const iframeTag = panel.down('#iframe').el.dom;
                iframeTag.src = "/landscape";
                iframeTag.style.opacity = 1;
            }
        }
    });

    panel.down('#start').on('click', async function() {
        await build();
    });

    async function build() {
        panel.down('#start').disable();
        let files = null;
        if (activeBackend.type === 'local') {
            addMessage(`Collecting local files`);
            files = await collectAllFiles();
            addMessage(`Uploading local files`);
        }
        panel.down('#start').enable();
        await fetch('api/build', {
            body: JSON.stringify({ socketId: socketId, files: files ? Object.values(files) : null}),
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json' 
            }
        });
    }

    panel.on('afterrender', async () => {
        await build();
    });

    return panel;
}

async function getMainPanel() {
    const data = await loadYmlFiles();

    const landscapeYmlEditor = getLandscapeYmlEditor();
    const settingsYmlEditor = getSettingsYmlEditor();
    const yarnFetchPanel = getYarnFetchPanel();
    const previewPanel = getPreviewPanel();

    landscapeYmlEditor.loadData(data);
    settingsYmlEditor.loadData(data);

    const statusBar = new Ext.ComponentMgr.create({
        style: {
            overflow: 'visible',
            position: 'absolute',
            'z-index': 1,
            left: '460px',
            width: 'calc(100% - 460px)',
            color: 'white',
            top: '-2px'
        },
        xtype: 'container',
        renderTo: Ext.getBody(),
        layout: {
            type: 'hbox',
            align: 'stretch'
        },
        height: 30,
        items: [{
            xtype: 'box',
            autoEl: {
                style: {
                    margin: '10px',
                    fontSize: '14px'
                },
                cn: `Connected to ${activeBackend.getDescription()}`
            }
        }, {
            itemId: 'pullrequest',
            xtype: 'button',
            text: 'Create a pull request',
            handler: function() {
                window.open(window.activeBackend.createPr, '_blank').focus();
            },
            style: {
                'margin-top': '4px'
            },
            hidden: !!activeBackend.pr
        }, {
            itemId: 'view-pr',
            xtype: 'button',
            text: 'Open the pull request',
            handler: function() {
                window.open(window.activeBackend.pr, '_blank').focus();
            },
            style: {
                'margin-top': '4px'
            },
            hidden: !activeBackend.pr
        }]
    });


    const mainPanel = new Ext.Panel({
        // title: 'Interactive Landscape Editor V1.0',
        header: false,
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
            xtype: 'container',
        }, {
            flex: 1,
            xtype: 'tabpanel',
            deferredRender: false,
            listeners: {
                tabchange: (tabpanel, newTab) => {
                    Ext.globalEvents.fireEvent('tabchange', newTab.itemId );
                }
            }, 
            items: [{
                itemId: 'landscape',
                title: 'landscape.yml',
                layout: 'fit',
                items: [ landscapeYmlEditor ]
            }, {
                itemId: 'settings',
                title: 'settings.yml',
                layout: 'fit',
                items: [ settingsYmlEditor ]
            }, {
                itemId: 'fetch',
                title: 'Fetch data',
                layout: 'fit',
                items: [ yarnFetchPanel ]
            }, {
                itemId: 'preview',
                title: 'Preview in real time',
                layout: 'fit',
                items: [ previewPanel]
            }]
        }]
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

window.collectAllFiles = collectAllFiles;
Ext.onReady(function() {
    init();
});
