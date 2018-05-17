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
    .option('query <query>', 'run a query against all datatypes')
    .option('input <types>', 'specify required input types')
    .option('output <types>', 'specify required output types')
    .option('raw', 'output data in raw format (JSON)')
    .option('run', 'run a Brain-Life app (see options below)')
    .option('--app <appid>', 'id of app to run')
    .option('--inputs <inputid1, inputid2, ...>', 'inputs to application')
    .option('--project <projectid>', 'the project to store the output dataset from an app')
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
    
    if (commander.query || commander.input || commander.output) {
        util.queryApps(headers, commander.query, commander.input, commander.output)
        .then(apps => {
            if (commander.raw) console.log(JSON.stringify(apps));
            else util.formatApps(headers, apps, { all : true }).then(console.log);
        }).catch(console.error);
    }
    else if (commander.run) {
        if (!commander.project) throw `Error: No project given to store output dataset`;
        util.runApp(headers, commander.app, commander.inputs, commander.project);
    }
    else commander.outputHelp();
});