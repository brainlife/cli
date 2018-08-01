const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('--id <app id>', 'id of app to run')
    .option('--input <input id>', 'add an input to the application (by input id)', collect, [])
    .option('--project <project id>', 'the project to store the output dataset from an app')
    .option('--preferred-resource <resource id>', 'user-preferred resource to use to run an app')
    .option('--branch <resource id>', 'github branch to use to run this app (default: master)')
    .option('--config <json string>', 'config to use for running the app')
    .option('-j, --json', 'output resulting app task in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(async jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    let datatypeTable = {};

    if (commander.h) commander.help();
    if (!commander.project) util.errorMaybeRaw("Error: No project given to store output dataset", commander.json);
    if (!commander.id) util.errorMaybeRaw("Error: No app id given", commander.json);
    
    try {
        let task = await util.runApp(headers, {
            app: commander.id,
            inputs: commander.input,
            project: commander.project,
            resource: commander.preferredResource,
            branch: commander.branch,
            config: commander.config,
            json: commander.json,
        });
        if (commander.json) console.log(JSON.stringify(task));
    } catch (err) {
        util.errorMaybeRaw(err, commander.json);
    }
}).catch(err => {
    util.errorMaybeRaw(err, commander.json);
});

function collect(val, arr) {
    arr.push(val);
    return arr;
}