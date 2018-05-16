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
const chalk = require('chalk');
const util = require('./util');

commander
    .option('query <query>', 'run a query against all datasets')
    .option('datatype <datatype>', 'filter datasets by datatype')
    .option('project <projectid>', 'filter datasets by project id')
    .option('subject <subject>', 'filter datasets by subject')
    .option('raw', 'output data in raw format (JSON)')
    .option('download <id>', 'download a dataset with the given id')
    
    .option('upload', 'upload a dataset (see options below)')
    .option('--directory <directory>', 'directory to upload')
    .option('--project <projectid>', 'project id to upload dataset to')
    .option('--datatype <datatype>', 'datatype of uploaded dataset')
    .option('--datatype_tags <datatype_tags>', 'datatype_tags of uploaded dataset')
    .option('--subject <subject>', 'subject of uploaded dataset')
    .option('--session <session>', 'session of uploaded dataset')
    .option('--description <description>', 'description of uploaded dataset')
    .option('--tags <tags>', 'tags of uploaded dataset')
    .option('--meta <metadata>', 'file containing metadata (JSON) of uploaded dataset')
    .parse(process.argv);

fs.stat(config.path.jwt, (err, stat)=>{
    if(err) {
        console.log("not logged in?");
        process.exit(1);
    }
    var jwt = fs.readFileSync(config.path.jwt);
    var user = jsonwebtoken.decode(jwt);
    var headers = { "Authorization": "Bearer "+jwt };
    let datatypeTable = {};
    
    if (!commander.upload && (commander.query || commander.datatype || commander.project || commander.subject)) {
        util.queryDatasets(headers, commander.query, commander.datatype, commander.project, commander.subject)
        .then(datasets => {
            if (commander.raw) console.log(JSON.stringify(datasets));
            else util.formatDatasets(headers, datasets, { all: true }).then(console.log);
        }).catch(console.error);
    }
    else if (commander.download) {
        util.downloadDataset(headers, commander.download);
    }
    else if (commander.upload) {
        util.uploadDataset(headers, commander.datatype, commander.project,
            { directory: commander.directory, description: commander.description, datatype_tags: commander.datatype_tags,
              subject: commander.subject, session: commander.session });
    }
    else commander.outputHelp();
});