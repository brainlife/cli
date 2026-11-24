'use strict';

const {describe, it, before, after} = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bidsUpload = require('../bids-upload');
const {applyPlan, preflight, projectFiles, uploadProjectFiles} = require('../aimport/upload');

const FIXTURE = path.join(__dirname, 'fixtures', 'bids-mini');
const headers = {Authorization: 'Bearer a.b.c'};
const project = {_id: 'p1', group_id: 7};
const DATATYPES = [
    {name: 'neuro/anat/t1w', _id: 'dt-t1w'}, {name: 'neuro/anat/t2w', _id: 'dt-t2w'},
    {name: 'neuro/dwi', _id: 'dt-dwi'}, {name: 'neuro/func/task', _id: 'dt-func'},
];

// a local stand-in for amaretti, warehouse and the S3 presigned URL
function stub(opts = {}) {
    const calls = [];
    const srv = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const url = new URL(req.url, 'http://x');
            const raw = Buffer.concat(chunks);
            let body = null;
            if ((req.headers['content-type'] || '').includes('json') && raw.length) body = JSON.parse(raw);
            calls.push({method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, raw, headers: req.headers});
            const send = (obj, code = 200) => {
                res.writeHead(code, {'Content-Type': 'application/json'});
                res.end(JSON.stringify(obj));
            };
            const r = req.method + ' ' + url.pathname;
            if (r === 'GET /amaretti/instance') return send({instances: [{_id: 'i1', name: 'upload.7'}]});
            if (r === 'GET /warehouse/datatype') return send({datatypes: DATATYPES});
            if (r === 'GET /warehouse/dataset') return send({count: opts.count === undefined ? 1 : opts.count});
            if (r === 'POST /amaretti/task') return send({task: {_id: 't1', name: 'upload.7'}});
            if (r === 'GET /amaretti/task') return send({tasks: [{_id: 't1', status: 'finished', config: {_outputs: [{id: 'output'}]}}]});
            if (r === 'POST /amaretti/task/upload/t1') return opts.dropUpload ? req.socket.destroy() : send({});
            if (r === 'POST /warehouse/dataset') return send({_id: 'd' + calls.length});
            if (r === 'PUT /warehouse/participant/p1') return send({});
            if (r === 'POST /warehouse/files/p1/upload/presigned') {
                const key = 'p1/' + body.prefix + body.fileName;
                return send({presignedUrl: base + '/s3/' + key, key, bucket: 'b', expires: 'later'});
            }
            if (req.method === 'PUT' && url.pathname.startsWith('/s3/')) return url.pathname.endsWith('/README') ? send({}, 403) : send({});
            send({message: 'unexpected ' + r}, 404);
        });
    });
    let base;
    return new Promise(resolve => srv.listen(0, '127.0.0.1', () => {
        base = 'http://127.0.0.1:' + srv.address().port;
        resolve({srv, calls, api: {amaretti: base + '/amaretti', warehouse: base + '/warehouse'}});
    }));
}

function walk(root) {
    return new Promise((resolve, reject) => {
        require('../bids-walker').walk(root, (err, bids) => err ? reject(err) : resolve(bids));
    });
}

// copy the fixture so tests can plant files
function copyFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-aimport-upload-'));
    fs.cpSync(FIXTURE, dir, {recursive: true});
    return dir;
}

const quiet = () => {};

