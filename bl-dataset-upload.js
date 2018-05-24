#!/usr/bin/env node

const request = require('request');
const argv = require('minimist')(process.argv.slice(2));
const config = require('./config');
const fs = require('fs');
const async = require('async');
const spawn = require('child_process').spawn;
//const WebSocketClient = require('websocket').client;
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');

commander
    .option('-d, --directory <directory>', 'directory where your dataset is located')
    .option('-p, --project <projectid>', 'project id to upload dataset to')
    .option('-d, --datatype <datatype>', 'datatype of uploaded dataset')
    .option('-dt, --datatype_tag <datatype_tag>', 'add a datatype tag to the uploaded dataset')
    .option('--desc, --description <description>', 'description of uploaded dataset')
    .option('-s, --subject <subject>', 'subject of the uploaded dataset')
    .option('-se, --session <session>', 'session of the uploaded dataset')
    .option('-t, --tag <tag>', 'add a tag to the uploaded dataset')
    .option('-m, --meta <metadata-filename>', 'name of file containing additional metadata (JSON) of uploaded dataset')
    .option('-r, --raw', 'output raw information about the uploaded dataset')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    
    if (!argv['tag']) argv['tag'] = [];
    if (!Array.isArray(argv['tag'])) argv['tag'] = [ argv['tag'] ];
    
    if (!argv['datatype_tag']) argv['datatype_tag'] = [];
    if (!Array.isArray(argv['datatype_tag'])) argv['datatype_tag'] = [ argv['datatype_tag'] ];
    
    if (!commander.project) util.errorMaybeRaw(`Error: no project given to upload dataset to`, commander.raw);
    if (!commander.datatype) util.errorMaybeRaw(`Error: no datatype of dataset given`, commander.raw);
    if (commander.args.length > 0) commander.directory = commander.directory || commander.args[0];
    
    let meta = {};
    if (commander.meta) {
        fs.stat(commander.meta, (err, stats) => {
            if (err) util.error(err);
            meta = JSON.parse(fs.readFileSync(commander.meta, 'ascii'));
            doUpload();
        });
    }
    else {
        doUpload();
    }
    
    function doUpload() {
        uploadDataset(headers, commander.datatype, commander.project,
            { directory: commander.directory, description: commander.description, datatype_tags: argv['datatype_tag'],
                subject: commander.subject, session: commander.session, tags: argv['tag'], meta, raw: commander.raw });
    }
}).catch(console.error);

/**
 * Upload a dataset
 * @param {any} headers
 * @param {string} datatypeSearch
 * @param {string} projectSearch
 * @param {{directory: string, description: string, datatype_tags: string, subject: string, session: string, tags: any, meta: any, raw: any}} options
 * @returns {Promise<string>}
 */
function uploadDataset(headers, datatypeSearch, projectSearch, options) {
    return new Promise(async (resolve, reject) => {
        let instanceName = 'warehouse-cli.upload';
        let noopService = 'soichih/sca-service-noop';

        options = options || {};
        let directory = options.directory || '.';
        let description = options.description || '';
        let datatype_tags = options.datatype_tags || [];
        let tags = options.tags || [];
        let metadata = options.meta || {};
        
        if (options.subject) metadata.subject = options.subject || 0;
        metadata.session = options.session || 1;
        
        let instance = await util.getInstance(headers, instanceName);
        let datatypes = await util.matchDatatypes(headers, datatypeSearch);
        let projects = await util.queryProjects(headers, projectSearch);
        
        if (datatypes.length == 0) util.errorMaybeRaw("Error: datatype '" + datatypeSearch + "' not found", options.raw);
        if (datatypes.length > 1) util.errorMaybeRaw("Error: multiple datatypes matching '" + datatypeSearch + "'", options.raw);
        
        if (projects.length == 0) util.errorMaybeRaw("Error: project '" + projectSearch + "' not found", options.raw);
        if (projects.length > 1) util.errorMaybeRaw("Error: multiple projects matching '" + projectSearch + "'", options.raw);
        
        let taropts = ['-czh'];
        let datatype = datatypes[0];
        let project = projects[0];

        async.forEach(datatype.files, (file, next_file) => {
            if (!options.raw) console.log("Looking for " + directory + "/" + (file.filename||file.dirname));
            fs.stat(directory + "/" + file.filename, (err,stats)=>{
                if(err) {
                    if (file.dirname) {
                        fs.stat(directory + "/" + file.dirname, (err, stats) => {
                            if (err) util.errorMaybeRaw("Error: unable to stat " + directory + "/" + file.dirname + " ... Does the directory exist?", options.raw);
                            taropts.push(file.dirname);
                            next_file();
                        });
                    } else {
                        if(file.required) util.errorMaybeRaw(err, options.raw);
                        else {
                            if (!options.raw) console.log("Couldn't find " + (file.filename||file.dirname) + " but it's not required for this datatype");
                            next_file();
                        }
                    }
                } else {
                    taropts.push(file.filename);
                    next_file();
                }
            });
        }, err => {
            if(err) error(err);

            //submit noop to upload data
            //warehouse dataset post api need a real task to submit from
            request.post({ url: config.api.wf + "/task", headers, json: true, body: {
                instance_id: instance._id,
                name: instanceName,
                service: noopService,
            }},
            (err, res, body) => {
                if(err) error("Error: " + res.body.message);
                let task = body.task;

                if (!options.raw) console.log("Waiting for upload task to be ready...");
                util.waitForFinish(headers, task, 0, function(err) {
                    if(err) error(err);

                    if (!options.raw) console.log("Starting upload");

                    let req = request.post({url: config.api.wf + "/task/upload/" + task._id + "?p=upload.tar.gz&untar=true", headers: headers});
                    let tar = spawn('tar', taropts, { cwd: directory });
                    tar.stdout.pipe(req);

                    req.on('response', res => {
                        if(res.statusCode != "200") error("Error: " + res.body.message);
                        if (!options.raw) console.log("Dataset successfully uploaded!\nNow registering dataset...");

                        request.post({url: config.api.warehouse + '/dataset', json: true, headers: headers, body: {
                            project: project._id,
                            desc: description,
                            datatype: datatype._id,
                            datatype_tags,
                            tags: tags,

                            meta: metadata,

                            instance_id: instance._id,
                            task_id: task._id, // we archive data from copy task
                            output_id: "output",    // sca-service-noop isn't BL app so we just have to come up with a name
                        }}, (err, res, body) => {
                            if(err) error(err);
                            if(res.statusCode != "200") error("Failed to upload: " + res.body.message);
                            if (!options.raw) console.log("Finished dataset registration!\n\nYour dataset has been uploaded and registered on Brain Life but requires time to successfully archive. You can view its storage status by running bl dataset query --id " + body._id);
                            else console.log(JSON.stringify(body));
                            resolve(body);
                        });
                    });
                });
            });
        });
    });
}