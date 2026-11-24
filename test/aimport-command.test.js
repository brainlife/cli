'use strict';

const {describe, it, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {run, projectSubjects} = require('../bl-aimport');
const {EngineError} = require('../aimport/engine');

const FIXTURE = path.join(__dirname, 'fixtures', 'bids-mini');
const PROJECT = {_id: '0123456789abcdef01234567', group_id: 7};
const DATATYPES = [
    {name: 'neuro/anat/t1w', _id: 'dt-t1w'}, {name: 'neuro/anat/t2w', _id: 'dt-t2w'},
    {name: 'neuro/dwi', _id: 'dt-dwi'}, {name: 'neuro/func/task', _id: 'dt-func'},
];
const PLAN = {
    dataset_name: 'pilot', deface_method: 'pydeface', warnings: [], ancillary: [],
    entries: [{id: 'e1', subject: '01', session: null, datatype: 'anat', suffix: 'T1w', entities: {},
        deface: true, status: 'ok', source: 'heuristic', confidence: 1,
        brainlife_datatype: 'neuro/anat/t1w', brainlife_tags: []}],
};

// a stand-in for the engine; `script` sets what it answers
function fakeEngine(script = {}) {
    const calls = [];
    const state = {stops: 0, started: null, follows: 0};
    const engine = {
        base: 'http://127.0.0.1:9999',
        token: 'tok123',
        async request(method, p, body) {
            calls.push({method, path: p, body});
            const key = method + ' ' + p;
            if (script.errors && script.errors[key]) throw script.errors[key];
            if (script.onRequest) await script.onRequest(key);
            if (key === 'GET /plan') return PLAN;
            if (key === 'GET /status') {
                if (script.status) return script.status;
                return {stage: script.execStage || 'validated', message: script.execMessage || null,
                    output_dir: '/work/output/bids', manifest: {e1: ['sub-01/anat/sub-01_T1w.nii.gz', 'sub-01/anat/sub-01_T1w.json']},
                    validation: {ok: true, error_count: 0, warning_count: 0, errors: [], warnings: []}};
            }
            return {};
        },
        async follow(onEvent) {
            state.follows++;
            const stage = state.follows === 1 ? (script.scanStage || 'planned') : (script.execStage || 'validated');
            const ev = {stage, message: stage === 'failed' ? 'boom' : null};
            onEvent(ev);
            return ev;
        },
        async stop() {
            state.stops++;
        },
    };
    class Engine {
        constructor(opts) {
            this.opts = opts;
        }
        static async start(opts) {
            state.started = opts;
            if (script.startError) throw script.startError;
            return engine;
        }
        async stop() {
            state.stops++;
        }
    }
    return {Engine, calls, state, engine};
}

function fakeUpload() {
    const rec = {datasets: null, participants: 0, files: null};
    return {
        rec,
        upload: {
            async uploadDatasets(headers, project, datasets, opts) {
                if (rec.onUpload) rec.onUpload();
                rec.datasets = datasets;
                rec.tags = opts.tags;
                return {uploaded: datasets.map(d => d.dataset.desc), skipped: []};
            },
            async updateParticipants() {
                rec.participants++;
            },
            async uploadProjectFiles(headers, project, outputDir, files) {
                rec.files = files;
                rec.outputDir = outputDir;
            },
        },
    };
}

let tmp;
let input;
let work;
let keys;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-aimport-cmd-'));
    input = path.join(tmp, 'input');
    work = path.join(tmp, 'work');
    keys = path.join(tmp, 'keys');
    fs.mkdirSync(input);
    // what the engine would have written
    fs.cpSync(FIXTURE, path.join(work, 'output', 'bids'), {recursive: true});
});

afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true});
});

