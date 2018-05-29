const config = require('./config');
const commander = require('commander');
const util = require('./util');
const request = require('request');

commander
    .usage('[options] <task_id>')
    .option('-i, --id <task_id>', 'id of task to wait for')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    if (commander.args.length > 0) commander.id = commander.id || commander.args[0];
    
    request.get({ url: config.api.wf + "/task?find=" + JSON.stringify({_id: commander.id}), headers, json: true}, (err, res, body) => {
        if (body.tasks.length == 0) throw "Error: no tasks found with id " + commander.id;
        util.waitForFinish(headers, body.tasks[0], process.stdout.isTTY, err => {
            if (err) throw err;
            console.log("(done waiting)");
        });
    });
}).catch(console.error);
