#!/usr/bin/env node

const config = require('./config');
const commander = require('commander');
const util = require('./util');
const request = require('request-promise-native');

commander
    .usage('[options] <task_id>')
    .option('-i, --id <task_id>', 'id of task to wait for')
    .parse(process.argv);

try {
    if(commander.args.length > 0) commander.id = commander.id || commander.args[0];
    if(!commander.id) throw new Error("please specify task id");
} catch(err) {
    console.error(err.toString());
    process.exit(1);
}

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    request.get({ url: config.api.amaretti+"/task?find=" + JSON.stringify({_id: commander.id}), headers, json: true}).then(body=>{
        if (body.tasks.length == 0) throw new Error("no tasks found with id " + commander.id);
        util.waitForFinish(headers, body.tasks[0], process.stdout.isTTY, async err => {
            if (err) throw err;
            console.log("(done waiting)");
        });
    }).catch(err=>{
        console.error(err.message);
    });
});
