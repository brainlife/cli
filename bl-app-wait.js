#!/usr/bin/env node

const config = require('./config');
const commander = require('commander');
const util = require('./util');
const request = require('request-promise-native');


let program = new commander.Command();
program
    .storeOptionsAsProperties(true)
    .argument('task-id', 'Id of the task to wait for')
    .parse();

program.parse();

let taskId = program.args[0];

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    request.get({ url: config.api.amaretti+"/task?find=" + JSON.stringify({_id: taskId}), headers, json: true})
        .then(async (body) => {
            if (body.tasks.length == 0) throw new Error("No tasks found with Id " + taskId);
            await util.waitForFinish(headers, body.tasks[0], process.stdout.isTTY);
            console.error("(done waiting)");
        }).catch(err => {
            console.error(err.message);
        });
});
