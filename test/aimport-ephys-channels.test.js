'use strict';

// bl aimport keeps each recording's _channels.tsv (bad channels marked in the engine's QA viewer:
// status, status_description) and _channels.json with its electrophysiology object.

const {describe, it, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const walker = require('../bids-walker');
const {buildArchive} = require('../bids-upload');
const {applyPlan, keepChannels, projectFiles} = require('../aimport/upload');

// the file lists of the live brainlife.io definitions (GET /api/warehouse/datatype, read 2026-11-24)
const CHANNELS = {id: 'channels', filename: 'channels.tsv', required: false};
const DATATYPES = {
    'neuro/eeg/brainvision': {name: 'neuro/eeg/brainvision', _id: 'dt-bv', files: [
        {id: 'eeg', filename: 'eeg.eeg', required: true}, {id: 'vhdr', filename: 'eeg.vhdr', required: true},
        {id: 'vmrk', filename: 'eeg.vmrk', required: true}, CHANNELS,
        {id: 'electrodes', filename: 'electrodes.tsv'}, {id: 'coordsystem', filename: 'coordsystem.json'},
        {id: 'events', filename: 'events.tsv'}, {id: 'events_json', filename: 'events.json'}]},
    'neuro/meg/fif': {name: 'neuro/meg/fif', _id: 'dt-fif', files: [
        {id: 'fif', filename: 'meg.fif', required: true}, CHANNELS, {id: 'events', filename: 'events.tsv'}]},
};
const TSV = 'name\ttype\tunits\tstatus\tstatus_description\nFp1\tEEG\tV\tbad\tflat\nCz\tEEG\tV\tgood\tn/a\n';
const STEM = 'sub-01/eeg/sub-01_task-rest_';
const FILES = ['eeg.vhdr', 'eeg.eeg', 'eeg.vmrk', 'eeg.json', 'channels.tsv', 'channels.json', 'events.tsv'];
const ENTRY = {id: 'e1', subject: '01', session: null, datatype: 'eeg', suffix: 'eeg', entities: {task: 'rest'},
    modality: 'ephys', brainlife_datatype: 'neuro/eeg/brainvision', brainlife_tags: ['rest'], bad_channels: 1};

let root;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-aimport-ch-'));
    fs.writeFileSync(path.join(root, 'dataset_description.json'), '{"Name": "x", "BIDSVersion": "1.11.2"}');
    fs.writeFileSync(path.join(root, 'participants.tsv'), 'participant_id\nsub-01\n');
    fs.mkdirSync(path.join(root, 'sub-01', 'eeg'), {recursive: true});
    for (const f of FILES) {
        const body = f === 'channels.tsv' ? TSV : f.endsWith('.json') ? '{}' : f;
        fs.writeFileSync(path.join(root, STEM + f), body);
    }
});

afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

const walk = () => new Promise((resolve, reject) => walker.walk(root, (err, b) => err ? reject(err) : resolve(b)));

// the names and contents of a gzipped tar
async function tarEntries(item) {
    const {archive, feed} = await buildArchive(item, {log: () => {}});
    const chunks = [];
    archive.on('data', c => chunks.push(c));
    const done = new Promise((resolve, reject) => {
        archive.on('end', resolve);
        archive.on('error', reject);
    });
    await feed();
    archive.finalize();
    await done;
    const tar = zlib.gunzipSync(Buffer.concat(chunks));
    const out = {};
    for (let off = 0; off + 512 <= tar.length;) {
        const name = tar.subarray(off, off + 100).toString().replace(/\0.*$/s, '');
        if (!name) break;
        const size = parseInt(tar.subarray(off + 124, off + 136).toString().replace(/\0.*$/s, '').trim(), 8);
        out[name] = tar.subarray(off + 512, off + 512 + size).toString();
        off += 512 + Math.ceil(size / 512) * 512;
    }
    return out;
}

