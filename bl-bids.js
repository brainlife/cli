#!/usr/bin/env node

const commander = require('commander');

commander
    .command('download', 'download datasets in bids structure')
    .command('upload', 'upload datasets in bids structure');

if (commander.parse(process.argv)) {
    commander.help();
}
