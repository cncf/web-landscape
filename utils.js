const path = require('path');
const fs = require('fs/promises');
const childProcess = require('child_process');

// clones a landscapeapp stored in the srcPath to appPath
// in order to save space, hard links are created for node_modules(1.2Gb)
async function cloneLandscapeApp({srcPath, appPath}) {
    await fs.mkdir(appPath, { recursive: true});
    childProcess.execSync(`rm -rf ${appPath}`);
    await fs.mkdir(appPath, { recursive: true});

    const srcFiles = await fs.readdir(srcPath);
    for (var file of srcFiles) {
        if (file === 'node_modules') {
            async function walk(dir) {
                let files = await fs.readdir(dir);
                files = await Promise.all(files.map(async file => {
                    const filePath = path.join(dir, file);
                    const stats = await fs.stat(filePath);
                    if (stats.isDirectory()) return walk(filePath);
                    else if(stats.isFile()) return {dir: dir.replace(srcPath, ''), file: file, filePath: filePath};
                }));
                return files.reduce((all, folderContents) => all.concat(folderContents), []);
            }
            const allNodeModulesFiles = await walk(path.join(srcPath, 'node_modules'));
            for(let entry of allNodeModulesFiles) {
                const dir = entry.dir.startsWith('/') ? entry.dir.substring(1) : entry.dir;
                const appFilePath = entry.filePath.replace(srcPath + '/', '');
                await fs.mkdir(path.resolve(appPath, dir), { recursive: true });
                await fs.link(path.resolve(entry.filePath), path.resolve(appPath, appFilePath));
            }
        } else if (file === '.git') {

        } else if (file === '.next') {
            await fs.mkdir(path.resolve(appPath, '.next'))
        } else {
            childProcess.execSync(`cp -r ${srcPath}/${file} ${appPath}/${file}`);
        }
    }
}

async function uploadFiles({landscapePath, files}) {
    await fs.mkdir(landscapePath, { recursive: true});
    console.info({landscapePath});
    const validFiles = {};
    for (let entry of files) {
        const dir = entry.file.split('/').slice(0, -1).join('');
        validFiles[entry.file] = true;
        if (dir) {
            await fs.mkdir(path.resolve(landscapePath, dir), { recursive: true});
        }
        const filePath = path.resolve(landscapePath, entry.file);
        let content = null;
        try {
            content = await fs.readFile(filePath, 'utf-8');
        } catch(ex) {

        }

        if (content !== entry.content) {
            await fs.writeFile(filePath, entry.content);
        }
    }
    const folders = ['images', 'hosted_logos', 'cached_logos'];
    for (let folder of folders) {
        const folderFiles = await fs.readdir(path.resolve(landscapePath, folder));
        for (let folderFile of folderFiles) {
            const fullPath = `${folder}/${folderFile}`;
            if (!validFiles[fullPath]) {
                await fs.unlink(path.resolve(landscapePath, folder, folderFile));
            }
        }
    }
}

async function collectFiles(landscapePath) {
    const files = ['settings.yml', 'landscape.yml', 'processed_landscape.yml', 'images/', 'hosted_logos/', 'cached_logos/'];
    const output = [];

    for (let file of files) {
        if (file.endsWith('/')) {
            const dirFiles = await fs.readdir(path.resolve(landscapePath, file));
            for (let dirFile of dirFiles) {
                const content = await fs.readFile(path.resolve(landscapePath, file, dirFile), 'utf-8');
                output.push({file: `${file}${dirFile}`, content: content });
            }
        } else {
            const content = await fs.readFile(path.resolve(landscapePath, file), 'utf-8');
            output.push({file, content });
        }

    }
    return output;
}

function calculateDifference({oldFiles, newFiles}) {
    let oldHash = {};
    for (var oldFile of oldFiles) {
        oldHash[oldFile.file] = oldFile.content;
    }
    let newHash = {};
    for (var newFile of newFiles) {
        newHash[newFile.file] = newFile.content;
    }
    let changedFiles = newFiles.filter( (newFile) => oldHash[newFile.file] !== newFile.content);
    let deletedFiles = oldFiles.filter( (oldFile) => !newHash[oldFile.file]).map( (deletedFile) => ({ file: deletedFile.file, isDeleted: true }));
    // detect deleted files!
    return changedFiles.concat(deletedFiles);
}

exports.cloneLandscapeApp = cloneLandscapeApp;
exports.collectFiles = collectFiles;
exports.uploadFiles = uploadFiles;
exports.calculateDifference = calculateDifference;
