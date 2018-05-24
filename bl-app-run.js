const config = require('./config');
const argv = require('minimist')(process.argv.slice(2));
const commander = require('commander');
const util = require('./util');

commander
    .option('--id <appid>', 'id of app to run')
    .option('--input <input id>', 'add an input to the application (by input id)')
    .option('--output <output id>', 'add an output to the application (by output id)')
    .option('--project <project id>', 'the project to store the output dataset from an app')
    .option('--config <json string>', 'config to use for running the app')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    let datatypeTable = {};
    
    if (!commander.project) throw "Error: No project given to store output dataset";
    if (!commander.id) throw "Error: No app id given";
    
    if (!argv['input']) argv['input'] = [];
    if (!Array.isArray(argv['input'])) argv['input'] = [ argv['input'] ];
    
    if (!argv['output']) argv['output'] = [];
    if (!Array.isArray(argv['output'])) argv['output'] = [ argv['output'] ];
    
    util.runApp(headers, commander.id, argv['input'], argv['output'], commander.project, commander.config);
}).catch(console.error);
