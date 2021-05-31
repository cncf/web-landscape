utils = require('./utils');
async function main() {
    const inputFiles = [
        { file: 'settings.yml', content: 'settings'},
        { file: 'landscape.yml', content: 'landscape'},
        { file: 'processed_landscape.yml', content: 'processed_landscape'},
        { file: 'hosted_logos/1.svg', content: 'h1'},
        { file: 'cached_logos/1.svg', content: '1'},
        { file: 'cached_logos/2.svg', content: '2'},
        { file: 'images/image.svg', content: 'image'}
    ];
    await utils.uploadFiles({landscapePath: 'tmp/123', files: inputFiles});
    const equalResult = await utils.collectFiles('tmp/123');
    console.info(equalResult);
    require('fs').unlinkSync('tmp/123/cached_logos/1.svg');
    require('fs').writeFileSync('tmp/123/settings.yml', 'updated settings.yml');
    const result = await utils.collectFiles('tmp/123');
    const diff = utils.calculateDifference({newFiles: result, oldFiles: inputFiles});
    console.info({result, diff});
}
main().catch( (x) => console.info(x) );
