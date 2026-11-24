'use strict';

// Microscopy (micr) objects of bl aimport. The BIDS walker does not know micr/: each micr plan
// entry's written .ome.zarr directory becomes one brainlife object of the entry's datatype
// (neuro/ome-zarr), tagged with the entry's brainlife_tags. For a reference dataset the directory
// holds only the rebuilt metadata; its chunks are streamed from their source at upload (chunks.js).

const path = require('path');

const MICR_DATATYPE = 'neuro/ome-zarr';

// -> {datasets, warnings, held}: held are the .ome.zarr directories that are not uploaded (no
// registered datatype), kept out of project files too (a store without its chunks is no use there)
function micrDatasets(bidsDir, plan, manifest, datatypesByName) {
    const root = path.resolve(bidsDir);
    const datasets = [];
    const warnings = [];
    const held = [];
    for (const entry of (plan && plan.entries) || []) {
        if (entry.modality !== 'micr' || entry.exclude) continue;
        const rels = ((manifest || {})[entry.id] || []).filter(r => typeof r === 'string' && r.endsWith('.ome.zarr'));
        for (const rel of rels) {
            const full = path.join(root, ...rel.split('/'));
            const desc = path.posix.basename(rel);
            const name = entry.brainlife_datatype || MICR_DATATYPE;
            const datatype = datatypesByName[name];
            // the object's file is named as the datatype's first file (its dirname, e.g. data.ome.zarr)
            const file = datatype && (datatype.files || [])[0];
            const fileName = file && (file.dirname || file.filename || file.id);
            if (!datatype || !fileName) {
                warnings.push(name + (datatype ? ' has no file definition' : ' is not a registered brainlife datatype') +
                    ': ' + desc + ' is not uploaded');
                held.push(full);
                continue;
            }
            const meta = {subject: entry.subject};
            if (entry.session) meta.session = entry.session;
            const sample = (entry.entities || {}).sample;
            if (sample) meta.sample = sample;
            datasets.push({
                dataset: {
                    datatype: name,
                    desc,
                    datatype_tags: [...(entry.brainlife_tags || [])],
                    tags: [],
                    meta,
                },
                files: {[fileName]: full},
            });
        }
    }
    return {datasets, warnings, held};
}

module.exports = {micrDatasets, MICR_DATATYPE};
