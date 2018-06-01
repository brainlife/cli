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
    .option('-i, --id <id>', 'filter resources by id')
    .option('-s, --search <search>', 'filter resources by name')
    .option('--stat, --status <status>', 'filter resources by status')
    .option('--serv, --service <service>', 'filter resources by service')
    .option('--sk, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-r, --raw', 'output data in json format')
    .option('-j, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    commander.raw = commander.raw || commander.json;
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };

    util.queryResources(headers, commander.id, commander.search, commander.status, commander.service, commander.skip, commander.limit)
    .then(resources => {
        if (commander.raw) console.log(JSON.stringify(resources));
        else formatResources(headers, resources, { all: true }).then(console.log);
    }).catch(console.error);
}).catch(console.error);

/**
 * Format resource information
 * @param {resource[]} data
 * @param {{name: boolean, desc: boolean, files: boolean}} whatToShow
 * @returns {Promise<string>}
 */
function formatResources(headers, data, whatToShow) {
    return new Promise((resolve, reject) => {
        let resultArray = data.map(d => {
            let info = [];

            if (whatToShow.all || whatToShow.id) info.push("Id: " + d._id);
            if (whatToShow.all || whatToShow.name) info.push("Name: " + d.name);
            if (whatToShow.all || whatToShow.files) info.push("Type: " + d.type);
            if (d.config && (whatToShow.all || whatToShow.files)) info.push(d.type + ": " + d.config.username + "@" + (d.config.hostname || '[' + d.resource_id + ']'));

            return info.join('\n');
        });
        
        resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
        resolve(resultArray.join('\n\n'));
    });
}