'use strict';

// Upload side of bl aimport: apply the reviewed plan's brainlife mapping to the
// walked BIDS output, and send everything that is not a data object (phenotype,
// README, ...) to project file storage.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const {bidsName} = require('./plan-table');

// participants.tsv/json go to the participants API (bids-upload.updateParticipants)
const PARTICIPANT_FILES = new Set(['participants.tsv', 'participants.json']);

function applyPlan(bids, plan, manifest, datatypesByName, outputDir) {
    // full path of each written file -> plan entry
    const entryByPath = new Map();
    for (const entry of plan.entries || []) {
        for (const rel of manifest[entry.id] || []) entryByPath.set(path.resolve(outputDir, rel), entry);
    }
    const datasets = [];
    const warnings = [];
    for (const item of bids.datasets) {
        let entry = null;
        for (const full of Object.values(item.files)) {
            entry = entryByPath.get(path.resolve(full));
            if (entry) break;
        }
        if (entry && entry.brainlife_datatype) {
            const name = entry.brainlife_datatype;
            if (!datatypesByName[name]) {
                warnings.push(name + ' is not a registered brainlife datatype (draft): ' + bidsName(entry) + ' goes to project files only');
                continue;
            }
            item.dataset.datatype = name;
            item.dataset.datatype_tags = [...(entry.brainlife_tags || [])];
        }
        datasets.push(item);
    }
    return {datasets, warnings};
}

// whole-output check before any upload: no symlinks (they could point anywhere),
// no pseudonym key files and nothing under sourcedata/
function preflight(outputDir) {
    const root = path.resolve(outputDir);
    const check = rel => {
        const full = rel ? path.join(root, rel) : root;
        const st = fs.lstatSync(full);
        const shown = rel || root;
        if (st.isSymbolicLink()) throw new Error('refusing to upload ' + shown + ': it is a symbolic link');
        const name = path.basename(full);
        if (rel && name === 'sourcedata') throw new Error('refusing to upload ' + shown + ' (sourcedata never leaves this machine)');
        if (name.endsWith('.aimport-key.json')) throw new Error('refusing to upload ' + shown + ' (key files never leave this machine)');
        if (st.isDirectory()) {
            for (const child of fs.readdirSync(full).sort()) check(rel ? rel + '/' + child : child);
        } else if (!st.isFile()) {
            throw new Error('refusing to upload ' + shown + ': not a regular file');
        }
    };
    check('');
}

function listFiles(dir, rel = '') {
    let out = [];
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
        const sub = rel ? rel + '/' + name : name;
        if (fs.statSync(path.join(dir, sub)).isDirectory()) out = out.concat(listFiles(dir, sub));
        else out.push(sub);
    }
    return out;
}

function projectFiles(outputDir, datasets) {
    const root = path.resolve(outputDir);
    const all = listFiles(root);
    for (const f of all) {
        if (/(^|\/)sourcedata\//.test(f) || f.endsWith('.aimport-key.json')) {
            throw new Error('refusing to upload ' + f + ' (sourcedata and key files never leave this machine)');
        }
    }
    // files (or folders) that went into a data object
    const used = [];
    for (const item of datasets) {
        for (const full of Object.values(item.files)) used.push(path.relative(root, path.resolve(full)).split(path.sep).join('/'));
    }
    const isUsed = f => used.some(u => f === u || f.startsWith(u + '/'));
    return all.filter(f => !PARTICIPANT_FILES.has(f) && !isUsed(f));
}

async function uploadProjectFiles(headers, project, outputDir, files, {api = config.api, prefix = 'bids/'} = {}) {
    const id = project._id || project;
    for (const f of files) {
        const bytes = fs.readFileSync(path.join(outputDir, f));
        const res = await axios.post(api.warehouse + '/files/' + id + '/upload/presigned', {
            fileName: f, fileSize: bytes.length, contentType: 'application/octet-stream', prefix,
        }, {headers});
        // the presigned URL carries its own credentials; no Authorization header
        const put = await fetch(res.data.presignedUrl, {method: 'PUT', body: bytes});
        if (!put.ok) throw new Error('upload of ' + f + ' failed with status ' + put.status);
    }
}

module.exports = {applyPlan, preflight, projectFiles, uploadProjectFiles};
