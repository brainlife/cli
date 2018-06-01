#!/usr/bin/env node

const process = require('process');
const fs = require('fs');
const program = require('commander');
const pkg = require('./package');
const util = require('./util');

program
    .version(pkg.version)
    .command('login', 'login to brainlife and generate a temporary access token')
    .command('profile', 'query the available list of profiles')
    .command('datatype', 'query the available list of datatypes')
    .command('project', 'create and view brainlife projects')
    .command('dataset', 'view and utilize stored datasets')
    .command('app', 'query and run brainlife apps')
    .action(cmd => {
        let validCommands = program.commands
                            .map(command => command._name)
                            .filter(exp => (exp != 'version' && exp != 'help'));
        
        if (validCommands.indexOf(cmd) == -1) program.outputHelp();
    })
    .parse(process.argv);
