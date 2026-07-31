#!/usr/bin/env node

const commander = require('commander');

commander
    .command('query', 'run a query against all projects')
    .command('create', 'create a new project')
    .command('update', 'update project desc/readme');

commander.parse(process.argv);
