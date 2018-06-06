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
    .option('-i, --id <id>', 'filter datatype by id')
    .option('-q, --query <query>', 'filter datatype by name or description')
    .option('-s, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-r, --raw', 'output data in json format')
    .option('-j, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(async jwt => {
    commander.raw = commander.raw || commander.json;
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    
    try {
        let datatypes = await util.queryDatatypes(headers, {
            id: commander.id,
            search: commander.query
        }, {
            skip: commander.skip,
            limit: commander.limit
        });
        
        if (commander.raw) console.log(JSON.stringify(datatypes));
        else formatDatatypes(headers, datatypes, { all : true }).then(console.log);
    } catch (err) {
        util.errorMaybeRaw(err, commander.raw);
    }
}).catch(err => {
    util.errorMaybeRaw(err, commander.raw);
});

/**
 * Format datatype information
 * @param {datatype[]} data
 * @param {{name: boolean, desc: boolean, files: boolean}} whatToShow
 * @returns {Promise<string>}
 */
function formatDatatypes(headers, data, whatToShow) {
    return new Promise((resolve, reject) => {
        let resultArray = data.map(d => {
            let info = [];
            let formattedFiles = d.files.map(file => {
                return "[" + (file.required?'(required) ':'') + file.id + ": " + (file.filename||file.dirname) + "]";
            }).join('  ');

            if (whatToShow.all || whatToShow.id) info.push("Id: " + d._id);
            if (whatToShow.all || whatToShow.name) info.push("Name: " + d.name);
            if (whatToShow.all || whatToShow.desc) info.push("Description: " + d.desc);
            if (whatToShow.all || whatToShow.files) info.push("Files: " + formattedFiles);

            return info.join('\n');
        });
        
        resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
        resolve(resultArray.join('\n\n'));
    });
}