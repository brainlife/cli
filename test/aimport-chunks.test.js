'use strict';

// bl aimport reference datasets: the chunk map (aimport/chunks.js), micr objects
// (aimport/micr-walk.js), streamed chunk upload (bids-upload.js) and --remote.

const {describe, it, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const v8 = require('v8');
const vm = require('vm');

const bidsUpload = require('../bids-upload');
const chunks = require('../aimport/chunks');
const {preflight, projectFiles} = require('../aimport/upload');
const {micrDatasets} = require('../aimport/micr-walk');
const {run} = require('../bl-aimport');

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

const headers = {Authorization: 'Bearer a.b.c'};
const project = {_id: 'p1', group_id: 7};
const ZARR = 'sub-01/micr/sub-01_sample-01_OCT.ome.zarr';
const ARRAY = ZARR + '/0';
const OME_ZARR = {name: 'neuro/ome-zarr', _id: 'dt-zarr', files: [{id: 'zarr', dirname: 'data.ome.zarr', required: true}]};
const quiet = () => {};

let tmp, bidsDir, input, work;

beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-aimport-chunks-')));
    work = path.join(tmp, 'work');
    bidsDir = path.join(work, 'output', 'bids');
    input = path.join(tmp, 'input');
    // the rebuilt metadata the engine writes for a reference store
    fs.mkdirSync(path.join(bidsDir, ARRAY), {recursive: true});
    fs.writeFileSync(path.join(bidsDir, ZARR, 'zarr.json'), '{"zarr_format": 3, "node_type": "group"}');
    fs.writeFileSync(path.join(bidsDir, ARRAY, 'zarr.json'), '{"zarr_format": 3, "node_type": "array"}');
    fs.writeFileSync(path.join(bidsDir, 'sub-01/micr/sub-01_sample-01_OCT.json'), '{"PixelSize": [1, 1]}');
    fs.writeFileSync(path.join(bidsDir, 'dataset_description.json'), '{"Name": "x", "BIDSVersion": "1.10.0"}');
    // the source store in the input folder: 2 x 2 chunks, c/1/1 missing (the fill value)
    for (const k of ['c/0/0', 'c/0/1', 'c/1/0']) {
        const f = path.join(input, 'store.zarr', '0', ...k.split('/'));
        fs.mkdirSync(path.dirname(f), {recursive: true});
        fs.writeFileSync(f, 'chunk ' + k);
    }
});

afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true});
});

function arrayMeta(source, extra = {}) {
    return Object.assign({source, zarr_format: 3, shape: [4, 4], chunk_grid: [2, 2], separator: '/', codec_bytes_hint: 16}, extra);
}

function chunkMapOf(arrays) {
    return {bidsDir, inputDir: input, arrays};
}

const MANIFEST = {m1: [ZARR]};

// names and sizes of the entries of a tar.gz
function tarEntries(gz) {
    const tar = zlib.gunzipSync(gz);
    const out = [];
    for (let off = 0; off + 512 <= tar.length;) {
        const h = tar.subarray(off, off + 512);
        if (h.every(b => b === 0)) break;
        const name = h.subarray(0, 100).toString().replace(/\0.*$/s, '');
        const prefix = h.subarray(345, 500).toString().replace(/\0.*$/s, '');
        const size = parseInt(h.subarray(124, 136).toString().replace(/\0.*$/s, '').trim() || '0', 8);
        out.push({name: prefix ? prefix + '/' + name : name, size, body: tar.subarray(off + 512, off + 512 + size).toString()});
        off += 512 + Math.ceil(size / 512) * 512;
    }
    return out;
}