describe('uploadDatasets', () => {
    it('skips a dataset that is already uploaded', async () => {
        const s = await stub({count: 1});
        try {
            const bids = await walk(FIXTURE);
            const t1 = bids.datasets.filter(d => d.dataset.desc === 'sub-01_T1w.nii.gz');
            const result = await bidsUpload.uploadDatasets(headers, project, t1, {api: s.api, log: quiet});
            assert.deepStrictEqual(result, {uploaded: [], skipped: ['sub-01_T1w.nii.gz']});
            const finds = s.calls.filter(c => c.method === 'GET' && c.path === '/warehouse/dataset');
            assert.strictEqual(finds.length, 1);
            assert.strictEqual(JSON.parse(finds[0].query.find).datatype, 'dt-t1w');
            assert.ok(!s.calls.some(c => c.method === 'POST'));
        } finally {
            s.srv.close();
        }
    });

    it('uploads and registers a new dataset, with the extra tags', async () => {
        const s = await stub({count: 0});
        const lines = [];
        try {
            const bids = await walk(FIXTURE);
            const t1 = bids.datasets.filter(d => d.dataset.desc === 'sub-01_T1w.nii.gz');
            const result = await bidsUpload.uploadDatasets(headers, project, t1, {api: s.api, tags: ['aimport'], log: (...a) => lines.push(a.join(' '))});
            assert.deepStrictEqual(result, {uploaded: ['sub-01_T1w.nii.gz'], skipped: []});
            const task = s.calls.find(c => c.method === 'POST' && c.path === '/amaretti/task');
            assert.strictEqual(task.body.config._outputs[0].datatype, 'dt-t1w');
            const up = s.calls.find(c => c.path === '/amaretti/task/upload/t1');
            assert.strictEqual(up.query.p, 'upload.tar.gz');
            assert.ok(up.raw.length > 0);
            const reg = s.calls.find(c => c.method === 'POST' && c.path === '/warehouse/dataset');
            assert.strictEqual(reg.body.task_id, 't1');
            assert.deepStrictEqual(reg.body.tags, ['aimport']);
            assert.ok(lines.includes('Data object successfully uploaded.. now registering'));
        } finally {
            s.srv.close();
        }
    });

    it('clears the progress timer when the upload fails', async () => {
        const s = await stub({count: 0, dropUpload: true});
        const realSet = global.setInterval;
        const realClear = global.clearInterval;
        const live = new Set();
        global.setInterval = (...a) => {
            const t = realSet(...a);
            live.add(t);
            return t;
        };
        global.clearInterval = t => {
            live.delete(t);
            return realClear(t);
        };
        try {
            const bids = await walk(FIXTURE);
            const t1 = bids.datasets.filter(d => d.dataset.desc === 'sub-01_T1w.nii.gz');
            await assert.rejects(bidsUpload.uploadDatasets(headers, project, t1, {api: s.api, log: quiet}));
            assert.strictEqual(live.size, 0);
        } finally {
            global.setInterval = realSet;
            global.clearInterval = realClear;
            for (const t of live) realClear(t);
            s.srv.close();
        }
    });
});

