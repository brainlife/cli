#!/usr/bin/env node

const commander = require('commander');

commander
    .command('query', 'run a query against all resources')
    .action(cmd => {
        let validCommands = commander.commands
                            .map(command => command._name)
                            .filter(exp => (exp != 'version' && exp != 'help'));
        
        if (validCommands.indexOf(cmd) == -1) commander.outputHelp();
    })
    .parse(process.argv);
