#!/usr/bin/env node

'use strict';

// bl aimport: run the aimport engine on a local DICOM/NIfTI folder, review its plan in the
// terminal, execute it (BIDS output, defacing, validation), check each object with the
// brainlife datatype validators and upload the de-identified output to a project.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const axios = require('axios');
const commander = require('commander');

const config = require('./config');
const util = require('./util');
const bidsWalker = require('./bids-walker');
const bidsUpload = require('./bids-upload');
const engineMod = require('./aimport/engine');
const {renderPlan, renderResult} = require('./aimport/plan-table');
const {applyPlan, preflight, projectFiles, uploadProjectFiles} = require('./aimport/upload');
const {validateDataset} = require('./aimport/validators');
const {loadChunkMap, streamedBytes} = require('./aimport/chunks');
const {micrDatasets} = require('./aimport/micr-walk');

const {Engine, EngineError, UsageError, checkFolders, ENGINE_IMAGE} = engineMod;

const UI_MESSAGE = '--ui needs the brainlife.io/aimport page, which is not available yet';
const README_URL = 'https://github.com/brainlife/ezbids/blob/master/aimport/README.md#the-workflow';

// subjects and sessions already in the project, so the engine does not reuse their IDs
async function projectSubjects(headers, projectId, {api = config.api, limit = 1000} = {}) {
    const subjects = new Set();
    const sessions = {};
    for (let skip = 0; ; skip += limit) {
        const res = await axios.get(api.warehouse + '/dataset', {headers, params: {
            find: JSON.stringify({project: projectId, removed: false}),
            select: 'meta.subject meta.session',
            sort: '_id', // a stable order, so paging does not skip or repeat
            limit, skip,
        }});
        const list = res.data.datasets || [];
        for (const d of list) {
            const meta = d.meta || {};
            if (meta.subject === undefined || meta.subject === null || meta.subject === '') continue;
            const sub = String(meta.subject);
            subjects.add(sub);
            if (meta.session !== undefined && meta.session !== null && meta.session !== '') {
                if (!sessions[sub]) sessions[sub] = [];
                if (!sessions[sub].includes(String(meta.session))) sessions[sub].push(String(meta.session));
            }
        }
        if (list.length < limit || skip + list.length >= (res.data.count || 0)) break;
    }
    return {existing_subjects: [...subjects], existing_sessions: sessions};
}

function walk(root) {
    return new Promise((resolve, reject) => {
        bidsWalker.walk(root, (err, bids) => err ? reject(err) : resolve(bids));
    });
}

function prompt(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({input: process.stdin, output: process.stdout});
        let answered = false;
        // readline swallows Ctrl-C; pass it on so the engine is stopped
        rl.on('SIGINT', () => {
            rl.close();
            process.kill(process.pid, 'SIGINT');
        });
        rl.on('close', () => {
            if (!answered) resolve('');
        });
        rl.question(question, answer => {
            answered = true;
            rl.close();
            resolve(answer);
        });
    });
}

// create a folder only this user can read; folders that already exist keep their mode,
// but an existing keys folder others can read is refused
function privateDir(dir, {refuseOpen = false} = {}) {
    if (fs.existsSync(dir)) {
        if (refuseOpen && (fs.statSync(dir).mode & 0o077)) {
            throw new UsageError('the keys folder ' + dir + ' can be read by other users; run: chmod 700 ' + dir);
        }
        return;
    }
    const first = fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    // chmod only what was created here (mkdir's mode is masked by the umask)
    for (let d = dir; first; d = path.dirname(d)) {
        fs.chmodSync(d, 0o700);
        if (d === first || path.dirname(d) === d) break;
    }
}

