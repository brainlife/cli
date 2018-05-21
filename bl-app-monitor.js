const config = require('./config');
const commander = require('commander');
const util = require('./util');
const request = require('request');

commander
    .option('--id <task_id>', 'id of task to monitor')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    request.get({ url: config.api.wf + "/task?find=" + JSON.stringify({_id: commander.id}), headers, json: true}, (err, res, body) => {
        if (body.tasks.length == 0) throw "Error: no tasks found with id " + commander.id;
        util.waitForFinish(headers, body.tasks[0], 0, err => {
            if (err) throw err;
            console.log("(done monitoring)");
        });
    });
}).catch(console.error);