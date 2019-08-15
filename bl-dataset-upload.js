#!/usr/bin/env node

const request = require('request-promise-native');
const config = require('./config');
const fs = require('fs');
const async = require('async');
const archiver = require('archiver');
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');

commander
    .usage('[options] (directory)')
    .option('--directory <directory>', 'directory where your dataset is located')
    .option('-p, --project <projectid>', 'project id to upload dataset to')
    .option('-d, --datatype <datatype>', 'datatype of uploaded dataset')
    .option('--datatype_tag <datatype_tag>', 'add a datatype tag to the uploaded dataset', util.collect, [])
    .option('-n, --desc <description>', 'description of uploaded dataset')
    .option('-s, --subject <subject>', '(metadata) subject of the uploaded dataset')
    .option('-e, --session <session>', '(metadata) session of the uploaded dataset')
    .option('-r, --run <run>', '(metadata) run of the uploaded dataset')
    .option('-t, --tag <tag>', 'add a tag to the uploaded dataset', util.collect, [])
    .option('-m, --meta <metadata-filename>', 'name of file containing additional metadata (JSON) of uploaded dataset')
    .option('-j, --json', 'output uploaded dataset information in json format')
    .option('--force', 'force the dataset to be uploaded, even if no validator is present')
    .option('-h, --h');

function getcliopt(key) {
    let match = commander.options.find(option=>{
        return(option.short == key || option.long == key);
    });
    return match;
}

//parse individual user-inputted files
//TODO - file id could collide with cli options.
let fileList = {};
let new_argv = [];
for(let i = 0;i < process.argv.length; ++i) {
    let arg = process.argv[i];
    if(arg.indexOf("--") === 0 && !getcliopt(arg)) {
        fileList[arg.substring(2)] = process.argv[i+1];
        i++; //skip
    } else {
        new_argv.push(arg);
    }
}
commander.parse(new_argv);

if (commander.h) commander.help();
if (!commander.project) throw new Error("no project given to upload dataset to");
if (!commander.datatype) throw new Error("no datatype of dataset given");
if (!commander.subject) throw new Error("no subject name provided");
if (commander.args.length > 0) commander.directory = commander.args[0];

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    let dataset = {
        datatype: commander.datatype,
        project: commander.project,
        directory: commander.directory,
        files: fileList,
        desc: commander.desc,

        datatype_tags: commander.datatype_tag,
        subject: commander.subject,
        session: commander.session,
        tags: commander.tag, 
        run: commander.run,
        json: commander.json,
    }
    if (commander.meta) {
        fs.stat(commander.meta, (err, stats) => {
            if (err) throw err;
            dataset.meta = JSON.parse(fs.readFileSync(commander.meta, 'ascii'));
            uploadDataset(headers, dataset);
        });
    } else {
        uploadDataset(headers, dataset);
    }
});