// open a URL with the OS opener; a failure only prints, the URL is on screen anyway
function openUrl(url) {
    const cmd = process.platform === 'darwin' ? ['open', [url]]
        : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
            : ['xdg-open', [url]];
    return new Promise((resolve, reject) => {
        const child = require('child_process').spawn(cmd[0], cmd[1], {stdio: 'ignore', detached: true});
        child.on('error', reject);
        child.on('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

const IMAGE_RE = /^[A-Za-z0-9][\w.\/:@-]*$/;
const REMOTE_RE = /^(https|s3):\/\/[^\s]+$/i;

// bytes of the written files (and folders) that go up from the output
function localBytes(root, rels) {
    let total = 0;
    const add = full => {
        const st = fs.lstatSync(full);
        if (st.isDirectory()) for (const c of fs.readdirSync(full)) add(path.join(full, c));
        else if (st.isFile()) total += st.size;
    };
    for (const r of rels) add(path.resolve(root, r));
    return total;
}

const gb = bytes => (bytes / 1e9).toFixed(2) + ' GB';
const SIGNAL_EXIT = {SIGINT: 130, SIGTERM: 143, SIGHUP: 129};

const DEFAULT_DEPS = {
    Engine,
    prompt,
    openUrl,
    upload: {
        uploadDatasets: bidsUpload.uploadDatasets,
        updateParticipants: bidsUpload.updateParticipants,
        uploadProjectFiles,
    },
    validate: validateDataset,
    log: console.log,
    error: console.error,
    loadJwt: util.loadJwt,
    queryProjects: util.queryProjects,
    queryAllDatatypes: util.queryAllDatatypes,
    projectSubjects,
    walk,
    api: config.api,
    host: config.host,
    exit: code => process.exit(code),
};

async function run(opts, deps = {}) {
    deps = Object.assign({}, DEFAULT_DEPS, deps);
    const {log, error} = deps;
    const api = deps.api;
    let engine = null;
    let name = null;
    let stopping = null;
    let interrupted = false;

    // a one-time viewer link (the engine's /viewer/session); null when the engine has no viewer
    const openViewer = async () => {
        let session;
        try {
            session = await engine.request('POST', '/viewer/session');
        } catch (err) {
            if (err instanceof engineMod.EngineError && err.status === 404) {
                error('aimport: the engine image is too old for --qa; rebuild it');
                return null;
            }
            throw err;
        }
        const url = engine.base + session.url;
        log('QA viewer: ' + url);
        try {
            await deps.openUrl(url);
        } catch (err) {
            log('(could not open a browser; open the address above yourself)');
        }
        return url;
    };
    const stopEngine = () => {
        if (!stopping) {
            const e = engine || (name ? new deps.Engine({name}) : null);
            stopping = e ? Promise.resolve(e.stop()).catch(() => {}) : Promise.resolve();
        }
        return stopping;
    };
    const handlers = {};
    for (const sig of Object.keys(SIGNAL_EXIT)) {
        handlers[sig] = () => {
            interrupted = true;
            error('aimport: interrupted; stopping the engine');
            stopEngine().then(() => deps.exit(SIGNAL_EXIT[sig]));
        };
    }

    try {
        // flags and folders
        if (opts.ui) throw new UsageError(UI_MESSAGE);
        const target = opts.target || 'bids';
        if (!['bids', 'datatypes'].includes(target)) throw new UsageError('--target must be bids or datatypes');
        const deface = opts.deface || 'pydeface';
        if (!['pydeface', 'quickshear'].includes(deface)) throw new UsageError('--deface must be pydeface or quickshear');
        const image = opts.image || ENGINE_IMAGE;
        if (!IMAGE_RE.test(image)) throw new UsageError('--image is not a docker image reference: ' + image);
        if (!opts.folder) throw new UsageError('please give the folder to import');
        const folder = path.resolve(opts.folder);
        let st = null;
        try {
            st = fs.statSync(folder);
        } catch (err) {
            //missing
        }
        if (!st || !st.isDirectory()) throw new UsageError('not a folder: ' + folder);
        if (!opts.project) throw new UsageError('please give the brainlife project id (--project)');
        if (!util.isValidObjectId(opts.project)) throw new UsageError('--project must be a brainlife project id: ' + opts.project);
        // remote sources for the microscopy modules; the engine checks them again. Never echoed:
        // a URL can name the donor
        const remote = opts.remote || [];
        for (const url of remote) {
            if (typeof url !== 'string' || !REMOTE_RE.test(url)) throw new UsageError('--remote must be an https:// or s3:// URL');
        }

        // the project must exist; aimport never creates one
        const jwt = await deps.loadJwt();
        const headers = {Authorization: 'Bearer ' + jwt};
        const projects = await deps.queryProjects(headers, {id: opts.project});
        if (projects.length !== 1) throw new Error('project ' + opts.project + ' not found');
        const project = projects[0];

        const work = path.resolve(opts.work || path.join(os.homedir(), '.cache', 'brainlife', 'aimport', project._id, 'work'));
        const keys = path.resolve(opts.keys || path.join(os.homedir(), '.config', 'brainlife', 'aimport', 'keys'));
        checkFolders({folder, work, keys});
        privateDir(work);
        privateDir(keys, {refuseOpen: true});

        const existing = await deps.projectSubjects(headers, project._id, {api});

        // start the engine; from here on every exit path stops it
        name = 'bl-aimport-' + crypto.randomBytes(4).toString('hex');
        for (const sig of Object.keys(handlers)) process.on(sig, handlers[sig]);
        log('Starting the aimport engine (' + image + ')...');
        engine = await deps.Engine.start({image, folder, work, keys, name});
        const onEvent = ev => log('  ' + ev.stage + (ev.message ? ': ' + ev.message : ''));

        // scan
        const scanBody = {project_id: project._id, existing_subjects: existing.existing_subjects,
            existing_sessions: existing.existing_sessions, target};
        if (remote.length) scanBody.remote = remote;
        await engine.request('POST', '/scan', scanBody);
        const scanned = await engine.follow(onEvent);
        if (scanned.stage !== 'planned') {
            error('aimport: the scan ' + scanned.stage + (scanned.message ? ': ' + scanned.message : ''));
            return 1;
        }

        // review
        let plan = await engine.request('GET', '/plan');
        log(renderPlan(plan, {target, deface}));
        if (!opts.yes) {
            for (;;) {
                const answer = String(await deps.prompt('Approve this plan? [y/N/e(dit)] ')).trim().toLowerCase();
                if (answer === 'y' || answer === 'yes') break;
                if (answer === 'e' || answer === 'edit') {
                    log('Edit the plan with PATCH /plan, as described in ' + README_URL);
                    log('  engine: ' + engine.base);
                    log('  token:  ' + engine.token + ' (valid only while this engine runs)');
                    log('  for example: curl -s -X PATCH ' + engine.base + '/plan -H "Authorization: Bearer ' + engine.token +
                        '" -H \'Content-Type: application/json\' -d \'{"edits": [{"id": "<entry id>", "exclude": true}]}\'');
                    await deps.prompt('Press Enter when you are done editing ');
                    plan = await engine.request('GET', '/plan');
                    log(renderPlan(plan, {target, deface}));
                    continue;
                }
                log('The plan was not approved. Nothing was written or uploaded.');
                return 0;
            }
        }

        // approve and execute
        await engine.request('POST', '/approve', {deface_method: deface});
        await engine.request('POST', '/execute');
        const executed = await engine.follow(onEvent);
        const status = await engine.request('GET', '/status');
        log(renderResult(status));
        if (executed.stage !== 'validated' || status.stage !== 'validated') {
            const msg = status.message || executed.message;
            error('aimport: the output is ' + status.stage + (msg ? ' (' + msg + ')' : '') + '; nothing was uploaded');
            // an invalid output was written: it can still be looked at, to see what to fix
            if (opts.qa && status.stage === 'invalid') {
                if (await openViewer() === null) return 1;
                await deps.prompt('Press Enter to close the viewer and stop the engine. ');
            }
            return 1;
        }

        // older engine images have no manifest; without it objects cannot be matched to plan entries
        const manifest = status.manifest;
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
            error('aimport: the engine image is too old (its /status has no manifest); rebuild it');
            return 1;
        }
        plan = await engine.request('GET', '/plan');

        // the viewer is served by the engine, so it is opened and the question answered before the engine stops
        let confirmed = false;
        if (opts.qa) {
            if (await openViewer() === null) return 1;
            if (opts.upload !== false) {
                for (;;) {
                    const answer = String(await deps.prompt('Upload this dataset? [y/N/v(iewer link again)] '))
                        .trim().toLowerCase();
                    if (answer === 'y' || answer === 'yes') {
                        confirmed = true;
                        break;
                    }
                    if (answer === 'v') {  // the one-time code expires after 60 s: a fresh one
                        if (await openViewer() === null) return 1;
                        continue;
                    }
                    log('Not uploaded. The output stays in ' + path.join(work, 'output', 'bids'));
                    return 0;
                }
            } else {
                // nothing to upload: keep the engine (and so the viewer) up until the person is done
                await deps.prompt('Press Enter to close the viewer and stop the engine. ');
            }
        }

        // bad channels marked in the viewer rewrite channels.tsv and validate the output again: upload
        // only if it is still valid (a save in progress is waited for)
        if (opts.qa) {
            let after = await engine.request('GET', '/status');
            if (after.stage === 'executing') {
                await engine.follow(() => {});
                after = await engine.request('GET', '/status');
            }
            if (after.stage !== 'validated') {
                error('aimport: after the QA review the output is ' + after.stage +
                    (after.message ? ' (' + after.message + ')' : '') + '; nothing was uploaded');
                return 1;
            }
        }

        // everything below works on the host side of the engine's /work mount; the engine is done
        await stopEngine();
        const bidsDir = path.join(work, 'output', 'bids');
        // reference datasets: where their chunks are (input paths and URLs: local only, never printed)
        const chunkMap = loadChunkMap(work, bidsDir, folder, manifest, status.chunk_map);
        preflight(bidsDir, {chunkMap, manifest, inputDir: folder});
        const bids = await deps.walk(bidsDir);
        const datatypesByName = {};
        for (const dt of await deps.queryAllDatatypes(headers, api)) datatypesByName[dt.name] = dt;
        const applied = applyPlan(bids, plan, manifest, datatypesByName, bidsDir);
        // micr images: the walker does not know micr/; one object per written .ome.zarr
        const micr = micrDatasets(bidsDir, plan, manifest, datatypesByName);
        applied.datasets.push(...micr.datasets);
        for (const w of applied.warnings.concat(micr.warnings)) log('! ' + w);
        for (const n of applied.notes || []) log(n);

        // host datatype validators; a failure keeps that object out of the upload
        const good = [];
        const blocked = [];
        for (const item of applied.datasets) {
            const desc = item.dataset.desc;
            const r = await deps.validate(item, datatypesByName[item.dataset.datatype]);
            if (!r.ok) {
                error('aimport: not uploading ' + desc + ': ' + (r.errors.join('; ') || 'validator failed'));
                blocked.push(item);
                continue;
            }
            if (r.skipped) log('! ' + desc + ' was not checked by a datatype validator (' + r.skipped + ')');
            for (const w of r.warnings || []) log('! ' + desc + ': ' + w);
            good.push(item);
        }
        // blocked objects' files are not sent as project files either
        const files = projectFiles(bidsDir, applied.datasets, micr.held);

        // what goes up: from the output folder, and streamed from the reference datasets' sources
        const objectRels = [];
        for (const item of good) for (const full of Object.values(item.files)) objectRels.push(path.relative(bidsDir, full));
        const streamed = streamedBytes(chunkMap, good);
        log(good.length + ' objects, ' + gb(localBytes(bidsDir, objectRels.concat(files))) + ' from local output, ' +
            gb(streamed.bytes) + ' streamed from sources' +
            (streamed.upperBound ? ' (at most: remote chunk sizes are known only when they are read)' : ''));

        if (opts.upload === false) {
            log('--no-upload: stopping here. ' + good.length + ' object(s) and ' + files.length +
                ' project file(s) would be uploaded from ' + bidsDir);
            return blocked.length ? 1 : 0;
        }

        // streaming from the sources can be long: ask, unless --yes or the --qa question was answered
        if (streamed.arrays > 0 && !opts.yes && !confirmed) {
            const answer = String(await deps.prompt('Upload? [y/N] ')).trim().toLowerCase();
            if (answer !== 'y' && answer !== 'yes') {
                log('Not uploaded. The output stays in ' + bidsDir);
                return 0;
            }
        }

        if (bids.participants.length || bids.participants_json) {
            await deps.upload.updateParticipants(headers, project, bids, {api});
        }
        const result = await deps.upload.uploadDatasets(headers, project, good, {tags: opts.tag || [], api, log, chunkMap});
        await deps.upload.uploadProjectFiles(headers, project, bidsDir, files, {api});
        log('Uploaded ' + result.uploaded.length + ' object(s), skipped ' + result.skipped.length +
            ' already in the project, ' + files.length + ' project file(s)');
        if (blocked.length) error('aimport: ' + blocked.length + ' object(s) failed validation and were not uploaded');
        log('https://' + deps.host + '/project/' + project._id);
        return blocked.length ? 1 : 0;
    } catch (err) {
        // after a signal the in-flight request fails because the engine stops; say nothing more
        if (interrupted) return 1;
        if (err instanceof UsageError) {
            error(err.message);
            return 2;
        }
        // EngineError and everything else: the message only, no stack trace
        error('aimport: ' + (err instanceof Error ? err.message : String(err)));
        return 1;
    } finally {
        if (name) await stopEngine();
        for (const sig of Object.keys(handlers)) process.removeListener(sig, handlers[sig]);
    }
}

module.exports = {run, projectSubjects};

if (require.main === module) {
    commander
        .usage('<folder> --project <id> [options]')
        .option('-p, --project <id>', 'brainlife project id to upload to (it must exist)')
        .option('--target <target>', 'bids or datatypes (also show the brainlife datatype mapping)', 'bids')
        .option('--ui', 'review the plan on brainlife.io (not available yet)')
        .option('--work <dir>', 'work folder (default ~/.cache/brainlife/aimport/<project id>/work)')
        .option('--keys <dir>', 'pseudonym key folder (default ~/.config/brainlife/aimport/keys)')
        .option('--deface <method>', 'pydeface or quickshear', 'pydeface')
        .option('--image <ref>', 'aimport engine image', ENGINE_IMAGE)
        .option('-y, --yes', 'approve the plan without asking (for scripts)')
        .option('-t, --tag <tag>', 'add a tag to every uploaded data object', util.collect, [])
        .option('--qa', 'open the output in the local QA viewer after validation and ask before uploading')
        .option('--remote <url>', 'a remote microscopy source (https:// or s3://, anonymous reads; repeatable)', util.collect, [])
        .option('--no-upload', 'stop after validation')
        .parse(process.argv);

    run({
        folder: commander.args[0],
        project: commander.project,
        target: commander.target,
        ui: commander.ui,
        work: commander.work,
        keys: commander.keys,
        deface: commander.deface,
        image: commander.image,
        yes: commander.yes,
        tag: commander.tag,
        upload: commander.upload,
        qa: commander.qa,
        remote: commander.remote,
    }).then(code => process.exit(code));
}