// a local stand-in for amaretti and warehouse; the upload body is counted, and kept only when small
function stub({keep = true} = {}) {
    const rec = {uploadBytes: 0, upload: [], registered: []};
    const srv = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        const r = req.method + ' ' + url.pathname;
        const send = obj => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(obj));
        };
        if (r === 'POST /amaretti/task/upload/t1') {
            req.on('data', c => {
                rec.uploadBytes += c.length;
                if (keep) rec.upload.push(c);
            });
            return req.on('end', () => send({}));
        }
        const body = [];
        req.on('data', c => body.push(c));
        req.on('end', () => {
            if (r === 'GET /amaretti/instance') return send({instances: [{_id: 'i1', name: 'upload.7'}]});
            if (r === 'GET /warehouse/datatype') return send({datatypes: [OME_ZARR]});
            if (r === 'GET /warehouse/dataset') return send({count: 0});
            if (r === 'POST /amaretti/task') return send({task: {_id: 't1', name: 'upload.7'}});
            if (r === 'GET /amaretti/task') return send({tasks: [{_id: 't1', status: 'finished', config: {_outputs: [{id: 'output'}]}}]});
            if (r === 'POST /warehouse/dataset') {
                rec.registered.push(JSON.parse(Buffer.concat(body)));
                return send({_id: 'd1'});
            }
            res.writeHead(404);
            res.end();
        });
    });
    return new Promise(resolve => srv.listen(0, '127.0.0.1', () => {
        const base = 'http://127.0.0.1:' + srv.address().port;
        resolve({srv, rec, api: {amaretti: base + '/amaretti', warehouse: base + '/warehouse'}});
    }));
}

function micrItem() {
    return {dataset: {datatype: 'neuro/ome-zarr', desc: 'sub-01_sample-01_OCT.ome.zarr', datatype_tags: ['OCT'], tags: [],
        meta: {subject: '01', sample: '01'}}, files: {'data.ome.zarr': path.join(bidsDir, ZARR)}};
}

// a remote store served by a local server: fetch is given https URLs and sends them here,
// with the requested host in x-host (the URL rules refuse localhost, as they should)
function remoteServer(routes) {
    const hosts = [];
    const srv = http.createServer((req, res) => {
        const host = req.headers['x-host'];
        hosts.push(host + req.url);
        const route = routes(host, req.url);
        res.writeHead(route.status, route.headers || {});
        res.end(route.body || '');
    });
    return new Promise(resolve => srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        const fakeFetch = (url, init) => {
            const u = new URL(url);
            assert.strictEqual(u.protocol, 'https:');
            assert.strictEqual(init.redirect, 'manual');
            return fetch('http://127.0.0.1:' + port + u.pathname, Object.assign({}, init,
                {headers: Object.assign({}, init.headers, {'x-host': u.host})}));
        };
        resolve({srv, hosts, fetch: fakeFetch});
    }));
}

async function readAll(stream) {
    const parts = [];
    for await (const c of stream) parts.push(c);
    return Buffer.concat(parts).toString();
}

describe('chunk keys', () => {
    it('enumerates and checks v3 and v2 keys like the engine', () => {
        assert.deepStrictEqual([...chunks.chunkKeys(arrayMeta({input: 'x'}))], ['c/0/0', 'c/0/1', 'c/1/0', 'c/1/1']);
        const v2 = {zarr_format: 2, shape: [3, 2], chunk_grid: [2, 2], separator: '.'};
        assert.deepStrictEqual([...chunks.chunkKeys(v2)], ['0.0', '1.0']);
        const v3v2 = {zarr_format: 3, key_encoding: 'v2', shape: [2], chunk_grid: [1], separator: '/'};
        assert.deepStrictEqual([...chunks.chunkKeys(v3v2)], ['0', '1']);
        assert.ok(chunks.keyOk(arrayMeta({}), 'c/1/1'));
        for (const bad of ['c/2/0', 'c/../0', '0/0', 'c/00/0', 'c/0', 'c/0/0/0']) assert.ok(!chunks.keyOk(arrayMeta({}), bad), bad);
    });

    it('openSource takes chunk keys only', async () => {
        for (const bad of ['../x', 'zarr.json', '/etc/passwd', 'c/../../x']) {
            await assert.rejects(chunks.openSource({input: 'store.zarr/0'}, bad, {inputDir: input}), bad);
        }
    });
});

