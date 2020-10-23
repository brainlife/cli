#!/usr/bin/env node

const commander = require('commander');

commander
    .command('query', 'query the list of all data objects')
    .command('download', 'download a data object with the given id')
    .command('upload', 'upload a data object')
    .command('update', 'update desc/metadata/tag of a data object')
    .command('delete', 'delete a data object');

if (commander.parse(process.argv)) {
    commander.help();
}
