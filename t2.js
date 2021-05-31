utils = require('./utils');
async function main() {
    await utils.cloneLandscapeApp({srcPath: '../landscapeapp', appPath: 'tmp/123/landscapeapp'});
}
main().catch( (x) => console.info(x) );
