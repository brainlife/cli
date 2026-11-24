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

// create (or tighten) a folder so only this user can read it
function privateDir(dir) {
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    fs.chmodSync(dir, 0o700);
}

const DEFAULT_DEPS = {
    Engine,
    prompt,
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

    const stopEngine = () => {
        if (!stopping) {
            const e = engine || (name ? new deps.Engine({name}) : null);
            stopping = e ? Promise.resolve(e.stop()).catch(() => {}) : Promise.resolve();
        }
        return stopping;
    };
    const onSigint = () => {
        error('aimport: interrupted; stopping the engine');
        stopEngine().then(() => deps.exit(130));
    };

    try {
        // flags and folders
        if (opts.ui) throw new UsageError(UI_MESSAGE);
        const target = opts.target || 'bids';
        if (!['bids', 'datatypes'].includes(target)) throw new UsageError('--target must be bids or datatypes');
        const deface = opts.deface || 'pydeface';
        if (!['pydeface', 'quickshear'].includes(deface)) throw new UsageError('--deface must be pydeface or quickshear');
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
        privateDir(keys);

        const existing = await deps.projectSubjects(headers, project._id, {api});

        // start the engine; from here on every exit path stops it
        name = 'bl-aimport-' + crypto.randomBytes(4).toString('hex');
        process.on('SIGINT', onSigint);
        log('Starting the aimport engine (' + (opts.image || ENGINE_IMAGE) + ')...');
        engine = await deps.Engine.start({image: opts.image || ENGINE_IMAGE, folder, work, keys, name});
        const onEvent = ev => log('  ' + ev.stage + (ev.message ? ': ' + ev.message : ''));

        // scan
        await engine.request('POST', '/scan', {project_id: project._id, existing_subjects: existing.existing_subjects,
            existing_sessions: existing.existing_sessions, target});
        const scanned = await engine.follow(onEvent);
        if (scanned.stage !== 'planned') {
            error('aimport: the scan ' + scanned.stage + (scanned.message ? ': ' + scanned.message : ''));
            return 1;
        }

        // review
        let plan = await engine.request('GET', '/plan');
        log(renderPlan(plan, {target}));
        if (!opts.yes) {
            for (;;) {
                const answer = String(await deps.prompt('Approve this plan? [y/N/e(dit)] ')).trim().toLowerCase();
                if (answer === 'y' || answer === 'yes') break;
                if (answer === 'e' || answer === 'edit') {
                    log('Edit the plan with PATCH /plan, as described in ' + README_URL);
                    log('  engine: ' + engine.base);
                    log('  token:  ' + engine.token);
                    log('  for example: curl -s -X PATCH ' + engine.base + '/plan -H "Authorization: Bearer ' + engine.token +
                        '" -H \'Content-Type: application/json\' -d \'{"edits": [{"id": "<entry id>", "exclude": true}]}\'');
                    await deps.prompt('Press Enter when you are done editing ');
                    plan = await engine.request('GET', '/plan');
                    log(renderPlan(plan, {target}));
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
            return 1;
        }

        // the host side of the engine's /work mount (status.output_dir is a container path)
        const bidsDir = path.join(work, 'output', 'bids');
        preflight(bidsDir);
        plan = await engine.request('GET', '/plan');
        const bids = await deps.walk(bidsDir);
        const datatypesByName = {};
        for (const dt of await deps.queryAllDatatypes(headers, api)) datatypesByName[dt.name] = dt;
        const applied = applyPlan(bids, plan, status.manifest || {}, datatypesByName, bidsDir);
        for (const w of applied.warnings) log('! ' + w);

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
        const files = projectFiles(bidsDir, applied.datasets);

        if (opts.upload === false) {
            log('--no-upload: stopping here. ' + good.length + ' object(s) and ' + files.length +
                ' project file(s) would be uploaded from ' + bidsDir);
            return blocked.length ? 1 : 0;
        }

        if (bids.participants.length || bids.participants_json) {
            await deps.upload.updateParticipants(headers, project, bids, {api});
        }
        const result = await deps.upload.uploadDatasets(headers, project, good, {tags: opts.tag || [], api, log});
        await deps.upload.uploadProjectFiles(headers, project, bidsDir, files, {api});
        log('Uploaded ' + result.uploaded.length + ' object(s), skipped ' + result.skipped.length +
            ' already in the project, ' + files.length + ' project file(s)');
        if (blocked.length) error('aimport: ' + blocked.length + ' object(s) failed validation and were not uploaded');
        log('https://' + deps.host + '/project/' + project._id);
        return blocked.length ? 1 : 0;
    } catch (err) {
        if (err instanceof UsageError) {
            error(err.message);
            return 2;
        }
        // EngineError and everything else: the message only, no stack trace
        error('aimport: ' + (err instanceof Error ? err.message : String(err)));
        return 1;
    } finally {
        if (name) await stopEngine();
        process.removeListener('SIGINT', onSigint);
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
    }).then(code => process.exit(code));
}
