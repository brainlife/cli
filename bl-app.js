#!/usr/bin/env node

const commander = require('commander');

commander
    .command('query', 'run a query against all datatypes')
    .command('run', 'run a brainlife app')
    .command('wait', 'wait for a running app task to finish')
    .action(cmd => {
        let validCommands = commander.commands
                            .map(command => command._name)
                            .filter(exp => (exp != 'version' && exp != 'help'));
        
        if (validCommands.indexOf(cmd) == -1) commander.outputHelp();
    })
    .parse(process.argv);
