'use strict';

const {describe, it} = require('node:test');
const assert = require('node:assert');
const {EventEmitter} = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {validateDataset, parseMain} = require('../aimport/validators');

const REAL_MAIN = '#!/bin/bash\n#PBS -l nodes=1:ppn=1\n\nset -e\n\nsingularity exec -e docker://brainlife/dipy:1.1.1 ./run.py\n';
const datatype = {_id: 'dt1', name: 'neuro/anat/t1w', validator: 'brainlife/validator-neuro-anat', validator_branch: '1.0',
    files: [{id: 't1', filename: 't1.nii.gz', required: true}, {id: 'dir', dirname: 'stuff'}]};

// a fake spawn: git clone writes `main`; docker records its mounts and writes product.json
function fake({main = REAL_MAIN, product, dockerCode = 0, stderr = ''} = {}) {
    const calls = [];
    const seen = {};
    const spawn = (cmd, args) => {
        calls.push({cmd, args});
        const ee = new EventEmitter();
        ee.stdout = new EventEmitter();
        ee.stderr = new EventEmitter();
        let code = 0;
        if (cmd === 'git' && args[0] === 'clone') {
            const dir = args[args.length - 1];
            fs.mkdirSync(path.join(dir, '.git'), {recursive: true});
            fs.writeFileSync(path.join(dir, 'main'), main);
        }
        if (cmd === 'docker') {
            const work = args[args.indexOf('-v') + 1].split(':')[0];
            const input = args[args.lastIndexOf('-v') + 1].split(':')[0];
            seen.config = JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8'));
            seen.inputs = fs.readdirSync(input).sort();
            seen.copied = !fs.lstatSync(path.join(input, 't1.nii.gz')).isSymbolicLink();
            if (product) fs.writeFileSync(path.join(work, 'product.json'), JSON.stringify(product));
            code = dockerCode;
        }
        setImmediate(() => {
            if (cmd === 'docker' && stderr) ee.stderr.emit('data', stderr);
            ee.emit('close', code);
        });
        return ee;
    };
    return {spawn, calls, seen};
}

function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aimport-vtest-'));
    fs.mkdirSync(path.join(root, 'src', 'stuff'), {recursive: true});
    fs.writeFileSync(path.join(root, 'src', 't1.nii.gz'), 'x');
    fs.writeFileSync(path.join(root, 'src', 'stuff', 'a.txt'), 'y');
    const dataset = {dataset: {datatype: 'dt1', datatype_tags: ['t'], meta: {subject: '01'}, desc: '', tags: []},
        files: {'t1.nii.gz': path.join(root, 'src', 't1.nii.gz'), stuff: path.join(root, 'src', 'stuff')}};
    return {root, dataset, cacheDir: path.join(root, 'cache')};
}

describe('parseMain', () => {
    it('reads the image and command from a real validator main', () => {
        assert.deepStrictEqual(parseMain(REAL_MAIN), {image: 'brainlife/dipy:1.1.1', command: './run.py'});
    });
    it('returns null for anything but a single singularity exec', () => {
        assert.strictEqual(parseMain('#!/bin/bash\npython run.py\n'), null);
        assert.strictEqual(parseMain('singularity exec docker://a/b:1 ./run.py\nrm -rf x\n'), null);
        assert.strictEqual(parseMain('singularity exec docker://a/b:1 ./run.py; rm x\n'), null);
    });
    it('refuses option-like images and commands', () => {
        assert.strictEqual(parseMain('singularity exec docker://-v/:/host ./run.py\n'), null);
        assert.strictEqual(parseMain('singularity exec docker://a/b:1 --privileged\n'), null);
    });
});

