const childProcess = require('child_process');
const {cmd, appPath} = {
    cmd: 'PORT=3011 FORCE_COLOR=0 PROJECT_NAME=landscape PROJECT_PATH="../landscape" yarn dev',
    appPath: 'tmp/0.2968252783040779:1622533652125/landscapeapp'
}

const pid = childProcess.spawn(`bash`, [`-c`, cmd], { cwd: appPath });
console.info({cmd, appPath});

pid.stdout.on('data', (data) => {
    console.info(data.toString());
});

pid.stderr.on('data', (data) => {
    console.info(data.toString());
});
