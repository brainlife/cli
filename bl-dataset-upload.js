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
    .option('--directory <directory>', 'directory where your dataset is located')
    .option('--project <projectid>', 'project id to upload dataset to')
    .option('--datatype <datatype>', 'datatype of uploaded dataset')
    .option('--datatype_tags <datatype_tags>', 'datatype_tags of uploaded dataset')
    .option('--description <description>', 'description of uploaded dataset')
    .option('--subject <subject>', 'subject of uploaded dataset')
    .option('--session <session>', 'session of uploaded dataset')
    .option('--tags <tags>', 'tags of uploaded dataset')
    .option('--meta <metadata>', 'name of file containing metadata (JSON) of uploaded dataset')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    
    if (!commander.project) throw `Error: no project given to upload dataset to`;
    if (!commander.datatype) throw `Error: no datatype of dataset given`;
    
    return util.uploadDataset(headers, commander.datatype, commander.project,
        { directory: commander.directory, description: commander.description, datatype_tags: commander.datatype_tags,
            subject: commander.subject, session: commander.session });
}).catch(console.error);