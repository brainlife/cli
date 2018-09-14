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
    .usage('[options] (path to the root of bids directory - where you have participants.tsv)')
    .option('-d, --directory <directory>', 'path to the root of bids directory')
    .option('-p, --project <projectid>', 'project id to upload the dataset to')
    .option('-h, --h');

commander.parse(process.argv);

if (commander.h) commander.help();
if (!commander.project) throw new Error("no project given to upload dataset to. -p");
if (commander.args.length > 0) commander.directory = commander.args[0];
if (!commander.directory) throw new Error("please specify BIDS root directory. -d");

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    console.log("usig root", commander.directory);

    /*
    let options = {
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

    let instanceName = 'warehouse-cli.upload';
    let noopService = 'soichih/sca-service-noop';

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
    let instance = await util.getInstance(headers, instanceName);
    let projects = await util.resolveProjects(headers, options.project);
    
    if (projects.length == 0) throw new Error("project '" + options.project + "' not found");
    if (projects.length > 1) throw new Error("multiple projects matching '" + projectSearch + "'");
    
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
            service: noopService,
        }}, (err, res, body) => {
            if(err) throw new Error(res.body.message);
            let task = body.task;

            if (!options.json) console.log("Waiting for upload task to be ready...");
            util.waitForFinish(headers, task, process.stdout.isTTY && !options.json, function(err) {
                if(err) throw err;

                let req = request.post({url: config.api.wf + "/task/upload/" + task._id + "?p=upload.tar.gz&untar=true", headers: headers});
                archive.pipe(req);
                archive.finalize();
                
                req.on('response', res => {
                    if(res.statusCode != "200") throw new Error(res.body.message);
                    if (!options.json) console.log("Dataset successfully uploaded");
                    
                    if (datatype.validator && !datatype.force) {
                        if (!options.json) console.log("Validating data... (" + datatype.validator + ")");
                        let validationConfig = {};
                        datatype.files.forEach(file => {
                            if(!files[file.id]) return; //not set.. probably optional
                            validationConfig[file.id] = "../" + task._id + "/" + file.filename;
                        });
                        request.post({ url: config.api.wf + '/task', headers, json: true, body: {
                            instance_id: instance._id,
                            name: "validation",
                            service: datatype.validator,
                            config: validationConfig,
                            deps: [ task._id ]
                        }},
                        (err, res, body) => {
                            if (err) throw err;
                            else if (res.statusCode != 200) throw new Error(res.body.message);
                            else {
                                let validationTask = body.task;
                                
                                util.waitForFinish(headers, validationTask, process.stdout.isTTY && !options.json, async (err, task) => {
                                    if (err) {
                                        let error_log = await util.getFileFromTask(headers, 'error.log', validationTask, err);
                                        throw new Error("error.log from task (" + validationTask._id + "):\n" + error_log);
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
                            }
                        });
                    } else {
                        console.error("No validator available for this datatype. Skipping validation.");
                        registerDataset(task);
                    }
                    
                    function registerDataset(task) {
                        if (!options.json) console.log("Registering dataset...");

                        request.post({url: config.api.warehouse + '/dataset', json: true, headers: headers, body: {
                            project: project._id,
                            datatype: datatype._id,
                            desc,
                            datatype_tags,
                            tags,

                            meta: metadata,

                            instance_id: instance._id,
                            task_id: task._id, // we archive data from copy task
                            output_id: "output",    // sca-service-noop isn't BL app so we just have to come up with a name
                        }}, (err, res, dataset) => {
                            if(err) throw err;
                            if(res.statusCode != "200") throw new Error("Failed to upload: " + res.body.message);
                            if(!options.json) console.log("Waiting for dataset to archive...");
                            if(!dataset) throw new Error("Failed to upload dataset - probably validation failed");
                            waitForArchive(dataset._id);
                        });
                    }

                    function waitForArchive(id) {
                        request(config.api.warehouse + '/dataset', { json: true, headers, qs: {
                            find: JSON.stringify({'_id': id}),
                        } }, (err, res, body) => {
                            if(err) throw err; 
                            if(body.datasets.length != 1) throw new Error("couldn't find exactly 1 dataset. len="+body.datasets.length);
                            let status = body.datasets[0].status;
                            if(status == "failed") throw new Error("failed to archive");
                            if(status == "stored") {
                                if(!options.json) console.log("Done archiving. dataset id:"+id);
                                else console.log(JSON.stringify(body.datasets[0]));
                                //resolve(body.datasets[0]);
                            } else {
                                //all else... just wait
                                return setTimeout(function() {
                                    waitForArchive(id);
                                }, 5000);
                            }
                        });
                    }
                });
            });
        });
    });
    */
});

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
