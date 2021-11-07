const client = require('@octokit/core').Octokit;
const octokit = new client({
        auth: '670ee0953a3a3ca443781c9fe4a2aa312bd83c0b'
});

async function main() {
    const owner = 'lfai';
    const repo = 'lfai-landscape';

    const response = await octokit.request(`GET /repos/${owner}/${repo}/pulls`, {
    })
    const baseBranches = response.data.map( (x) => ({ number: x.number, branch:   x.head.ref }));
    console.info(response);
}
main();