describe('preflight with a chunk map', () => {
    const refuse = (arrays, re) => assert.throws(() => preflight(bidsDir, {chunkMap: chunkMapOf(arrays), manifest: MANIFEST, inputDir: input}), re);

    it('accepts a map whose arrays are inside a written .ome.zarr and whose source is in the input', () => {
        preflight(bidsDir, {chunkMap: chunkMapOf({[ARRAY]: arrayMeta({input: 'store.zarr/0'})}), manifest: MANIFEST, inputDir: input});
        preflight(bidsDir, {chunkMap: chunkMapOf({[ARRAY]: arrayMeta({url: 'https://bucket.s3.amazonaws.com/a.zarr/0'})}),
            manifest: MANIFEST, inputDir: input});
    });

    it('test_preflight_refuses: a prefix outside the manifest .ome.zarr', () => {
        fs.mkdirSync(path.join(bidsDir, 'sub-01/micr/other/0'), {recursive: true});
        refuse({'sub-01/micr/other/0': arrayMeta({input: 'store.zarr/0'})}, /outside the written OME-Zarr/);
        refuse({[ZARR]: arrayMeta({input: 'store.zarr/0'})}, /outside the written OME-Zarr/); // not strictly inside
        refuse({[ZARR + '/../../x/0']: arrayMeta({input: 'store.zarr/0'})}, /outside the output/);
        refuse({['/' + ARRAY]: arrayMeta({input: 'store.zarr/0'})}, /outside the output/);
    });

    it('test_preflight_refuses: a .. or absolute source', () => {
        fs.mkdirSync(path.join(tmp, 'outside'));
        refuse({[ARRAY]: arrayMeta({input: '../outside'})}, /leaves the input folder/);
        refuse({[ARRAY]: arrayMeta({input: 'store.zarr/%2e%2e/%2e%2e/outside'})}, /leaves the input folder/);
        refuse({[ARRAY]: arrayMeta({input: path.join(tmp, 'outside')})}, /leaves the input folder/);
    });

    it('test_preflight_refuses: a symlinked source escaping the input', () => {
        fs.mkdirSync(path.join(tmp, 'outside'));
        fs.symlinkSync(path.join(tmp, 'outside'), path.join(input, 'link'));
        refuse({[ARRAY]: arrayMeta({input: 'link'})}, /symlink/);
        refuse({[ARRAY]: arrayMeta({input: 'link/0'})}, /symlink/);
    });

    it('test_preflight_refuses: http:, file:, userinfo, query, IP and localhost URLs', () => {
        for (const url of ['http://bucket.s3.amazonaws.com/a.zarr', 'file:///etc/a.zarr', 'https://u:p@example.org/a.zarr',
            'https://example.org/a.zarr?X-Amz-Signature=1', 'https://127.0.0.1/a.zarr', 'https://localhost/a.zarr',
            'https://example.org/a/../b.zarr', 's3://bucket/a.zarr']) {
            refuse({[ARRAY]: arrayMeta({url})}, /refusing to upload/);
        }
    });

    it('test_preflight_refuses: a *.chunks.json inside the output', () => {
        fs.writeFileSync(path.join(bidsDir, 'bids.chunks.json'), '{}');
        assert.throws(() => preflight(bidsDir), /chunk maps never leave this machine/);
    });

    it('still refuses symlinks in the output, and a source of two kinds', () => {
        refuse({[ARRAY]: arrayMeta({input: 'store.zarr/0', url: 'https://example.org/a'})}, /no valid source/);
        fs.symlinkSync(path.join(input, 'store.zarr/0/c/0/0'), path.join(bidsDir, ARRAY, 'c'));
        assert.throws(() => preflight(bidsDir, {chunkMap: chunkMapOf({[ARRAY]: arrayMeta({input: 'store.zarr/0'})}),
            manifest: MANIFEST, inputDir: input}), /symbolic link/);
    });

    it('loadChunkMap reads the map /status names, never one under bids/', () => {
        assert.strictEqual(chunks.loadChunkMap(work, bidsDir, input, MANIFEST, undefined), null);
        fs.writeFileSync(path.join(work, 'output', 'bids.chunks.json'),
            JSON.stringify({version: 1, arrays: {[ARRAY]: arrayMeta({input: 'store.zarr/0'})}}));
        const map = chunks.loadChunkMap(work, bidsDir, input, MANIFEST, 'output/bids.chunks.json');
        assert.deepStrictEqual(Object.keys(map.arrays), [ARRAY]);
        assert.throws(() => chunks.loadChunkMap(work, bidsDir, input, MANIFEST, '../bids.chunks.json'));
        fs.writeFileSync(path.join(bidsDir, 'x.chunks.json'), '{"version": 1, "arrays": {}}');
        assert.throws(() => chunks.loadChunkMap(work, bidsDir, input, MANIFEST, 'output/bids/x.chunks.json'), /inside the output/);
        fs.writeFileSync(path.join(work, 'output', 'bids.chunks.json'), '{"version": 2, "arrays": {}}');
        assert.throws(() => chunks.loadChunkMap(work, bidsDir, input, MANIFEST, 'output/bids.chunks.json'), /unknown format/);
    });
});

