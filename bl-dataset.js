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

commander
    .option('-i --id <id>', 'Get dataset by exact id')
    .option('-s --search <query>', 'Search for dataset by query')
    .option('-p --project <id>', 'Filter datasets by project id')
    .parse(process.argv);

fs.stat(config.path.jwt, (err, stat)=>{
    if(err) {
        console.log("not logged in?");
        process.exit(1);
    }
    var jwt = fs.readFileSync(config.path.jwt);
    var user = jsonwebtoken.decode(jwt);
    var headers = { "Authorization": "Bearer "+jwt };

    if (!commander.search && !commander.id && !commander.project) commander.outputHelp();
    else {
        getDatasets((commander.search || "").split(","), (commander.id || "").split(","), headers).then(datasets => {
            console.log(datasets);
        }).catch(err=>{
            console.error(err);
        });
    }
});

function getDatasets(searches, ids, headers) {
    var valid_searches = [];
    searches.forEach(q => {
        q = q.trim();
        if (q.length > 0) valid_searches.push(escapeRegExp(q));
    });
    var pattern = valid_searches.join('|');

    return new Promise((resolve, reject)=>{
        var find = { $or: [
                    { desc: { $regex: pattern, $options: 'ig' } } ] };
        
        if (ids) {
            var valid_ids = [];
            ids.forEach(id => {
                id = id.trim();
                if (id.length == 24) valid_ids.push(id);
            });
            if (valid_ids.length > 0) find._id = { $in: valid_ids };
        }
        var sort = { name: 1 };
        
        // console.log("Querying datatypes", find);
        request.get({url: `${config.api.warehouse}/dataset?find=${JSON.stringify(find)}&sort=${JSON.stringify(sort)}`, headers: headers, json: true}, function(err, res, body) {
            if(err || res.statusCode != 200) return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            resolve(body.datasets);
        });
    });
}

function parseDatatypeFiles(files, indent) {
    var result = "";
    files.sort((a, b) => {
        if (a.dirname) return -1;
        if (b.dirname) return 1;
        return 0;
    })
    .forEach(file => {
        let name = file.filename;
        if (file.dirname) name = file.dirname.endsWith('/') ? file.dirname : file.dirname + '/';
        result += `${indent}[${file.id}: ${name}]`;
    });
    return result;
}

function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}