describe('preflight', () => {
    it('accepts a plain BIDS tree', () => {
        preflight(FIXTURE);
    });

    it('refuses symlinks, key files and sourcedata anywhere', () => {
        const dir = copyFixture();
        try {
            fs.symlinkSync('/etc/hosts', path.join(dir, 'sub-01', 'anat', 'link.nii.gz'));
            assert.throws(() => preflight(dir), /symbolic link/);
            fs.rmSync(path.join(dir, 'sub-01', 'anat', 'link.nii.gz'));
            fs.symlinkSync(path.join(dir, 'sub-02'), path.join(dir, 'sub-03'));
            assert.throws(() => preflight(dir), /sub-03.*symbolic link/);
            fs.rmSync(path.join(dir, 'sub-03'));
            fs.writeFileSync(path.join(dir, 'sub-01', 'anat', 'p.aimport-key.json'), '{}');
            assert.throws(() => preflight(dir), /aimport-key/);
            fs.rmSync(path.join(dir, 'sub-01', 'anat', 'p.aimport-key.json'));
            fs.mkdirSync(path.join(dir, 'sub-01', 'sourcedata'));
            assert.throws(() => preflight(dir), /sourcedata/);
            fs.rmSync(path.join(dir, 'sub-01', 'sourcedata'), {recursive: true});
            preflight(dir);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    it('refuses a missing output folder', () => {
        assert.throws(() => preflight(path.join(os.tmpdir(), 'bl-aimport-no-such-dir')), /ENOENT/);
    });
});

describe('applyPlan', () => {
    const t1Entry = {id: 'e1', subject: '01', session: null, datatype: 'anat', suffix: 'T1w', entities: {},
        brainlife_datatype: 'neuro/anat/t2w', brainlife_tags: ['mine']};
    const datatypesByName = Object.fromEntries(DATATYPES.map(d => [d.name, d]));

    it('applies the brainlife datatype from the plan to the matching dataset', async () => {
        const bids = await walk(FIXTURE);
        const manifest = {e1: ['sub-01/anat/sub-01_T1w.nii.gz', 'sub-01/anat/sub-01_T1w.json']};
        const {datasets, warnings} = applyPlan(bids, {entries: [t1Entry]}, manifest, datatypesByName, FIXTURE);
        assert.deepStrictEqual(warnings, []);
        assert.strictEqual(datasets.length, bids.datasets.length);
        const t1 = datasets.find(d => d.dataset.desc === 'sub-01_T1w.nii.gz');
        assert.strictEqual(t1.dataset.datatype, 'neuro/anat/t2w');
        assert.deepStrictEqual(t1.dataset.datatype_tags, ['mine']);
        const other = datasets.find(d => d.dataset.desc === 'sub-02_ses-1_T1w.nii.gz');
        assert.strictEqual(other.dataset.datatype, 'neuro/anat/t1w');
    });

    it('drops a dataset mapped to a draft datatype, with a warning', async () => {
        const bids = await walk(FIXTURE);
        const entry = Object.assign({}, t1Entry, {brainlife_datatype: 'neuro/anat/draftish'});
        const manifest = {e1: ['sub-01/anat/sub-01_T1w.nii.gz']};
        const {datasets, warnings} = applyPlan(bids, {entries: [entry]}, manifest, datatypesByName, FIXTURE);
        assert.strictEqual(datasets.length, bids.datasets.length - 1);
        assert.ok(!datasets.some(d => d.dataset.desc === 'sub-01_T1w.nii.gz'));
        assert.deepStrictEqual(warnings, ['neuro/anat/draftish is not a registered brainlife datatype (draft): sub-01_T1w goes to project files only']);
    });

    it('leaves a dataset alone when its entry has no brainlife datatype', async () => {
        const bids = await walk(FIXTURE);
        const entry = Object.assign({}, t1Entry, {brainlife_datatype: null});
        const {datasets} = applyPlan(bids, {entries: [entry]}, {e1: ['sub-01/anat/sub-01_T1w.nii.gz']}, datatypesByName, FIXTURE);
        assert.strictEqual(datasets.find(d => d.dataset.desc === 'sub-01_T1w.nii.gz').dataset.datatype, 'neuro/anat/t1w');
    });
});

describe('projectFiles', () => {
    it('lists the metadata files and leaves out object files and participants', async () => {
        const bids = await walk(FIXTURE);
        const files = projectFiles(FIXTURE, bids.datasets);
        for (const f of ['phenotype/moca.tsv', 'README', 'CHANGES', 'dataset_description.json',
            'task-rest_bold.json', 'sub-01/anat/sub-01_T1w.json', 'sub-02/ses-1/sub-02_ses-1_scans.tsv']) {
            assert.ok(files.includes(f), f);
        }
        for (const f of ['participants.tsv', 'participants.json', 'sub-01/anat/sub-01_T1w.nii.gz',
            'sub-01/dwi/sub-01_dwi.bval', 'sub-01/func/sub-01_task-rest_run-1_events.tsv']) {
            assert.ok(!files.includes(f), f);
        }
    });

    it('carries the files of a dropped dataset', async () => {
        const bids = await walk(FIXTURE);
        const kept = bids.datasets.filter(d => d.dataset.desc !== 'sub-01_T1w.nii.gz');
        assert.ok(projectFiles(FIXTURE, kept).includes('sub-01/anat/sub-01_T1w.nii.gz'));
    });

    it('refuses sourcedata and key files', async () => {
        const dir = copyFixture();
        try {
            fs.mkdirSync(path.join(dir, 'sourcedata'));
            fs.writeFileSync(path.join(dir, 'sourcedata', 'x'), 'secret');
            assert.throws(() => projectFiles(dir, []), /sourcedata/);
            fs.rmSync(path.join(dir, 'sourcedata'), {recursive: true});
            fs.writeFileSync(path.join(dir, 'sub-01', 'x.aimport-key.json'), '{}');
            assert.throws(() => projectFiles(dir, []), /aimport-key/);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});

describe('uploadProjectFiles', () => {
    it('asks for a presigned URL and PUTs the bytes', async () => {
        const s = await stub();
        try {
            await uploadProjectFiles(headers, 'p1', FIXTURE, ['phenotype/moca.tsv'], {api: s.api});
            const post = s.calls.find(c => c.method === 'POST');
            assert.strictEqual(post.path, '/warehouse/files/p1/upload/presigned');
            const bytes = fs.readFileSync(path.join(FIXTURE, 'phenotype/moca.tsv'));
            assert.deepStrictEqual(post.body, {fileName: 'phenotype/moca.tsv', fileSize: bytes.length,
                contentType: 'application/octet-stream', prefix: 'bids/'});
            assert.strictEqual(post.headers.authorization, 'Bearer a.b.c');
            const put = s.calls.find(c => c.method === 'PUT');
            assert.strictEqual(put.path, '/s3/p1/bids/phenotype/moca.tsv');
            assert.ok(put.raw.equals(bytes));
            assert.strictEqual(put.headers.authorization, undefined);
        } finally {
            s.srv.close();
        }
    });

    it('fails when the PUT fails', async () => {
        const s = await stub();
        try {
            await assert.rejects(uploadProjectFiles(headers, 'p1', FIXTURE, ['README'], {api: s.api}), /403/);
        } finally {
            s.srv.close();
        }
    });
});
