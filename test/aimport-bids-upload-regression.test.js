'use strict';

// bl bids upload regression: the snapshot in fixtures/bids-upload-snapshot.json was
// recorded from bl-bids-upload.js before its upload code moved to bids-upload.js
// (all objects "already uploaded"). The moved code must send the same queries and
// print the same lines.

const {describe, it} = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const nodeUtil = require('util');

const bidsUpload = require('../bids-upload');
const walker = require('../bids-walker');
const snapshot = require('./fixtures/bids-upload-snapshot.json');

const ROOT = path.join(__dirname, 'fixtures', 'bids-mini');
const headers = {Authorization: 'Bearer a.b.c'};
const project = {_id: 'p1', group_id: 7};
const DATATYPES = [
    {name: 'neuro/anat/t1w', _id: 'dt-t1w'}, {name: 'neuro/anat/t2w', _id: 'dt-t2w'},
    {name: 'neuro/dwi', _id: 'dt-dwi'}, {name: 'neuro/func/task', _id: 'dt-func'},
];

function walk() {
    return new Promise((resolve, reject) => walker.walk(ROOT, (err, bids) => err ? reject(err) : resolve(bids)));
}

function stub() {
    const calls = [];
    const srv = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const url = new URL(req.url, 'http://x');
            const raw = Buffer.concat(chunks).toString();
            calls.push({method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : null});
            const send = obj => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(obj)); };
            const r = req.method + ' ' + url.pathname;
            if (r === 'GET /amaretti/instance') return send({instances: [{_id: 'i1', name: 'upload.7'}]});
            if (r === 'GET /warehouse/datatype') return send({datatypes: DATATYPES});
            if (r === 'GET /warehouse/dataset') return send({count: 1});
            if (r === 'PUT /warehouse/participant/p1') return send({});
            res.writeHead(404); res.end();
        });
    });
    return new Promise(resolve => srv.listen(0, '127.0.0.1', () => {
        const base = 'http://127.0.0.1:' + srv.address().port;
        resolve({srv, calls, api: {amaretti: base + '/amaretti', warehouse: base + '/warehouse'}});
    }));
}

describe('bl bids upload regression', () => {
    it('the walker gives the same dataset list', async () => {
        const bids = await walk();
        const datasets = bids.datasets.map(d => ({
            dataset: d.dataset,
            files: Object.fromEntries(Object.entries(d.files).map(([k, v]) => [k, path.relative(ROOT, v)])),
        }));
        assert.deepStrictEqual(datasets, snapshot.datasets);
    });

    it('the moved upload code sends the same queries and prints the same lines', async () => {
        const s = await stub();
        const lines = [];
        const fmt = (...a) => nodeUtil.format(...a).split(ROOT).join('<root>');
        try {
            const bids = await walk();
            const result = await bidsUpload.uploadDatasets(headers, project, bids.datasets, {api: s.api, log: (...a) => lines.push(fmt(...a))});
            assert.deepStrictEqual(result.uploaded, []);
            assert.deepStrictEqual(result.skipped, snapshot.datasets.map(d => d.dataset.desc));

            const finds = s.calls.filter(c => c.method === 'GET' && c.path === '/warehouse/dataset').map(c => JSON.parse(c.query.find));
            assert.deepStrictEqual(finds, snapshot.finds.map(f => f.find));

            const start = snapshot.lines.indexOf('uploading an object...');
            const end = snapshot.lines.findIndex(l => l.startsWith('BIDS data uploaded'));
            assert.deepStrictEqual(lines, snapshot.lines.slice(start, end));
        } finally {
            s.srv.close();
        }
    });

    it('updateParticipants sends the same body and prints the same line', async () => {
        const s = await stub();
        const saved = console.info;
        const lines = [];
        console.info = (...a) => lines.push(nodeUtil.format(...a));
        try {
            const bids = await walk();
            await bidsUpload.updateParticipants(headers, project, bids, {api: s.api});
            const put = s.calls.find(c => c.method === 'PUT');
            assert.strictEqual(put.path, '/warehouse/participant/p1');
            assert.deepStrictEqual(put.body, snapshot.participants_put[0].body);
            assert.deepStrictEqual(lines, ['updating participants/column data']);
        } finally {
            console.info = saved;
            s.srv.close();
        }
    });
});
