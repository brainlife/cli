#!/usr/bin/env node

const commander = require('commander');

commander
    .command('query', 'run a query against all datatypes')
    .command('run', 'run a brainlife app')
    .command('wait', 'wait for a running app task to finish');

commander.parse(process.argv);
