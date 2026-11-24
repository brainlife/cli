'use strict';

// Run a brainlife datatype's validator on this computer (in Docker) before an
// object is uploaded. The validator repo is cloned from GitHub into a cache; its
// `main` script is read (never executed) to find the container image and command.

const fs = require('fs');
const os = require('os');
const path = require('path');
const child_process = require('child_process');

const DEFAULT_CACHE = path.join(os.homedir(), '.cache', 'brainlife', 'aimport', 'validators');
const SKIP_MAIN = 'validator main is not a single singularity exec';

// run a process through the (injectable) spawn; resolves {code, stdout, stderr}
function run(spawn, cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, Object.assign({stdio: ['ignore', 'pipe', 'pipe']}, opts));
        let stdout = '', stderr = '';
        if (child.stdout) child.stdout.on('data', d => { stdout += d; });
        if (child.stderr) child.stderr.on('data', d => { stderr += d; });
        child.on('error', reject);
        child.on('close', code => resolve({code, stdout, stderr}));
    });
}

// find the one `singularity exec [-e] docker://<image> <command>` in a main script
function parseMain(text) {
    const lines = String(text).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !/^set\s+-\w+$/.test(l));
    if (lines.length !== 1) return null;
    const m = lines[0].match(/^singularity\s+exec\s+(?:-e\s+)?docker:\/\/(\S+)\s+(\S.*)$/);
    if (!m) return null;
    const image = m[1];
    const command = m[2].trim();
    // the command is passed to docker as plain words, so no shell syntax
    if (/[;&|<>$`'"\\(){}*?]/.test(command)) return null;
    if (!/^[\w./:@-]+$/.test(image)) return null;
    return {image, command};
}

async function tail(text, n) {
    return text.split('\n').filter(l => l.trim()).slice(-n).join('\n');
}

// clone (or update) the validator repo in the cache; returns its folder
async function fetchValidator(datatype, cacheDir, spawn) {
    const repo = datatype.validator;
    const branch = datatype.validator_branch || '';
    const dir = path.join(cacheDir, (repo + '@' + (branch || 'default')).replace(/[^\w.@-]/g, '_'));
    if (fs.existsSync(path.join(dir, '.git'))) {
        const ref = branch || 'HEAD';
        let r = await run(spawn, 'git', ['-C', dir, 'fetch', '--depth', '1', 'origin', ref]);
        if (r.code === 0) r = await run(spawn, 'git', ['-C', dir, 'reset', '--hard', 'FETCH_HEAD']);
        if (r.code !== 0) throw new Error('git update failed: ' + await tail(r.stderr, 5));
        return dir;
    }
    fs.mkdirSync(cacheDir, {recursive: true});
    const args = ['clone', '--depth', '1'];
    if (branch) args.push('--branch', branch);
    args.push('https://github.com/' + repo, dir);
    const r = await run(spawn, 'git', args);
    if (r.code !== 0) {
        fs.rmSync(dir, {recursive: true, force: true});
        throw new Error('git clone failed: ' + await tail(r.stderr, 5));
    }
    return dir;
}

function stageInput(files, inputDir) {
    for (const [name, full] of Object.entries(files || {})) {
        const dest = path.resolve(inputDir, name);
        if (dest !== inputDir && !dest.startsWith(inputDir + path.sep)) throw new Error('file name outside the input folder: ' + name);
        fs.mkdirSync(path.dirname(dest), {recursive: true});
        fs.cpSync(full, dest, {recursive: true, dereference: true});
    }
}

async function validateDataset(dataset, datatype, {spawn = child_process.spawn, cacheDir = DEFAULT_CACHE} = {}) {
    const skip = reason => ({ok: true, skipped: reason, errors: [], warnings: []});
    if (!datatype || !datatype.validator) return skip('datatype has no validator');

    let clone;
    try {
        clone = await fetchValidator(datatype, cacheDir, spawn);
    } catch (err) {
        return skip('validator could not be fetched: ' + err.message);
    }
    let main;
    try {
        main = fs.readFileSync(path.join(clone, 'main'), 'utf8');
    } catch (err) {
        return skip('validator has no main script');
    }
    const parsed = parseMain(main);
    if (!parsed) return skip(SKIP_MAIN);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aimport-validate-'));
    try {
        const work = path.join(tmp, 'validator');
        const inputDir = path.join(tmp, 'input');
        fs.cpSync(clone, work, {recursive: true, filter: src => path.basename(src) !== '.git'});
        fs.mkdirSync(inputDir);

        const config = {};
        for (const f of datatype.files || []) config[f.id] = '/input/' + (f.filename || f.dirname);
        const d = dataset.dataset || {};
        config._inputs = [{datatype: datatype._id || datatype.name, meta: d.meta || {}, datatype_tags: d.datatype_tags || []}];
        fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify(config, null, 4));
        stageInput(dataset.files, inputDir);

        const args = ['run', '--rm', '--platform', 'linux/amd64',
            '-v', work + ':/validator', '-v', inputDir + ':/input:ro', '-w', '/validator',
            parsed.image].concat(parsed.command.split(/\s+/));
        const r = await run(spawn, 'docker', args);

        const productPath = path.join(work, 'product.json');
        let product = null;
        if (fs.existsSync(productPath)) {
            try {
                product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
            } catch (err) {
                return {ok: false, errors: ['validator wrote an unreadable product.json'], warnings: []};
            }
        }
        if (!product) {
            const why = r.code === 0 ? 'validator wrote no product.json' : 'validator crashed: ' + await tail(r.stderr, 5);
            return {ok: false, errors: [why], warnings: []};
        }
        const errors = [].concat(product.errors || []).map(String);
        const warnings = [].concat(product.warnings || []).map(String);
        return {ok: errors.length === 0, errors, warnings};
    } finally {
        fs.rmSync(tmp, {recursive: true, force: true});
    }
}

module.exports = {validateDataset, parseMain};
