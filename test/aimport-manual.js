#!/usr/bin/env node
'use strict';

// Manual end-to-end run of `bl aimport` against the real engine image, with no upload.
// brainlife.io is never contacted: the project and datatype lookups are faked.
//
//   node test/aimport-manual.js <dicom folder> <work folder> <keys folder> [image]
//
// The folders must be under a path Docker can mount (on Colima/macOS: your home folder).

const {run} = require('../bl-aimport');

const PROJECT = '000000000000000000000001';

const [folder, work, keys, image] = process.argv.slice(2);
if (!folder || !work || !keys) {
    console.error('usage: node test/aimport-manual.js <dicom folder> <work folder> <keys folder>');
    process.exit(2);
}

const names = ['neuro/anat/t1w', 'neuro/anat/t2w', 'neuro/dwi', 'neuro/func/task', 'neuro/fmap', 'neuro/asl'];

run({folder, work, keys, image, project: PROJECT, yes: true, upload: false, deface: 'quickshear', target: 'bids'}, {
    loadJwt: async () => 'not-a-real-token',
    queryProjects: async () => [{_id: PROJECT, group_id: 1}],
    projectSubjects: async () => ({existing_subjects: [], existing_sessions: {}}),
    // datatypes without a validator: the host validators are skipped
    queryAllDatatypes: async () => names.map(name => ({name, _id: 'dt-' + name})),
}).then(code => {
    console.log('exit code ' + code);
    process.exit(code);
});
