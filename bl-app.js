#!/usr/bin/env node

const commander = require('commander');

commander
    .command('query', 'run a query against all datatypes')
    .command('run', 'run a brainlife app')
    .command('monitor', 'monitor an active brainlife application')
    .parse(process.argv);