function setup(script, extra = {}) {
    const eng = fakeEngine(script);
    const up = fakeUpload();
    const out = [];
    const answers = [...(extra.answers || [])];
    const prompts = [];
    const deps = {
        Engine: eng.Engine,
        prompt: async q => {
            prompts.push(q);
            return answers.length ? answers.shift() : '';
        },
        upload: up.upload,
        validate: extra.validate || (async () => ({ok: true, errors: [], warnings: []})),
        log: (...a) => out.push(a.join(' ')),
        error: (...a) => out.push(a.join(' ')),
        loadJwt: async () => 'a.b.c',
        queryProjects: async (headers, q) => q.id === PROJECT._id ? [PROJECT] : [],
        queryAllDatatypes: async () => DATATYPES,
        projectSubjects: async () => ({existing_subjects: ['07'], existing_sessions: {'07': ['1']}}),
        exit: extra.exit || (() => {}),
    };
    const opts = Object.assign({folder: input, project: PROJECT._id, work, keys, yes: true, upload: true,
        target: 'bids', deface: 'pydeface', tag: []}, extra.opts || {});
    return {eng, up, out, prompts, deps, opts};
}

const paths = calls => calls.map(c => c.method + ' ' + c.path);

describe('bl aimport run', () => {
    it('scans, approves, executes, validates and uploads', async () => {
        const t = setup({}, {opts: {deface: 'quickshear', tag: ['x']}});
        const code = await run(t.opts, t.deps);
        assert.strictEqual(code, 0, t.out.join('\n'));
        assert.deepStrictEqual(paths(t.eng.calls), ['POST /scan', 'GET /plan', 'POST /approve', 'POST /execute', 'GET /status', 'GET /plan']);
        assert.deepStrictEqual(t.eng.calls[0].body, {project_id: PROJECT._id, existing_subjects: ['07'],
            existing_sessions: {'07': ['1']}, target: 'bids'});
        assert.deepStrictEqual(t.eng.calls[2].body, {deface_method: 'quickshear'});
        assert.strictEqual(t.eng.state.started.folder, input);
        assert.strictEqual(t.eng.state.started.work, work);
        assert.strictEqual(t.eng.state.started.keys, keys);
        assert.ok(t.up.rec.datasets.length > 0);
        assert.deepStrictEqual(t.up.rec.tags, ['x']);
        assert.strictEqual(t.up.rec.participants, 1);
        assert.strictEqual(t.up.rec.outputDir, path.join(work, 'output', 'bids'));
        assert.ok(t.up.rec.files.includes('README'));
        assert.ok(t.out.some(l => l.includes('/project/' + PROJECT._id)));
        assert.strictEqual(t.eng.state.stops, 1);
        assert.strictEqual(t.prompts.length, 0);
    });

    it('stops the engine after the last engine request and before the upload', async () => {
        const t = setup({onRequest: () => assert.strictEqual(t.eng.state.stops, 0, 'engine stopped before a request')});
        let stopsAtUpload = null;
        t.up.rec.onUpload = () => { stopsAtUpload = t.eng.state.stops; };
        assert.strictEqual(await run(t.opts, t.deps), 0, t.out.join('\n'));
        assert.strictEqual(stopsAtUpload, 1);
        assert.strictEqual(t.eng.state.stops, 1);
    });

    it('an engine without a manifest in /status is too old: exit 1, nothing uploaded', async () => {
        const t = setup({status: {stage: 'validated', output_dir: '/work/output/bids', validation: {ok: true}}});
        assert.strictEqual(await run(t.opts, t.deps), 1);
        assert.ok(t.out.includes('aimport: the engine image is too old (its /status has no manifest); rebuild it'));
        assert.strictEqual(t.up.rec.datasets, null);
        assert.strictEqual(t.up.rec.participants, 0);
        assert.strictEqual(t.up.rec.files, null);
    });

    it('the approval screen shows the chosen --deface method', async () => {
        const t = setup({}, {opts: {yes: false, deface: 'quickshear'}, answers: ['n']});
        assert.strictEqual(await run(t.opts, t.deps), 0);
        const text = t.out.join('\n');
        assert.ok(text.includes('Deface method: quickshear'));
        assert.ok(!text.includes('Deface method: pydeface'));
    });

    it('refuses a bad --image or folder paths with : or , (exit 2, before docker)', async () => {
        for (const extra of [{image: '-v /:/host'}, {image: 'img; rm -rf /'}, {work: path.join(tmp, 'w:x')}, {keys: path.join(tmp, 'k,ro')}]) {
            const t = setup({}, {opts: extra});
            assert.strictEqual(await run(t.opts, t.deps), 2, JSON.stringify(extra));
            assert.strictEqual(t.eng.state.started, null);
        }
        const ok = setup({scanStage: 'failed'}, {opts: {image: 'ghcr.io/brainlife/aimport:1.0@sha256:abc'}});
        await run(ok.opts, ok.deps);
        assert.strictEqual(ok.eng.state.started.image, 'ghcr.io/brainlife/aimport:1.0@sha256:abc');
    });

    it('refuses an existing keys folder that others can read', async () => {
        fs.mkdirSync(keys, {mode: 0o755});
        fs.chmodSync(keys, 0o755);
        const t = setup({});
        assert.strictEqual(await run(t.opts, t.deps), 2);
        assert.ok(t.out.some(l => l.includes('chmod 700 ' + keys)));
        assert.strictEqual(t.eng.state.started, null);
        assert.strictEqual(fs.statSync(keys).mode & 0o777, 0o755);
    });

    it('leaves an existing work folder and a private keys folder as they are', async () => {
        fs.chmodSync(work, 0o755);
        fs.mkdirSync(keys, {mode: 0o700});
        fs.chmodSync(keys, 0o700);
        const t = setup({scanStage: 'failed'});
        await run(t.opts, t.deps);
        assert.ok(t.eng.state.started);
        assert.strictEqual(fs.statSync(work).mode & 0o777, 0o755);
        assert.strictEqual(fs.statSync(keys).mode & 0o777, 0o700);
    });

    it('creates the work and keys folders with mode 0700', async () => {
        fs.rmSync(work, {recursive: true});
        const t = setup({scanStage: 'failed'});
        await run(t.opts, t.deps);
        assert.strictEqual(fs.statSync(work).mode & 0o777, 0o700);
        assert.strictEqual(fs.statSync(keys).mode & 0o777, 0o700);
    });

    it('answering n exits 0 without approve or upload', async () => {
        const t = setup({}, {opts: {yes: false}, answers: ['n']});
        const code = await run(t.opts, t.deps);
        assert.strictEqual(code, 0);
        assert.deepStrictEqual(t.prompts, ['Approve this plan? [y/N/e(dit)] ']);
        assert.deepStrictEqual(paths(t.eng.calls), ['POST /scan', 'GET /plan']);
        assert.strictEqual(t.up.rec.datasets, null);
        assert.strictEqual(t.eng.state.stops, 1);
    });

    it('e prints how to edit the plan, then shows it again and asks again', async () => {
        const t = setup({}, {opts: {yes: false, upload: false}, answers: ['e', '', 'y']});
        const code = await run(t.opts, t.deps);
        assert.strictEqual(code, 0);
        const text = t.out.join('\n');
        assert.ok(text.includes('http://127.0.0.1:9999'));
        assert.ok(text.includes('tok123'));
        assert.ok(text.includes('valid only while this engine runs'));
        assert.ok(text.includes('PATCH /plan'));
        assert.ok(text.includes('README.md'));
        assert.deepStrictEqual(paths(t.eng.calls).slice(0, 4), ['POST /scan', 'GET /plan', 'GET /plan', 'POST /approve']);
        assert.strictEqual(t.prompts.filter(p => p.startsWith('Approve')).length, 2);
    });

    it('a failed scan exits 1', async () => {
        const t = setup({scanStage: 'failed'});
        assert.strictEqual(await run(t.opts, t.deps), 1);
        assert.deepStrictEqual(paths(t.eng.calls), ['POST /scan']);
        assert.ok(t.out.some(l => l.includes('boom')));
        assert.strictEqual(t.eng.state.stops, 1);
    });

    it('invalid exits 1 without upload', async () => {
        const t = setup({execStage: 'invalid', execMessage: 'validator errors'});
        assert.strictEqual(await run(t.opts, t.deps), 1);
        assert.strictEqual(t.up.rec.datasets, null);
        assert.strictEqual(t.up.rec.files, null);
        assert.strictEqual(t.eng.state.stops, 1);
    });

    it('--no-upload stops after validation', async () => {
        let validated = 0;
        const t = setup({}, {opts: {upload: false}, validate: async () => {
            validated++;
            return {ok: true, errors: [], warnings: []};
        }});
        assert.strictEqual(await run(t.opts, t.deps), 0);
        assert.ok(validated > 0);
        assert.strictEqual(t.up.rec.datasets, null);
        assert.strictEqual(t.up.rec.participants, 0);
        assert.strictEqual(t.up.rec.files, null);
        assert.strictEqual(t.eng.state.stops, 1);
    });

    it('an EngineError 409 prints its message and exits 1', async () => {
        const t = setup({errors: {'POST /approve': new EngineError('the key is locked by another run', 409)}});
        assert.strictEqual(await run(t.opts, t.deps), 1);
        assert.ok(t.out.includes('aimport: the key is locked by another run'));
        assert.ok(!t.out.some(l => l.includes('at ')), 'no stack trace');
        assert.strictEqual(t.up.rec.datasets, null);
        assert.strictEqual(t.eng.state.stops, 1);
    });

    it('--ui exits 2 with the message', async () => {
        const t = setup({}, {opts: {ui: true}});
        assert.strictEqual(await run(t.opts, t.deps), 2);
        assert.ok(t.out.some(l => l.includes('--ui needs the brainlife.io/aimport page, which is not available yet')));
        assert.strictEqual(t.eng.state.started, null);
    });

    it('refuses overlapping folders with exit 2 before docker', async () => {
        const t = setup({}, {opts: {work: path.join(input, 'work')}});
        assert.strictEqual(await run(t.opts, t.deps), 2);
        assert.strictEqual(t.eng.state.started, null);
        const t2 = setup({}, {opts: {keys: path.join(work, 'keys')}});
        assert.strictEqual(await run(t2.opts, t2.deps), 2);
        assert.strictEqual(t2.eng.state.started, null);
    });

    it('a project that does not exist exits 1 before docker', async () => {
        const t = setup({}, {opts: {project: 'ffffffffffffffffffffffff'}});
        assert.strictEqual(await run(t.opts, t.deps), 1);
        assert.strictEqual(t.eng.state.started, null);
    });

    it('a validator ok:false keeps that dataset out of the upload, and its files out of project files', async () => {
        const t = setup({}, {validate: async d => d.dataset.desc === 'sub-01_T1w.nii.gz' ?
            {ok: false, errors: ['bad header'], warnings: []} : {ok: true, errors: [], warnings: []}});
        const code = await run(t.opts, t.deps);
        assert.strictEqual(code, 1);
        assert.ok(t.up.rec.datasets.length > 0);
        assert.ok(!t.up.rec.datasets.some(d => d.dataset.desc === 'sub-01_T1w.nii.gz'));
        assert.ok(!t.up.rec.files.includes('sub-01/anat/sub-01_T1w.nii.gz'));
        assert.ok(t.out.some(l => l.includes('sub-01_T1w.nii.gz') && l.includes('bad header')));
        assert.strictEqual(t.eng.state.stops, 1);
    });

    it('a skipped validator still uploads, with a warning', async () => {
        const t = setup({}, {validate: async () => ({ok: true, skipped: 'datatype has no validator', errors: [], warnings: []})});
        assert.strictEqual(await run(t.opts, t.deps), 0);
        assert.ok(t.up.rec.datasets.length > 0);
        assert.ok(t.out.some(l => l.includes('datatype has no validator')));
    });

    it('refuses to upload when the output holds a key file', async () => {
        fs.writeFileSync(path.join(work, 'output', 'bids', 'p.aimport-key.json'), '{}');
        const t = setup({});
        assert.strictEqual(await run(t.opts, t.deps), 1);
        assert.strictEqual(t.up.rec.datasets, null);
        assert.strictEqual(t.up.rec.participants, 0);
        assert.strictEqual(t.up.rec.files, null);
        assert.ok(t.out.some(l => l.includes('aimport-key')));
        assert.strictEqual(t.eng.state.stops, 1);
    });

    it('Ctrl-C stops the engine and exits 130', async () => {
        const exits = [];
        const before = process.listenerCount('SIGINT');
        const t = setup({}, {opts: {yes: false}, exit: c => exits.push(c)});
        t.deps.prompt = async () => {
            process.emit('SIGINT');
            await new Promise(r => setImmediate(r));
            return 'n';
        };
        await run(t.opts, t.deps);
        assert.deepStrictEqual(exits, [130]);
        assert.ok(t.eng.state.stops >= 1);
        assert.strictEqual(process.listenerCount('SIGINT'), before);
    });

    for (const [sig, code] of [['SIGTERM', 143], ['SIGHUP', 129]]) {
        it(sig + ' stops the engine, exits ' + code + ' and does not print the in-flight error', async () => {
            const exits = [];
            const counts = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(s => process.listenerCount(s));
            const t = setup({onRequest: async key => {
                if (key !== 'POST /execute') return;
                process.emit(sig);
                await new Promise(r => setImmediate(r));
                throw new Error('socket hang up');
            }}, {exit: c => exits.push(c)});
            assert.strictEqual(await run(t.opts, t.deps), 1);
            assert.deepStrictEqual(exits, [code]);
            assert.strictEqual(t.eng.state.stops, 1);
            assert.ok(!t.out.some(l => l.includes('socket hang up')), t.out.join('\n'));
            assert.ok(t.out.includes('aimport: interrupted; stopping the engine'));
            assert.deepStrictEqual(['SIGINT', 'SIGTERM', 'SIGHUP'].map(s => process.listenerCount(s)), counts);
        });
    }
});

