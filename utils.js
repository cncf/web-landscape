const path = require('path');
const fs = require('fs/promises');
const childProcess = require('child_process');

async function cloneLandscapeApp({srcPath, appPath}) {
    await fs.mkdir(appPath, { recursive: true});
    childProcess.execSync(`rm -rf ${appPath}`);
    await fs.mkdir(appPath, { recursive: true});

    const srcFiles = await fs.readdir(srcPath);
    for (var file of srcFiles) {
        if (file === '.next') {
            await fs.mkdir(path.resolve(appPath, '.next'))
        } else {
            await fs.symlink(path.resolve(srcPath, file), path.resolve(appPath, file));
        }
    }
}

async function uploadFiles({landscapePath, files}) {

    await fs.mkdir(landscapePath, { recursive: true});
    console.info({landscapePath});
    childProcess.execSync(`rm -rf ${landscapePath}`);
    await fs.mkdir(landscapePath, { recursive: true});
    for (let entry of files) {
        const dir = entry.file.split('/').slice(0, -1).join('');
        if (dir) {
            await fs.mkdir(path.resolve(landscapePath, dir), { recursive: true});
        }
        await fs.writeFile(path.resolve(landscapePath, entry.file), entry.content);
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