describe('bl aimport: channels.tsv stays with its recording', () => {
    it('the walked BIDS output already holds channels.tsv and channels.json in the eeg object', async () => {
        const bids = await walk();
        const eeg = bids.datasets.find(d => d.dataset.datatype === 'neuro/eeg/brainvision');
        assert.ok(eeg, JSON.stringify(bids.datasets.map(d => d.dataset.datatype)));
        assert.strictEqual(eeg.files['channels.tsv'], path.join(root, STEM + 'channels.tsv'));
        assert.strictEqual(eeg.files['channels.json'], path.join(root, STEM + 'channels.json'));
    });

    it('a datatype object maps channels.tsv to the `channels` file id and keeps channels.json as an extra file', async () => {
        const bids = await walk();
        const manifest = {e1: FILES.map(f => STEM + f)};
        const applied = applyPlan(bids, {entries: [ENTRY]}, manifest, DATATYPES, root);
        const item = applied.datasets.find(d => d.dataset.datatype === 'neuro/eeg/brainvision');
        assert.deepStrictEqual(item.dataset.datatype_tags, ['rest']);
        assert.strictEqual(item.files['channels.tsv'], path.join(root, STEM + 'channels.tsv'));
        assert.strictEqual(item.files['channels.json'], path.join(root, STEM + 'channels.json'));
        assert.deepStrictEqual(applied.notes, [
            'channels.json kept with sub-01_task-rest_eeg as an extra file (neuro/eeg/brainvision has no channels.json file)']);
        // the uploaded archive holds both, the marks unchanged
        const tar = await tarEntries(item);
        assert.strictEqual(tar['channels.tsv'], TSV);
        assert.ok('channels.json' in tar && 'eeg.vhdr' in tar);
        // and neither goes to project files
        const files = projectFiles(root, applied.datasets);
        assert.ok(!files.some(f => f.includes('channels')), files.join(','));
    });

    it('adds channels.tsv from the manifest when the walked object lacks it', () => {
        const item = {dataset: {datatype: 'neuro/meg/fif', desc: 'x'}, files: {'meg.fif': path.join(root, STEM + 'eeg.eeg')}};
        const notes = keepChannels(item, ENTRY, {e1: [STEM + 'eeg.eeg', STEM + 'channels.tsv']}, DATATYPES['neuro/meg/fif'], root);
        assert.deepStrictEqual(notes, []);
        assert.strictEqual(item.files['channels.tsv'], path.join(root, STEM + 'channels.tsv'));
        assert.ok(!('channels.json' in item.files)); // not in the manifest: not added
    });

    it('a datatype without a channels file still gets channels.tsv, as an extra file, and says so', () => {
        const dt = {name: 'neuro/ieeg/edf', files: [{id: 'edf', filename: 'ieeg.edf', required: true}]};
        const item = {dataset: {datatype: dt.name, desc: 'x'}, files: {}};
        const entry = {...ENTRY, datatype: 'ieeg', suffix: 'ieeg'};
        const notes = keepChannels(item, entry, {e1: FILES.map(f => STEM + f)}, dt, root);
        assert.deepStrictEqual(notes, [
            'channels.tsv kept with sub-01_task-rest_ieeg as an extra file (neuro/ieeg/edf has no channels.tsv file)',
            'channels.json kept with sub-01_task-rest_ieeg as an extra file (neuro/ieeg/edf has no channels.json file)']);
        assert.ok(item.files['channels.tsv'] && item.files['channels.json']);
    });

    it('non-ephys objects are left alone', async () => {
        const bids = await walk();
        const entry = {...ENTRY, brainlife_datatype: 'neuro/anat/t1w'};
        const applied = applyPlan(bids, {entries: [entry]}, {e1: [STEM + 'eeg.vhdr']},
            {'neuro/anat/t1w': {name: 'neuro/anat/t1w', files: []}}, root);
        assert.deepStrictEqual(applied.notes, []);
    });
});
