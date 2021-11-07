const client = require('@octokit/core').Octokit;
const octokit = new client({});

async function main() {
    const owner = 'lfai';
    const repo = 'lfai-landscape';

    const response = await octokit.request(`GET /repos/${owner}/${repo}/pulls`, {
    })
    const baseBranches = response.data.map( (x) => ({ number: x.number, branch:   x.head.ref }));
    console.info(response);
}
main();
