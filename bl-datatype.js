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
    .command('query', 'run a query against all datatypes')
    .action(cmd => {
        let validCommands = commander.commands
                            .map(command => command._name)
                            .filter(exp => (exp != 'version' && exp != 'help'));
        
        if (validCommands.indexOf(cmd) == -1) commander.outputHelp();
    })
    .parse(process.argv);