describe('projectSubjects', () => {
    it('pages through the project datasets and collects subjects and sessions', async () => {
        const all = [
            {meta: {subject: '01', session: '1'}}, {meta: {subject: '01', session: '2'}},
            {meta: {subject: '01', session: '1'}}, {meta: {subject: '02'}}, {meta: {}},
        ];
        const queries = [];
        const srv = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://x');
            const q = Object.fromEntries(url.searchParams);
            queries.push(Object.assign({path: url.pathname, auth: req.headers.authorization}, q));
            const skip = +q.skip;
            const limit = +q.limit;
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({datasets: all.slice(skip, skip + limit), count: all.length}));
        });
        await new Promise(r => srv.listen(0, '127.0.0.1', r));
        try {
            const api = {warehouse: 'http://127.0.0.1:' + srv.address().port + '/warehouse'};
            const r = await projectSubjects({Authorization: 'Bearer a.b.c'}, 'p1', {api, limit: 2});
            assert.deepStrictEqual(r, {existing_subjects: ['01', '02'], existing_sessions: {'01': ['1', '2']}});
            assert.strictEqual(queries.length, 3);
            assert.strictEqual(queries[0].path, '/warehouse/dataset');
            assert.deepStrictEqual(JSON.parse(queries[0].find), {project: 'p1', removed: false});
            assert.strictEqual(queries[0].select, 'meta.subject meta.session');
            assert.strictEqual(queries[0].sort, '_id');
            assert.strictEqual(queries[0].auth, 'Bearer a.b.c');
            assert.deepStrictEqual(queries.map(q => q.skip), ['0', '2', '4']);
        } finally {
            srv.close();
        }
    });
});
