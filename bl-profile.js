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
    .option('query <query>', 'run a query against all profiles')
    .option('raw', 'output data in raw format (JSON)')
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
    
    if (commander.query) {
        util.queryProfiles(commander.query, headers)
        .then(profiles => {
            profiles = util.filterProfiles(profiles, commander.query);
            if (commander.raw) console.log(JSON.stringify(profiles));
            else util.formatProfiles(profiles, { all: true }, headers).then(console.log);
        }).catch(console.error);
    }
    else commander.outputHelp();
});