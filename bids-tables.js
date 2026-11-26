'use strict';

// Project tables (warehouse /table API) for bl bids upload: BIDS tables that describe
// subjects, sessions or files (phenotype/*.tsv, samples.tsv, sessions and scans tables).
// participants.tsv goes to the participants API (bids-upload.updateParticipants), not here.
//
// Finding the tables follows the warehouse (api/controllers/table.helpers.js) and the Python
// bl (brainlife/cli/tables.py): same files, same sidecar inheritance. Per-subject sessions/scans
// files are sent as one table each, with participant_id (and session_id for scans) columns added
// from their folders, because the upload API links rows through those columns.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');

// the warehouse accepts JSON bodies up to 2MB
const MAX_BODY = 1900 * 1024;

function classify(rel) {
    let m;
    if(rel == 'participants.tsv') return {kind: 'participants', name: 'participants'};
    if(rel == 'samples.tsv') return {kind: 'samples', name: 'samples'};
    if((m = rel.match(/^phenotype\/([^/]+)\.tsv$/))) return {kind: 'phenotype', name: 'phenotype/'+m[1]};
    if((m = rel.match(/^sub-([^/_]+)\/sub-([^/_]+)_sessions\.tsv$/)) && m[1] == m[2]) {
        return {kind: 'sessions', name: 'sessions', subject: m[1]};
    }
    if((m = rel.match(/^sub-([^/_]+)\/sub-([^/_]+)_scans\.tsv$/)) && m[1] == m[2]) {
        return {kind: 'scans', name: 'scans', subject: m[1]};
    }
    if((m = rel.match(/^sub-([^/_]+)\/ses-([^/_]+)\/sub-([^/_]+)_ses-([^/_]+)_scans\.tsv$/)) && m[1] == m[3] && m[2] == m[4]) {
        return {kind: 'scans', name: 'scans', subject: m[1], session: m[2]};
    }
    return null;
}

// sidecars that apply to a table in BIDS inheritance order (root first, fewest entities first)
function sidecarCandidates(rel) {
    const dirs = rel.split('/');
    const file = dirs.pop();
    const m = file.match(/^((?:[a-z]+-[^_]+_)+)?([a-z]+)\.tsv$/i);
    const entities = m && m[1] ? m[1].slice(0, -1).split('_') : [];
    if(!m || entities.length == 0) return [rel.replace(/\.tsv$/, '.json')];
    const subsets = [[]];
    entities.forEach(e=>subsets.slice().forEach(s=>subsets.push([...s, e])));
    subsets.sort((a, b)=>a.length-b.length);
    const out = [];
    for(let depth = 0; depth <= dirs.length; depth++) {
        const prefix = dirs.slice(0, depth).map(d=>d+'/').join('');
        subsets.forEach(s=>out.push(prefix+[...s, m[2]].join('_')+'.json'));
    }
    return out;
}

function ls(dir) {
    try {
        return fs.readdirSync(dir).sort();
    } catch(err) {
        return [];
    }
}

function findTableFiles(root) {
    const files = [];
    if(ls(root).includes('samples.tsv')) files.push('samples.tsv');
    ls(path.join(root, 'phenotype')).forEach(n=>{ if(n.endsWith('.tsv')) files.push('phenotype/'+n); });
    ls(root).filter(n=>n.startsWith('sub-')).forEach(sub=>{
        ls(path.join(root, sub)).forEach(n=>{
            if(n.endsWith('_sessions.tsv') || n.endsWith('_scans.tsv')) files.push(sub+'/'+n);
            if(n.startsWith('ses-')) ls(path.join(root, sub, n)).forEach(s=>{
                if(s.endsWith('_scans.tsv')) files.push(sub+'/'+n+'/'+s);
            });
        });
    });
    return files.filter(classify);
}

function readSidecar(root, rel, warnings) {
    const merged = {};
    sidecarCandidates(rel).forEach(jrel=>{
        let text;
        try {
            text = fs.readFileSync(path.join(root, jrel), 'utf8');
        } catch(err) {
            return;
        }
        try {
            Object.assign(merged, JSON.parse(text));
        } catch(err) {
            warnings.push(jrel+': sidecar json could not be parsed');
        }
    });
    return merged;
}