describe('streamed upload', () => {
    it('test_missing_chunk_skipped: the chunks go into the object tar, a missing one is skipped', async () => {
        const s = await stub();
        try {
            const lines = [];
            const chunkMap = chunkMapOf({[ARRAY]: arrayMeta({input: 'store.zarr/0'})});
            const result = await bidsUpload.uploadDatasets(headers, project, [micrItem()],
                {api: s.api, log: (...a) => lines.push(a.join(' ')), chunkMap});
            assert.deepStrictEqual(result.uploaded, ['sub-01_sample-01_OCT.ome.zarr']);
            const entries = tarEntries(Buffer.concat(s.rec.upload));
            assert.deepStrictEqual(entries.map(e => e.name).sort(), [
                'data.ome.zarr/0/c/0/0', 'data.ome.zarr/0/c/0/1', 'data.ome.zarr/0/c/1/0',
                'data.ome.zarr/0/zarr.json', 'data.ome.zarr/zarr.json']);
            assert.strictEqual(entries.find(e => e.name === 'data.ome.zarr/0/c/1/0').body, 'chunk c/1/0');
            assert.ok(lines.some(l => l.includes('streamed 3 chunk(s)') && l.includes('1 missing')), lines.join('\n'));
            // the input folder never shows in what is printed
            assert.ok(!lines.some(l => l.includes(input)), lines.join('\n'));
            assert.strictEqual(s.rec.registered.length, 1);
        } finally {
            s.srv.close();
        }
    });

    it('test_missing_chunk_skipped: a remote 404 (or S3 403) is the fill value', async () => {
        const r = await remoteServer((host, url) => url.endsWith('/c/0/0') ? {status: 200, headers: {'Content-Length': '3'}, body: 'abc'}
            : url.endsWith('/c/0/1') ? {status: 403} : {status: 404});
        try {
            const src = {url: 'https://bucket.s3.amazonaws.com/a.zarr/0'};
            const got = await chunks.openSource(src, 'c/0/0', {fetch: r.fetch});
            assert.strictEqual(got.size, 3);
            assert.strictEqual(await readAll(got.stream), 'abc');
            assert.strictEqual(await chunks.openSource(src, 'c/0/1', {fetch: r.fetch}), null);
            assert.strictEqual(await chunks.openSource(src, 'c/1/1', {fetch: r.fetch}), null);
        } finally {
            r.srv.close();
        }
    });

    it('test_redirect_other_host_refused (same host and *.amazonaws.com are followed)', async () => {
        const r = await remoteServer((host, url) => {
            if (host === 'data.example.org' && url === '/a.zarr/0/c/0/0') return {status: 302, headers: {Location: 'https://evil.example.net/x'}};
            if (host === 'data.example.org' && url === '/a.zarr/0/c/0/1') return {status: 302, headers: {Location: '/moved/c/0/1'}};
            if (host === 'data.example.org' && url === '/a.zarr/0/c/1/0') {
                return {status: 307, headers: {Location: 'https://bucket.s3.us-east-1.amazonaws.com/a/c/1/0'}};
            }
            if (host === 'data.example.org' && url === '/a.zarr/0/c/1/1') return {status: 302, headers: {Location: 'http://bucket.s3.amazonaws.com/x'}};
            if (host === 'data.example.org' && url === '/moved/c/0/1') return {status: 200, headers: {'Content-Length': '2'}, body: 'ok'};
            if (host === 'bucket.s3.us-east-1.amazonaws.com') return {status: 200, headers: {'Content-Length': '2'}, body: 's3'};
            return {status: 200, headers: {'Content-Length': '4'}, body: 'evil'};
        });
        try {
            const src = {url: 'https://data.example.org/a.zarr/0'};
            await assert.rejects(chunks.openSource(src, 'c/0/0', {fetch: r.fetch}), /redirect to another host refused/);
            await assert.rejects(chunks.openSource(src, 'c/1/1', {fetch: r.fetch}), /redirect to another host refused/);
            assert.ok(!r.hosts.some(h => h.startsWith('evil.example.net')), r.hosts.join('\n'));
            assert.strictEqual(await readAll((await chunks.openSource(src, 'c/0/1', {fetch: r.fetch})).stream), 'ok');
            assert.strictEqual(await readAll((await chunks.openSource(src, 'c/1/0', {fetch: r.fetch})).stream), 's3');
        } finally {
            r.srv.close();
        }
    });

    it('a chunk sent gzip-encoded is refused (its size would not be the stored size)', async () => {
        const r = await remoteServer(() => ({status: 200, headers: {'Content-Encoding': 'gzip', 'Content-Length': '20'},
            body: zlib.gzipSync('x')}));
        try {
            await assert.rejects(chunks.openSource({url: 'https://data.example.org/a'}, 'c/0/0', {fetch: r.fetch}), /encoded/);
        } finally {
            r.srv.close();
        }
    });

    it('test_streams_without_buffering: a 64 MiB chunk goes up with under 16 MiB of memory growth', async () => {
        const big = path.join(input, 'big.zarr', '0', 'c', '0', '0');
        fs.mkdirSync(path.dirname(big), {recursive: true});
        const SIZE = 64 * 2 ** 20;
        const fd = fs.openSync(big, 'w');
        // not sparse: random-ish data that does not compress away
        const block = Buffer.alloc(2 ** 20);
        for (let i = 0; i < SIZE / block.length; i++) {
            for (let j = 0; j < block.length; j += 4) block.writeUInt32LE((i * 2654435761 + j * 40503) >>> 0, j);
            fs.writeSync(fd, block);
        }
        fs.closeSync(fd);
        const chunkMap = chunkMapOf({[ARRAY]: arrayMeta({input: 'big.zarr/0'}, {shape: [8192, 8192], chunk_grid: [8192, 8192]})});
        const s = await stub({keep: false});
        try {
            gc();
            const used = () => {
                const m = process.memoryUsage();
                return m.heapUsed + m.arrayBuffers;
            };
            const base = used();
            let peak = 0;
            const timer = setInterval(() => {
                gc();
                peak = Math.max(peak, used() - base);
            }, 10);
            try {
                await bidsUpload.uploadDatasets(headers, project, [micrItem()], {api: s.api, log: quiet, chunkMap});
            } finally {
                clearInterval(timer);
            }
            assert.ok(s.rec.uploadBytes > SIZE / 2, 'the chunk was sent: ' + s.rec.uploadBytes);
            assert.ok(peak < 16 * 2 ** 20, 'memory growth ' + (peak / 2 ** 20).toFixed(1) + ' MiB');
        } finally {
            s.srv.close();
        }
    });

    it('a chunk read error fails the upload instead of sending a short object', async () => {
        const s = await stub();
        try {
            const chunkMap = chunkMapOf({[ARRAY]: arrayMeta({input: 'store.zarr/0'})});
            const openSource = async () => ({stream: fs.createReadStream(path.join(input, 'store.zarr/0/c/0/0')), size: 999, mtime: new Date()});
            await assert.rejects(bidsUpload.uploadDatasets(headers, project, [micrItem()], {api: s.api, log: quiet, chunkMap, openSource}));
            assert.strictEqual(s.rec.registered.length, 0);
        } finally {
            s.srv.close();
        }
    });

    it('test_no_chunk_map_unchanged: without a chunk map the tar holds the written files only', async () => {
        const {archive, feed} = await bidsUpload.buildArchive(micrItem(), {log: quiet});
        const parts = [];
        archive.on('data', c => parts.push(c));
        const done = new Promise(resolve => archive.on('end', resolve));
        await feed();
        archive.finalize();
        await done;
        assert.deepStrictEqual(tarEntries(Buffer.concat(parts)).map(e => e.name).sort(),
            ['data.ome.zarr/0/zarr.json', 'data.ome.zarr/zarr.json']);
    });
});

