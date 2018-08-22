#!/usr/bin/env node

const request = require('request');
const config = require('./config');
const fs = require('fs');
const async = require('async');
//const WebSocketClient = require('websocket').client;
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter resources by id')
    .option('-q, --query <query>', 'filter resources by name')
    .option('-t, --status <status>', 'filter resources by status')
    .option('-v, --service <service>', 'filter resources by service')
    .option('-s, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-j, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    
    util.queryResources(headers, {
        id: commander.id,
        search: commander.query,
        status: commander.status,
        service: commander.service,
    }, {
        skip: commander.skip,
        limit: commander.limit
    }).then(resources=>{
        if (commander.json) console.log(JSON.stringify(resources));
        else formatResources(headers, resources, { all: true }).then(console.log);
    }).catch(err=>{
        console.error(err);
    });
});

/**
 * Format resource information
 * @param {resource[]} data
 * @param {{name: boolean, desc: boolean, files: boolean}} whatToShow
 * @returns {Promise<string>}
 */
function formatResources(headers, data, whatToShow) {
    return new Promise((resolve, reject) => {
        let resultArray = data.map(resource => {
            let info = [];

            if (whatToShow.all || whatToShow.id) info.push("Id: " + resource._id);
            if (whatToShow.all || whatToShow.name) info.push("Name: " + resource.name);
            if (whatToShow.all || whatToShow.files) info.push("Type: " + resource.type);
            if (resource.config && (whatToShow.all || whatToShow.files)) info.push(resource.type + ": " + resource.config.username + "@" + (resource.config.hostname || '[' + resource.resource_id + ']'));

            return info.join('\n');
        });
        
        resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
        resolve(resultArray.join('\n\n'));
    });
}