function parseTsv(text) {
    const lines = text.split('\n').map(l=>l.replace(/\r$/, '')).filter(l=>l.trim());
    if(!lines.length) return {header: [], rows: []};
    const header = lines.shift().split('\t').map(h=>h.trim());
    const rows = lines.map(line=>{
        const cells = line.split('\t');
        return header.map((h, i)=>(cells[i] || '').trim());
    });
    return {header, rows};
}

function columnsFor(sidecar, header) {
    const columns = {};
    for(const k in sidecar) {
        if(header.includes(k) && sidecar[k] && typeof sidecar[k] == 'object') columns[k] = sidecar[k];
    }
    return Object.keys(columns).length ? JSON.stringify(columns) : undefined;
}

// BIDS tables under root as upload bodies [{name, kind, tsv, json}], and warnings
function collectTables(root) {
    const warnings = [];
    const tables = [];
    const combined = {};
    findTableFiles(root).forEach(rel=>{
        const info = classify(rel);
        let text;
        try {
            text = fs.readFileSync(path.join(root, rel), 'utf8');
        } catch(err) {
            //an unfetched git-annex file is a broken symlink
            warnings.push(rel+': can not be read ('+err.code+')');
            return;
        }
        const sidecar = readSidecar(root, rel, warnings);
        const {header, rows} = parseTsv(text);
        if(info.kind == 'sessions' || info.kind == 'scans') {
            const t = combined[info.name] = combined[info.name] || {kind: info.kind, header: [], rows: [], sidecar: {}};
            const ids = ['participant_id'].concat(info.kind == 'scans' ? ['session_id'] : []);
            ids.concat(header).forEach(c=>{ if(!t.header.includes(c)) t.header.push(c); });
            rows.forEach(row=>{
                const values = {};
                header.forEach((h, i)=>{ values[h] = row[i]; });
                if(!values.participant_id) values.participant_id = 'sub-'+info.subject;
                if(info.session && !values.session_id) values.session_id = 'ses-'+info.session;
                t.rows.push(values);
            });
            for(const k in sidecar) if(!(k in t.sidecar)) t.sidecar[k] = sidecar[k];
        } else {
            tables.push({name: info.name, kind: info.kind, tsv: text, json: columnsFor(sidecar, header)});
        }
    });
    for(const name in combined) {
        const t = combined[name];
        const lines = [t.header.join('\t')].concat(t.rows.map(r=>t.header.map(c=>r[c] || '').join('\t')));
        tables.push({name, kind: t.kind, tsv: lines.join('\n')+'\n', json: columnsFor(t.sidecar, t.header)});
    }
    return {tables, warnings};
}

// send the BIDS tables under root to the project's tables; returns how many were sent.
// A warehouse without /table, a table over the request limit or a failing table is
// reported and skipped: the data objects are uploaded either way.
async function uploadTables(headers, project, root, {api = config.api, log = console.log} = {}) {
    const {tables, warnings} = collectTables(root);
    warnings.forEach(w=>log('! table '+w));
    let sent = 0;
    for(const t of tables) {
        const body = JSON.parse(JSON.stringify(t)); //drops undefined json
        const size = JSON.stringify(body).length;
        if(size > MAX_BODY) {
            log('! table '+t.name+' is too large for the table API ('+size+' bytes); not uploaded');
            continue;
        }
        try {
            await axios.put(api.warehouse+'/table/'+project._id, body, {headers});
            sent++;
        } catch(err) {
            const res = err.response;
            //a warehouse without the route answers with express' default page ("Cannot PUT /table/..")
            if(res && res.status == 404 && String(res.data).includes('Cannot ')) {
                log('! this brainlife.io has no table API yet; tables were not uploaded');
                return sent;
            }
            const msg = res && res.data && res.data.message ? res.data.message : err.message;
            log('! table '+t.name+' was not uploaded: '+msg);
        }
    }
    return sent;
}

module.exports = {classify, sidecarCandidates, collectTables, uploadTables};