async function uploadDataset(headers, options) {
    let instanceName = 'warehouse-cli.upload';

    options = options || {};
    let directory = options.directory || '.';
    let files = options.files || {};
    let desc = options.desc || '';
    let datatype_tags = options.datatype_tags || [];
    let tags = options.tags || [];
    let metadata = options.meta || {};
    let filenames = Object.keys(files);
    
    if (options.subject) metadata.subject = options.subject;
    if (options.session) metadata.session = options.session;
    if (options.run) metadata.run = options.run;
    
    let datatype = await getDatatype(headers, options.datatype);
    let instance = await util.findOrCreateInstance(headers, instanceName);

    let projects = await util.resolveProjects(headers, options.project);
    if (projects.length == 0) throw new Error("project '" + options.project + "' not found");
    if (projects.length > 1) throw new Error("multiple projects matching '");
    
    let archive = archiver('tar', { gzip: true });
    let project = projects[0];
    
    archive.on('error', err=>{
        throw new Error(err);
    });
    
    async.forEach(datatype.files, (file, next_file) => {
        if (filenames.length > 0) {
            let path = files[file.id] || files[file.filename||file.dirname]; //TODO - explain.
            if (path) {
                fs.stat(path, (err, stats) => {
                    if (err) {
                        if (file.required) {
                            throw new Error("unable to stat " + path + " ... Does the file/directory exist?");
                        } else {
                            if (!options.json) console.log("Couldn't find " + (file.filename||file.dirname) + " but it's not required for this datatype");
                            next_file();
                        }
                    } else {
                        if (file.filename) {
                            archive.file(path, { name: file.filename });
                        } else {
                            archive.directory(path, file.dirname);
                        }
                        next_file();
                    }
                    
                });
            } else {
                if (file.required) throw new Error("File '" + (file.filename||file.dirname) + "' is required for this datatype but was not provided");
                next_file();
            }
        } else {
            if (!options.json) console.log("Looking for " + directory + "/" + (file.filename||file.dirname));
            fs.stat(directory + "/" + file.filename, (err,stats)=>{
                if(err) {
                    if (file.dirname) {
                        fs.stat(directory + "/" + file.dirname, (err, stats) => {
                            if (err) throw new Error("unable to stat " + directory + "/" + file.dirname + " ... Does the directory exist?");
                            
                            archive.directory(directory + '/' + file.dirname, file.dirname);
                            next_file();
                        });
                    } else {
                        if(file.required) throw new Error(err);
                        if (!options.json) console.log("Couldn't find " + (file.filename||file.dirname) + " but it's not required for this datatype");
                        next_file();
                    }
                } else {
                    archive.file(directory + '/' + file.filename, { name: file.filename });
                    next_file();
                }
            });
        }
    }, err => {
        if(err) throw new Error(err);
        
        //submit noop to upload data
        //warehouse dataset post api need a real task to submit from
        request.post({ url: config.api.wf + "/task", headers, json: true, body: {
            instance_id: instance._id,
            name: instanceName,
            service: 'brainlife/app-noop',
            config: {
                _outputs: [{
                    id: "output",
                    datatype: datatype._id,
                    datatype_tags,
                }],
            }

        }}, (err, res, body) => {
            if(err) throw new Error(res.body.message);
            let task = body.task;

            if (!options.json) console.log("Waiting for upload task to be ready...");
            util.waitForFinish(headers, task, process.stdout.isTTY && !options.json, function(err) {
                if(err) throw err;

                if (!options.json) console.log("Uploading data..");
                let req = request.post({url: config.api.wf + "/task/upload/" + task._id + "?p=upload.tar.gz&untar=true", headers: headers});
                archive.pipe(req);
                archive.finalize();
                
                req.on('response', res => {
                    if(res.statusCode != "200") throw new Error(res);
                    if (!options.json) console.log("Dataset successfully uploaded");
                    
                    if (datatype.validator && !datatype.force) {
                        if (!options.json) console.log("Validating data... (" + datatype.validator + ")");
                        datatype.files.forEach(file => {
                            if(!files[file.id]) return; //not set.. probably optional
                            task.config[file.id] = "../" + task._id + "/" + file.filename;
                        });
                        request.post({ url: config.api.wf + '/task', headers, json: true, body: {
                            instance_id: instance._id,
                            name: "validation",
                            service: datatype.validator,
                            config: task.config,
                            deps: [ task._id ]
                        }}, (err, res, body) => {
                            if (err) throw err;
                            if (res.statusCode != 200) throw new Error(res.body.message);
                            let validationTask = body.task;
                            util.waitForFinish(headers, validationTask, process.stdout.isTTY && !options.json, async (err, task) => {
                                if (err) {
                                    let error_log = await util.getFileFromTask(headers, 'error.log', validationTask, err);
                                    throw new Error(error_log);
                                } else {
                                    if (task.product) {
                                        if (!options.json) {
                                            if (task.product.warnings && task.product.warnings.length > 0) {
                                                task.product.warnings.forEach(warning => console.log("Warning: " + warning));
                                            } else {
                                                console.log("Your data looks good!");
                                            }
                                        }
                                    }
                                    registerDataset(validationTask);
                                }
                            });
                        });
                    } else {
                        console.error("No validator available for this datatype. Skipping validation.");
                        registerDataset(task);
                    }
                    
                    function registerDataset(task) {
                        request.post({url: config.api.warehouse + '/dataset', json: true, headers: headers, body: {
                            project: project._id,
                            task_id: task._id, // we archive data from copy task
                            output_id: "output",    // app-noop isn't BL app so we just have to come up with a name (why don't we register one?)
                            meta: metadata,
                            desc,
                            tags,
                        }}, (err, res, dataset) => {
                            if(err) throw err;
                            if(res.statusCode != "200") throw new Error("Failed to register dataset: " + res.body.message);
                            if(!dataset) throw new Error("Failed to register dataset - probably validation failed?");
                            if(!options.json) console.log("registered dataset:"+dataset._id+" .. now waiting to archive");
                            util.waitForArchivedDatasets(headers, dataset.prov.task, !options.json, err=>{
                                if(options.json) console.log(JSON.stringify(dataset, null, 4));
                                else console.log("archived");
                            });
                        });
                    }
                });
            });
        });
    });
}

async function getDatatype(headers, query) {
    return new Promise(async (resolve, reject) => {
        request(config.api.warehouse + '/datatype', { headers, json: true,
            qs: {
                find: JSON.stringify({
                    $or: [ {id: query}, {name: query}, ]
                }),
            } 
        }).then(body=>{;
            if(body.datatypes.length == 0) return reject("no matching datatype:"+query);
            return resolve(body.datatypes[0]);
        });
    });
}