describe('micr objects', () => {
    const PLAN = {entries: [
        {id: 'm1', modality: 'micr', subject: '01', session: null, datatype: 'micr', suffix: 'OCT',
            entities: {sample: '01'}, brainlife_datatype: 'neuro/ome-zarr', brainlife_tags: ['OCT'], exclude: false},
        {id: 'e1', modality: 'mri', subject: '01', session: null, datatype: 'anat', suffix: 'T1w', entities: {},
            brainlife_datatype: 'neuro/anat/t1w', brainlife_tags: []},
    ]};

    it('test_micr_objects_mapped: one neuro/ome-zarr object per micr entry, tagged OCT', () => {
        const out = micrDatasets(bidsDir, PLAN, Object.assign({e1: ['sub-01/anat/sub-01_T1w.nii.gz']}, MANIFEST),
            {'neuro/ome-zarr': OME_ZARR});
        assert.deepStrictEqual(out.warnings, []);
        assert.deepStrictEqual(out.datasets, [{
            dataset: {datatype: 'neuro/ome-zarr', desc: 'sub-01_sample-01_OCT.ome.zarr', datatype_tags: ['OCT'], tags: [],
                meta: {subject: '01', sample: '01'}},
            files: {'data.ome.zarr': path.join(bidsDir, ZARR)},
        }]);
        // the store is in the object; its sidecar goes to project files
        assert.deepStrictEqual(projectFiles(bidsDir, out.datasets),
            ['dataset_description.json', 'sub-01/micr/sub-01_sample-01_OCT.json']);
    });

    it('an unregistered datatype is warned about and the store is held back', () => {
        const out = micrDatasets(bidsDir, PLAN, MANIFEST, {});
        assert.strictEqual(out.datasets.length, 0);
        assert.ok(out.warnings[0].includes('not a registered brainlife datatype'));
        assert.deepStrictEqual(projectFiles(bidsDir, [], out.held), ['dataset_description.json', 'sub-01/micr/sub-01_sample-01_OCT.json']);
    });
});

