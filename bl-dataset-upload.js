#!/usr/bin/env node

const request = require('request');
const argv = require('minimist')(process.argv.slice(2));
const config = require('./config');
const fs = require('fs');
const async = require('async');
const spawn = require('child_process').spawn;
//const WebSocketClient = require('websocket').client;
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');

commander
    .option('-f, --directory <directory>', 'directory where your dataset is located', { isDefault: true })
    .option('-p, --project <projectid>', 'project id to upload dataset to')
    .option('-d, --datatype <datatype>', 'datatype of uploaded dataset')
    .option('-dt, --datatype_tag <datatype_tag>', 'add a datatype tag to the uploaded dataset')
    .option('--desc, --description <description>', 'description of uploaded dataset')
    .option('-s, --subject <subject>', 'subject of the uploaded dataset')
    .option('-se, --session <session>', 'session of the uploaded dataset')
    .option('-t, --tag <tag>', 'add a tag to the uploaded dataset')
    .option('-m, --meta <metadata-filename>', 'name of file containing additional metadata (JSON) of uploaded dataset')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    
    if (!argv['tag']) argv['tag'] = [];
    if (!Array.isArray(argv['tag'])) argv['tag'] = [ argv['tag'] ];
    
    if (!argv['datatype_tag']) argv['datatype_tag'] = [];
    if (!Array.isArray(argv['datatype_tag'])) argv['datatype_tag'] = [ argv['datatype_tag'] ];
    
    if (!commander.project) throw `Error: no project given to upload dataset to`;
    if (!commander.datatype) throw `Error: no datatype of dataset given`;
    
    let meta = {};
    if (commander.meta) {
        fs.stat(commander.meta, (err, stats) => {
            if (err) util.error(err);
            meta = JSON.parse(fs.readFileSync(commander.meta, 'ascii'));
            doUpload();
        });
    }
    else {
        doUpload();
    }
    
    function doUpload() {
        util.uploadDataset(headers, commander.datatype, commander.project,
            { directory: commander.directory, description: commander.description, datatype_tags: argv['datatype_tag'],
                subject: commander.subject, session: commander.session, tags: argv['tag'], meta });
    }
}).catch(console.error);