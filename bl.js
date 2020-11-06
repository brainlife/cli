#!/usr/bin/env node

const commander = require('commander');
const pkg = require('./package');

commander
    .version(pkg.version)
    .command('login', 'login to brainlife and generate a temporary access token')
    .command('refresh', 'refresh authentication token')
    .command('profile', 'query the available list of profiles')
    .command('resource', 'query the available list of resources')
    .command('datatype', 'query the available list of datatypes')
    .command('project', 'create and view brainlife projects')
    .command('pub', 'query brainlife publications')
    .command('data', 'view and utilize stored data objects').alias('dataset')
    .command('bids', 'bids upload / download')
    .command('app', 'query and run brainlife apps');

process.on('uncaughtException', err=>{
    if(err.message) console.error(err.message);
    else console.error(err.toString());
    //if(process.env.DEBUG && err.stack) console.error(err.stack);
    process.exit(1);
});

process.on('unhandledRejection', err=>{
    if(err.message) console.error(err.message);
    else console.error(err.toString());
});

commander.parse(process.argv);