// --- bl aimport (run) ------------------------------------------------------------------------

const PROJECT = {_id: '0123456789abcdef01234567', group_id: 7};

function fakeEngine(status, plan) {
    const calls = [];
    let follows = 0;
    const engine = {
        base: 'http://127.0.0.1:9999', token: 'tok',
        async request(method, p, body) {
            calls.push({method, path: p, body});
            if (method === 'GET' && p === '/plan') return plan;
            if (method === 'GET' && p === '/status') return status;
            return {};
        },
        async follow(onEvent) {
            const ev = {stage: ++follows === 1 ? 'planned' : 'validated', message: null};
            onEvent(ev);
            return ev;
        },
        async stop() {},
    };
    class Engine {
        static async start() {
            return engine;
        }
        async stop() {}
    }
    return {Engine, calls};
}

function runSetup({status, plan, answers = [], opts = {}}) {
    const eng = fakeEngine(status, plan);
    const rec = {};
    const out = [];
    const prompts = [];
    const deps = {
        Engine: eng.Engine,
        prompt: async q => {
            prompts.push(q);
            return answers.length ? answers.shift() : '';
        },
        upload: {
            async uploadDatasets(h, p, datasets, o) {
                rec.datasets = datasets;
                rec.opts = o;
                return {uploaded: datasets.map(d => d.dataset.desc), skipped: []};
            },
            async updateParticipants() {},
            async uploadProjectFiles(h, p, dir, files) {
                rec.files = files;
            },
        },
        validate: async () => ({ok: true, errors: [], warnings: []}),
        log: (...a) => out.push(a.join(' ')),
        error: (...a) => out.push(a.join(' ')),
        loadJwt: async () => 'a.b.c',
        queryProjects: async () => [PROJECT],
        queryAllDatatypes: async () => [OME_ZARR, {name: 'neuro/anat/t1w', _id: 'dt-t1w'}],
        projectSubjects: async () => ({existing_subjects: [], existing_sessions: {}}),
        walk: async () => ({datasets: [], participants: [], participants_json: null}),
        openUrl: async () => {},
        exit: () => {},
    };
    const o = Object.assign({folder: input, project: PROJECT._id, work, keys: path.join(tmp, 'keys'), yes: true, upload: true}, opts);
    return {eng, rec, out, prompts, deps, opts: o};
}

