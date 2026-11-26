'use strict';

// bl bids upload: BIDS tables -> warehouse /table (local stub, no network)

const {describe, it} = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {classify, sidecarCandidates, collectTables, uploadTables} = require('../bids-tables');

function write(root, rel, text) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true});
    fs.writeFileSync(path.join(root, rel), text);
}

function bidsTables() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bids-tables-'));
    write(root, 'participants.tsv', 'participant_id\tage\nsub-01\t30\n');
    write(root, 'phenotype/bdi.tsv', 'participant_id\tscore\nsub-01\t12\n');
    write(root, 'phenotype/bdi.json', JSON.stringify({score: {Description: 'BDI total'}, MeasurementToolMetadata: {}}));
    write(root, 'sessions.json', JSON.stringify({weight: {Units: 'kg'}}));
    write(root, 'sub-01/sub-01_sessions.tsv', 'session_id\tweight\nses-pre\t70\n');
    write(root, 'sub-02/sub-02_sessions.tsv', 'session_id\tweight\theight\nses-pre\t60\t170\n');
    write(root, 'sub-01/ses-pre/sub-01_ses-pre_scans.tsv', 'filename\tacq_time\nanat/sub-01_ses-pre_T1w.nii.gz\t10:00\n');
    write(root, 'sub-01/ses-pre/func/sub-01_ses-pre_task-rest_events.tsv', 'onset\n0\n');
    return root;
}

function stub(handler) {
    const calls = [];
    const srv = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
            calls.push({method: req.method, path: req.url, body, auth: req.headers.authorization});
            const [status, type, payload] = handler(req, body);
            res.writeHead(status, {'Content-Type': type});
            res.end(typeof payload == 'string' ? payload : JSON.stringify(payload));
        });
    });
    return new Promise(resolve => srv.listen(0, '127.0.0.1', () => {
        resolve({calls, api: {warehouse: 'http://127.0.0.1:' + srv.address().port + '/warehouse'}, close: () => srv.close()});
    }));
}

const project = {_id: 'p1'};
const headers = {Authorization: 'Bearer a.b.c'};

describe('bids-tables', () => {
    it('classifies tables like the warehouse', () => {
        assert.deepStrictEqual(classify('phenotype/bdi.tsv'), {kind: 'phenotype', name: 'phenotype/bdi'});
        assert.deepStrictEqual(classify('sub-01/ses-pre/sub-01_ses-pre_scans.tsv'),
            {kind: 'scans', name: 'scans', subject: '01', session: 'pre'});
        assert.strictEqual(classify('sub-01/func/sub-01_task-rest_events.tsv'), null);
    });

    it('lists sidecars in BIDS inheritance order', () => {
        assert.deepStrictEqual(sidecarCandidates('sub-01/sub-01_sessions.tsv'),
            ['sessions.json', 'sub-01_sessions.json', 'sub-01/sessions.json', 'sub-01/sub-01_sessions.json']);
        assert.deepStrictEqual(sidecarCandidates('phenotype/bdi.tsv'), ['phenotype/bdi.json']);
    });

    it('merges per-subject files and adds participant_id / session_id', () => {
        const {tables, warnings} = collectTables(bidsTables());
        assert.deepStrictEqual(warnings, []);
        const byName = Object.fromEntries(tables.map(t => [t.name, t]));
        assert.deepStrictEqual(Object.keys(byName).sort(), ['phenotype/bdi', 'scans', 'sessions']);
        assert.deepStrictEqual(JSON.parse(byName['phenotype/bdi'].json), {score: {Description: 'BDI total'}});
        assert.strictEqual(byName.sessions.tsv,
            'participant_id\tsession_id\tweight\theight\nsub-01\tses-pre\t70\t\nsub-02\tses-pre\t60\t170\n');
        assert.deepStrictEqual(JSON.parse(byName.sessions.json), {weight: {Units: 'kg'}});
        assert.strictEqual(byName.scans.tsv,
            'participant_id\tsession_id\tfilename\tacq_time\nsub-01\tses-pre\tanat/sub-01_ses-pre_T1w.nii.gz\t10:00\n');
        assert.strictEqual(byName.scans.json, undefined);
    });

    it('uploads each table to /table/<project>', async () => {
        const s = await stub(() => [200, 'application/json', {table: {_id: 'x'}}]);
        const logs = [];
        try {
            assert.strictEqual(await uploadTables(headers, project, bidsTables(), {api: s.api, log: m => logs.push(m)}), 3);
        } finally { s.close(); }
        assert.deepStrictEqual(logs, []);
        assert(s.calls.every(c => c.method == 'PUT' && c.path == '/warehouse/table/p1' && c.auth == 'Bearer a.b.c'));
        assert.deepStrictEqual(s.calls.map(c => c.body.name).sort(), ['phenotype/bdi', 'scans', 'sessions']);
        assert(!('json' in s.calls.find(c => c.body.name == 'scans').body));
    });

    it('a warehouse without /table is reported once', async () => {
        const s = await stub(() => [404, 'text/html', '<pre>Cannot PUT /warehouse/table/p1</pre>']);
        const logs = [];
        try {
            assert.strictEqual(await uploadTables(headers, project, bidsTables(), {api: s.api, log: m => logs.push(m)}), 0);
        } finally { s.close(); }
        assert.deepStrictEqual(logs, ['! this brainlife.io has no table API yet; tables were not uploaded']);
        assert.strictEqual(s.calls.length, 1);
    });

    it('a failing table does not stop the others', async () => {
        const s = await stub((req, body) => body.name == 'sessions'
            ? [400, 'application/json', {message: 'bad table'}] : [200, 'application/json', {table: {}}]);
        const logs = [];
        try {
            assert.strictEqual(await uploadTables(headers, project, bidsTables(), {api: s.api, log: m => logs.push(m)}), 2);
        } finally { s.close(); }
        assert.deepStrictEqual(logs, ['! table sessions was not uploaded: bad table']);
    });

    it('reports unreadable tables and bad sidecars', () => {
        const root = bidsTables();
        fs.symlinkSync(path.join(root, 'annex-missing'), path.join(root, 'phenotype', 'stai.tsv'));
        write(root, 'samples.tsv', 'sample_id\tparticipant_id\ns1\tsub-01\n');
        write(root, 'samples.json', '{bad');
        const {tables, warnings} = collectTables(root);
        assert(tables.some(t => t.name == 'samples'));
        assert.deepStrictEqual(warnings.sort(),
            ['phenotype/stai.tsv: can not be read (ENOENT)', 'samples.json: sidecar json could not be parsed']);
    });
});
