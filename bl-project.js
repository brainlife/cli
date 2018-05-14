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
    .option('-i --id <id>', 'Get project by exact id')
    .option('-s --search <query>', 'Search for project by query')
    .parse(process.argv);

fs.stat(config.path.jwt, (err, stat)=>{
    if(err) {
        console.log("not logged in?");
        process.exit(1);
    }
    let jwt = fs.readFileSync(config.path.jwt);
    let user = jsonwebtoken.decode(jwt);
    let headers = { "Authorization": "Bearer "+jwt };
    let users = {};

    if (!commander.search && !commander.id) commander.outputHelp();
    else {
        getUsers(headers).then(_users => {
            _users.forEach(user => users[user.id] = user );
            
            return getProjects((commander.search || "").split(","), (commander.id || "").split(","), headers);
        }).then(projects=>{
            console.log(projects.map(p => {
                if (p.access.toLowerCase() == 'public') return chalk.rgb(128, 255, 128)(`(${p.access} ) `) +
                    `${chalk.bold(p.name)} [${p._id}] (author: ${users[p.user_id].username})`;
                else return chalk.rgb(255, 128, 128)(`(${p.access}) `) +
                    `${chalk.bold(p.name)} [${p._id}] (author: ${users[p.user_id].username})`;
            }).join('\n'));
        }).catch(err=>{
            console.error(err);
        });
    }
});

function getUsers(headers) {
    return new Promise((resolve, reject) => {
        request.get({ url: config.api.auth + '/profile?limit=3000', headers: headers, json: true }, function(err, res, body) {
            if(err || res.statusCode != 200) return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            resolve(body.profiles);
        });
    });
    profiles = this.$http.get(Vue.config.auth_api+'/profile?limit=3000');
}

function getProjects(searches, ids, headers) {
    var valid_searches = [];
    searches.forEach(q => {
        q = q.trim();
        if (q.length > 0) valid_searches.push(escapeRegExp(q));
    });
    var pattern = valid_searches.join('|');

    return new Promise((resolve, reject)=>{
        var find = { removed: false, $or: [
                    { name: { $regex: pattern, $options: 'ig' } },
                    { desc: { $regex: pattern, $options: 'ig' } } ] };
        
        if (ids) {
            var valid_ids = [];
            ids.forEach(id => {
                id = id.trim();
                if (id.length == 24) valid_ids.push(id);
            });
            if (valid_ids.length > 0) find._id = { $in: valid_ids };
        }
        var sort = { access: 1 };
        
        // console.log("Querying datatypes", find);
        request.get({url: `${config.api.warehouse}/project?find=${JSON.stringify(find)}&sort=${JSON.stringify(sort)}`, headers: headers, json: true}, function(err, res, body) {
            if(err || res.statusCode != 200) return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            resolve(body.projects.sort((a,b) => {
                if (a.access == 'private') return -1;
                if (b.access == 'private') return 1;
                return 0;
            }));
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