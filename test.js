#!/usr/bin/env node

const fs = require('fs');
const brainlife = require('./index');

(async () => {

// log in
let jwt = await brainlife.login('stevengeeky', fs.readFileSync('my.password', 'ascii'));
let headers = { 'Authorization': 'Bearer ' + jwt };

// retrieve the correct datatype tag and project
let datatypes = await brainlife.queryDatatypes(headers, {
    search: 'neuro/anat/t1w'
});
let projects = await brainlife.queryProjects(headers, {
    search: 'Test Project'
});

let t1w = datatypes[0]._id;
let myProject = projects[0]._id;

// get a dataset and an app to run using that dataset
let datasets = await brainlife.queryDatasets(headers, {
    admin: 'stevengeeky',
    datatype: t1w,
    datatypeTags: [ '!acpc_aligned' ],
    project: myProject
});
let apps = await brainlife.queryApps(headers, {
    inputs: [ t1w ],
    outputs: [ t1w ]
});

let myDataset = datasets.reverse()[0]._id;
let appACPCAlignment = apps[0]._id;

// run the app
let appTask = await brainlife.runApp(headers, {
    app: appACPCAlignment,
    project: myProject,
    inputs: ["t1:" + myDataset]
});

// wait until it's finished
brainlife.waitForFinish(headers, appTask, process.stdout.isTTY, err => {
	if (err) throw err;
	console.log('Done!');
});

})();