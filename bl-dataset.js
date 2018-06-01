#!/usr/bin/env node

const commander = require('commander');

commander
    .command('query', 'query the list of all datasets')
    .command('download', 'download a dataset with the given id')
    .command('upload', 'upload a dataset')
    .action(cmd => {
        let validCommands = commander.commands
                            .map(command => command._name)
                            .filter(exp => (exp != 'version' && exp != 'help'));
        
        if (validCommands.indexOf(cmd) == -1) commander.outputHelp();
    })
    .parse(process.argv);