const MICR_PLAN = {dataset_name: 'x', deface_method: 'pydeface', warnings: [], ancillary: [], entries: [
    {id: 'm1', modality: 'micr', subject: '01', session: null, datatype: 'micr', suffix: 'OCT', entities: {sample: '01'},
        deface: false, status: 'ok', source: 'heuristic', confidence: 1, brainlife_datatype: 'neuro/ome-zarr', brainlife_tags: ['OCT']},
]};
const MICR_STATUS = {stage: 'validated', message: null, manifest: MANIFEST, chunk_map: 'output/bids.chunks.json',
    validation: {ok: true, error_count: 0, warning_count: 0, errors: [], warnings: []}};

describe('bl aimport with reference datasets', () => {
    beforeEach(() => {
        fs.writeFileSync(path.join(work, 'output', 'bids.chunks.json'),
            JSON.stringify({version: 1, arrays: {[ARRAY]: arrayMeta({input: 'store.zarr/0'})}}));
    });

    it('test_remote_flag_forwarded: --remote goes to POST /scan as remote', async () => {
        const url = 'https://bucket.s3.amazonaws.com/donor/a.zarr';
        const t = runSetup({status: MICR_STATUS, plan: MICR_PLAN, opts: {remote: [url, 's3://bucket/b.zarr']}});
        assert.strictEqual(await run(t.opts, t.deps), 0, t.out.join('\n'));
        const scan = t.eng.calls.find(c => c.path === '/scan');
        assert.deepStrictEqual(scan.body.remote, [url, 's3://bucket/b.zarr']);
        assert.ok(!t.out.some(l => l.includes('donor')), 'a remote URL is never printed');
    });

    it('--remote refuses anything but https:// and s3:// (exit 2, before docker)', async () => {
        const t = runSetup({status: MICR_STATUS, plan: MICR_PLAN, opts: {remote: ['http://example.org/a.zarr']}});
        assert.strictEqual(await run(t.opts, t.deps), 2);
        assert.strictEqual(t.eng.calls.length, 0);
    });

    it('uploads the micr object with the chunk map, after the size report', async () => {
        const t = runSetup({status: MICR_STATUS, plan: MICR_PLAN});
        assert.strictEqual(await run(t.opts, t.deps), 0, t.out.join('\n'));
        assert.deepStrictEqual(t.rec.datasets.map(d => [d.dataset.datatype, d.dataset.datatype_tags]), [['neuro/ome-zarr', ['OCT']]]);
        assert.deepStrictEqual(Object.keys(t.rec.opts.chunkMap.arrays), [ARRAY]);
        assert.deepStrictEqual(t.rec.files, ['dataset_description.json', 'sub-01/micr/sub-01_sample-01_OCT.json']);
        const report = t.out.find(l => / objects, .* from local output, .* streamed from sources/.test(l));
        // 3 chunks of 11 bytes each from the input
        assert.strictEqual(report, '1 objects, 0.00 GB from local output, 0.00 GB streamed from sources');
        assert.deepStrictEqual(t.prompts, []); // --yes
        assert.ok(!t.out.some(l => l.includes(input)), t.out.join('\n'));
    });

    it('without --yes, asks before streaming; N uploads nothing', async () => {
        const t = runSetup({status: MICR_STATUS, plan: MICR_PLAN, answers: ['y', 'n'], opts: {yes: false}});
        assert.strictEqual(await run(t.opts, t.deps), 0, t.out.join('\n'));
        assert.deepStrictEqual(t.prompts, ['Approve this plan? [y/N/e(dit)] ', 'Upload? [y/N] ']);
        assert.strictEqual(t.rec.datasets, undefined);
    });

    it('a chunk map that escapes the input stops before any upload (exit 1)', async () => {
        fs.writeFileSync(path.join(work, 'output', 'bids.chunks.json'),
            JSON.stringify({version: 1, arrays: {[ARRAY]: arrayMeta({input: '../work'})}}));
        const t = runSetup({status: MICR_STATUS, plan: MICR_PLAN});
        assert.strictEqual(await run(t.opts, t.deps), 1);
        assert.ok(t.out.some(l => l.includes('leaves the input folder')), t.out.join('\n'));
        assert.strictEqual(t.rec.datasets, undefined);
    });

    it('test_no_chunk_map_unchanged: a phase-1 run sends no remote, passes no chunk map and asks nothing more', async () => {
        const status = {stage: 'validated', message: null, manifest: {e1: ['sub-01/anat/sub-01_T1w.nii.gz']},
            validation: {ok: true, error_count: 0, warning_count: 0, errors: [], warnings: []}};
        const plan = {dataset_name: 'x', deface_method: 'pydeface', warnings: [], ancillary: [], entries: [
            {id: 'e1', subject: '01', session: null, datatype: 'anat', suffix: 'T1w', entities: {}, deface: true, status: 'ok',
                source: 'heuristic', confidence: 1, brainlife_datatype: 'neuro/anat/t1w', brainlife_tags: []}]};
        fs.rmSync(path.join(work, 'output', 'bids.chunks.json'));
        fs.rmSync(path.join(bidsDir, 'sub-01', 'micr'), {recursive: true});
        const t = runSetup({status, plan, answers: ['y'], opts: {yes: false}});
        assert.strictEqual(await run(t.opts, t.deps), 0, t.out.join('\n'));
        const scan = t.eng.calls.find(c => c.path === '/scan');
        assert.ok(!('remote' in scan.body));
        assert.strictEqual(t.rec.opts.chunkMap, null);
        assert.deepStrictEqual(t.prompts, ['Approve this plan? [y/N/e(dit)] ']);
    });
});
