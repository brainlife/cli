const config = require('./config');
const commander = require('commander');
const util = require('./util');
const request = require('request-promise-native');

commander
    .usage('[options] <task_id>')
    .option('-i, --id <task_id>', 'id of task to wait for')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    if (commander.args.length > 0) commander.id = commander.id || commander.args[0];
    if (!commander.id) throw new Error("please specify task id");
    request.get({ url: config.api.amaretti+"/task?find=" + JSON.stringify({_id: commander.id}), headers, json: true}).then(body=>{
        if (body.tasks.length == 0) throw new Error("no tasks found with id " + commander.id);
        util.waitForFinish(headers, body.tasks[0], process.stdout.isTTY, async err => {
            if (err) {
                /*
                try {
                    err = await util.getFileFromTask(headers, 'error.log', body.tasks[0]);
                } catch(err) {
                    //failed to load error.log
                }
                throw "error.log from task (" + body.tasks[0]._id + "):\n" + err;
                */
                throw err;
            }
            console.log("(done waiting)");
        });
    }).catch(err=>{
        console.error(err.message);
    });
});
