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
    .option('--search <search>', 'filter datatype by id, name, or description')
    .option('--skip <skip>', 'number of results to skip')
    .option('--limit <limit>', 'maximum number of results to show')
    .option('--raw', 'output data in raw format (JSON)')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };

    util.queryDatatypes(headers, commander.search, commander.skip, commander.limit)
    .then(datatypes => {
        if (commander.raw) console.log(JSON.stringify(datatypes));
        else formatDatatypes(headers, datatypes, { all: true }).then(console.log);
    }).catch(console.error);
}).catch(console.error);

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