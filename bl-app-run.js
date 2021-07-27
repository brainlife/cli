#!/usr/bin/env node

const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('--id <app id>', 'id of app to run')
    .option('--input <input id>', 'add an input to the application (by input id)', util.collect, [])
    .option('--project <project id>', 'the project to store the output dataset from an app')
    .option('--preferred-resource <resource id>', 'user-preferred resource to use to run an app')
    .option('--branch <resource id>', 'github branch to use to run this app (default: master)')
    .option('--config <json string>', 'config to use for running the app')
    .option('--tag <tag>', 'add a tag to the archived dataset', util.collect, [])
    .option('-j, --json', 'output resulting app task in json format')
    .parse(process.argv);

try {
    if(!commander.project) throw new Error("Please specify project id (-p) used to run the app.");
    if(!commander.id) throw new Error("Please specify app id (--id)");
} catch(err) {
    console.error(err.toString());
    process.exit(1);
}
util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };


    util.runApp(headers, {
        app: commander.id,
        inputs: commander.input,
        project: commander.project,
        resource: commander.preferredResource,
        branch: commander.branch,
        config: commander.config,
        tags: commander.tag,
        json: commander.json,
    }).then(task=>{
        if (commander.json) console.log(JSON.stringify(task, null, 4));
    }).catch(err=>{
        console.error(err);
    });
});
