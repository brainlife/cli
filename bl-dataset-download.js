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
    .option('-i, --id <id>', 'download a dataset with the given id')
    .option('-r, --raw', 'output raw (JSON) information about the downloaded dataset')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    downloadDataset(headers, commander.id, commander.raw);
}).catch(console.error);

/**
 * Download a dataset
 * @param {string} query
 * @param {any} headers
 */
function downloadDataset(headers, query, raw) {
    util.queryDatasets(headers, query)
    .then(datasets => {
        if (datasets.length != 1) util.errorMaybeRaw(res.body.message, 'Error: invalid dataset id given');
        
        let id = datasets[0]._id;
        console.log("Streaming dataset to " + id);

        fs.mkdir(id, err => {
            request.get({ url: config.api.warehouse+"/dataset/download/" + id, headers })
            .on('response', res => {
                if(res.statusCode != 200) util.errorMaybeRaw(res.body.message, commander.raw);
            }).pipe(tar.x({ C: id }));
        });
    });
}