describe('validateDataset', () => {
    it('writes config.json, stages copies and runs docker', async () => {
        const {root, dataset, cacheDir} = setup();
        try {
            const f = fake({product: {errors: [], warnings: ['w']}});
            const r = await validateDataset(dataset, datatype, {spawn: f.spawn, cacheDir});
            assert.deepStrictEqual(r, {ok: true, errors: [], warnings: ['w']});
            assert.strictEqual(f.seen.config.t1, '/input/t1.nii.gz');
            assert.strictEqual(f.seen.config.dir, '/input/stuff');
            assert.deepStrictEqual(f.seen.config._inputs[0].datatype_tags, ['t']);
            assert.deepStrictEqual(f.seen.inputs, ['stuff', 't1.nii.gz']);
            assert.ok(f.seen.copied);
            const clone = f.calls[0];
            assert.deepStrictEqual(clone.args.slice(0, 5), ['clone', '--depth', '1', '--branch', '1.0']);
            assert.ok(clone.args.includes('https://github.com/brainlife/validator-neuro-anat'));
            const dock = f.calls[1].args;
            assert.ok(dock.includes('linux/amd64'));
            assert.deepStrictEqual(dock.slice(-2), ['brainlife/dipy:1.1.1', './run.py']);
            assert.ok(dock.some(a => a.endsWith(':/input:ro')));
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });

    it('errors in product.json make it not ok', async () => {
        const {root, dataset, cacheDir} = setup();
        try {
            const r = await validateDataset(dataset, datatype, {spawn: fake({product: {errors: ['x']}}).spawn, cacheDir});
            assert.strictEqual(r.ok, false);
            assert.deepStrictEqual(r.errors, ['x']);
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });

    it('a crash without product.json reports the last 5 stderr lines', async () => {
        const {root, dataset, cacheDir} = setup();
        try {
            const err = ['1', '2', '3', '4', '5', '6', '7'].join('\n');
            const r = await validateDataset(dataset, datatype, {spawn: fake({dockerCode: 1, stderr: err}).spawn, cacheDir});
            assert.strictEqual(r.ok, false);
            assert.strictEqual(r.errors[0], 'validator crashed: 3\n4\n5\n6\n7');
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });

    it('is skipped without a validator, without running anything', async () => {
        const {root, dataset, cacheDir} = setup();
        try {
            const f = fake();
            const r = await validateDataset(dataset, {name: 'x', validator: '', files: []}, {spawn: f.spawn, cacheDir});
            assert.ok(r.skipped);
            assert.strictEqual(f.calls.length, 0);
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });

    it('is skipped when main is not a single singularity exec', async () => {
        const {root, dataset, cacheDir} = setup();
        try {
            const f = fake({main: '#!/bin/bash\npython run.py\n'});
            const r = await validateDataset(dataset, datatype, {spawn: f.spawn, cacheDir});
            assert.strictEqual(r.skipped, 'validator main is not a single singularity exec');
            assert.ok(!f.calls.some(c => c.cmd === 'docker'));
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });

    it('updates an existing cached clone instead of cloning', async () => {
        const {root, dataset, cacheDir} = setup();
        try {
            await validateDataset(dataset, datatype, {spawn: fake({product: {}}).spawn, cacheDir});
            const f = fake({product: {}});
            await validateDataset(dataset, datatype, {spawn: f.spawn, cacheDir});
            assert.ok(f.calls[0].args.includes('fetch'));
            assert.ok(f.calls[1].args.includes('reset'));
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });

    it('refuses option-like branch or repo without spawning', async () => {
        const {root, dataset, cacheDir} = setup();
        try {
            for (const dt of [Object.assign({}, datatype, {validator_branch: '--upload-pack=x'}), Object.assign({}, datatype, {validator: '../x'})]) {
                const f = fake();
                const r = await validateDataset(dataset, dt, {spawn: f.spawn, cacheDir});
                assert.ok(r.skipped);
                assert.strictEqual(f.calls.length, 0);
            }
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });

    it('is skipped when docker cannot run', async () => {
        const {root, dataset, cacheDir} = setup();
        try {
            const f = fake();
            const spawn = (cmd, args) => {
                if (cmd !== 'docker') return f.spawn(cmd, args);
                const ee = new EventEmitter();
                setImmediate(() => ee.emit('error', new Error('spawn docker ENOENT')));
                return ee;
            };
            const r = await validateDataset(dataset, datatype, {spawn, cacheDir});
            assert.strictEqual(r.skipped, 'docker could not be run: spawn docker ENOENT');
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });

    it('ignores a stale product.json from the repo', async () => {
        const {root, dataset, cacheDir} = setup();
        try {
            const clone = path.join(cacheDir, 'brainlife_validator-neuro-anat@1.0');
            fs.mkdirSync(path.join(clone, '.git'), {recursive: true});
            fs.writeFileSync(path.join(clone, 'main'), REAL_MAIN);
            fs.writeFileSync(path.join(clone, 'product.json'), '{"errors": []}');
            const r = await validateDataset(dataset, datatype, {spawn: fake().spawn, cacheDir});
            assert.strictEqual(r.ok, false);
            assert.match(r.errors[0], /no product.json/);
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });

    it('is skipped when a datatype file has no filename or dirname', async () => {
        const {root, dataset, cacheDir} = setup();
        try {
            const f = fake();
            const r = await validateDataset(dataset, Object.assign({}, datatype, {files: [{id: 'zz'}]}), {spawn: f.spawn, cacheDir});
            assert.strictEqual(r.skipped, 'datatype file zz has no filename');
            assert.strictEqual(f.calls.length, 0);
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });
});
