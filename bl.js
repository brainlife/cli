#!/usr/bin/env node

const process = require('process');
const fs = require('fs');
const commander = require('commander');
const pkg = require('./package');
const util = require('./util');

commander
    .version(pkg.version)
    .command('login', 'login to brainlife and generate a temporary access token')
    .command('profile', 'query the available list of profiles')
    .command('resource', 'query the available list of resources')
    .command('datatype', 'query the available list of datatypes')
    .command('project', 'create and view brainlife projects')
    .command('pub', 'query brainlife publications')
    .command('dataset', 'view and utilize stored datasets')
    .command('app', 'query and run brainlife apps');

// this only returns a value if the user input an invalid command
if (commander.parse(process.argv)) {
    commander.help();
}
