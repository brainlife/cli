#!/usr/bin/env node

const commander = require('commander');

commander
    .command('query', 'run a query against all resources');

if (commander.parse(process.argv)) {
    commander.help();
}