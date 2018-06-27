#!/usr/bin/env node

const request = require('request-promise-native');
const argv = require('minimist')(process.argv.slice(2));
const config = require('./config');
const fs = require('fs');
const async = require('async');
const archiver = require('archiver');
//const WebSocketClient = require('websocket').client;
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');

commander
    .usage('[options] (directory)')
    .option('--directory <directory>', 'directory where your dataset is located')
    .option('-p, --project <projectid>', 'project id to upload dataset to')
    .option('-d, --datatype <datatype>', 'datatype of uploaded dataset')
    .option('--datatype_tag <datatype_tag>', 'add a datatype tag to the uploaded dataset')
    .option('--desc, --description <description>', 'description of uploaded dataset')
    .option('-s, --subject <subject>', 'subject of the uploaded dataset')
    .option('--se, --session <session>', 'session of the uploaded dataset')
    .option('-t, --tag <tag>', 'add a tag to the uploaded dataset')
    .option('-m, --meta <metadata-filename>', 'name of file containing additional metadata (JSON) of uploaded dataset')
    .option('-j, --json', 'output uploaded dataset information in json format')
    .option('--force', 'force the dataset to be uploaded, even if no validator is present')
    .option('-h, --h');

// parse individual user-inputted files
let fileList = {};
let commanderOptions = {};
commander.options.forEach(option => {
    if (option.long) commanderOptions[option.long.substring(2)] = true;
    if (option.short) commanderOptions[option.short.substring(1)] = true;
});
for (let key in argv) {
    if (key != '_' && !commanderOptions[key]) {
        fileList[key] = argv[key];
        
        let argvIndex = process.argv.indexOf('--' + key);
        if (argvIndex == -1) argvIndex = process.argv.indexOf('-' + key);
        process.argv.splice(argvIndex, 2);
    }
}

commander.parse(process.argv);
util.loadJwt().then(jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    
    if (!argv['tag']) argv['tag'] = [];
    if (!Array.isArray(argv['tag'])) argv['tag'] = [ argv['tag'] ];
    
    if (!argv['datatype_tag']) argv['datatype_tag'] = [];
    if (!Array.isArray(argv['datatype_tag'])) argv['datatype_tag'] = [ argv['datatype_tag'] ];
    
    if (!commander.project) util.errorMaybeRaw(`Error: no project given to upload dataset to`, commander.json);
    if (!commander.datatype) util.errorMaybeRaw(`Error: no datatype of dataset given`, commander.json);
    if (commander.args.length > 0) commander.directory = commander.directory || commander.args[0];
    
    let meta = {};
    if (commander.meta) {
        fs.stat(commander.meta, (err, stats) => {
            if (err) throw err;
            meta = JSON.parse(fs.readFileSync(commander.meta, 'ascii'));
            doUpload();
        });
    } else {
        doUpload();
    }
    
    async function doUpload() {
        try {
            await uploadDataset(headers, {
                datatype: commander.datatype,
                project: commander.project,
                directory: commander.directory,
                files: fileList,
                description: commander.description,
                datatype_tags: argv['datatype_tag'],
                subject: commander.subject,
                session: commander.session,
                tags: argv['tag'], meta,
                json: commander.json,
                });
        } catch (err) {
            util.errorMaybeRaw(err, commander.json);
        }
    }
}).catch(err => {
    util.errorMaybeRaw(err, commander.json);
});

/**
 * Upload a dataset
 * @param {any} headers
 * @param {any} options
 * @returns {Promise<string>}
 */
function uploadDataset(headers, options) {
    return new Promise(async (resolve, reject) => {
        let instanceName = 'warehouse-cli.upload';
        let noopService = 'soichih/sca-service-noop';

        options = options || {};
        let directory = options.directory || '.';
        let files = options.files || {};
        let description = options.description || '';
        let datatype_tags = options.datatype_tags || [];
        let tags = options.tags || [];
        let metadata = options.meta || {};
        let filenames = Object.keys(files);
        
        if (options.subject) metadata.subject = options.subject;
        if (options.session) metadata.session = options.session;
        
        let instance = await util.getInstance(headers, instanceName);
        let datatypes = await util.resolveDatatypes(headers, options.datatype);
        let projects = await util.resolveProjects(headers, options.project);
        
        if (datatypes.length == 0) return reject("Error: datatype '" + options.datatype + "' not found");
        if (datatypes.length > 1) return reject("Error: multiple datatypes matching '" + options.datatype + "'");
        
        if (projects.length == 0) return reject("Error: project '" + options.project + "' not found");
        if (projects.length > 1) return reject("Error: multiple projects matching '" + projectSearch + "'");
        
        let archive = archiver('tar', { gzip: true });
        let datatype = datatypes[0];
        let project = projects[0];
        
        archive.on('error', function(err) {
            return reject(err);
        });
        
        async.forEach(datatype.files, (file, next_file) => {
            if (filenames.length > 0) {
                let path = files[file.id] || files[file.filename||file.dirname];
                
                if (path) {
                    let fullpath = directory + '/' + path;
                    fs.stat(fullpath, (err, stats) => {
                        if (err) {
                            if (file.required) {
                                return reject("Error: unable to stat " + fullpath + " ... Does the file/directory exist?");
                            } else {
                                if (!options.json) console.log("Couldn't find " + (file.filename||file.dirname) + " but it's not required for this datatype");
                                next_file();
                            }
                        } else {
                            if (file.filename) {
                                archive.append(fullpath, { name: file.filename });
                            } else {
                                archive.append(fullpath, file.dirname);
                            }
                            next_file();
                        }
                        
                    });
                } else {
                    if (file.required) return reject("File '" + (file.filename||file.dirname) + "' is required for this datatype but was not provided");
                }
            } else {
                if (!options.json) console.log("Looking for " + directory + "/" + (file.filename||file.dirname));
                fs.stat(directory + "/" + file.filename, (err,stats)=>{
                    if(err) {
                        if (file.dirname) {
                            fs.stat(directory + "/" + file.dirname, (err, stats) => {
                                if (err) return reject("Error: unable to stat " + directory + "/" + file.dirname + " ... Does the directory exist?");
                                
                                archive.append(directory + '/' + file.dirname, file.dirname);
                                next_file();
                            });
                        } else {
                            if(file.required) return reject(err);
                            else {
                                if (!options.json) console.log("Couldn't find " + (file.filename||file.dirname) + " but it's not required for this datatype");
                                next_file();
                            }
                        }
                    } else {
                        archive.append(directory + '/' + file.filename,
                            { name: file.filename });
                        next_file();
                    }
                });
            }
        }, err => {
            if(err) return reject(err);
            
            //submit noop to upload data
            //warehouse dataset post api need a real task to submit from
            request.post({ url: config.api.wf + "/task", headers, json: true, body: {
                instance_id: instance._id,
                name: instanceName,
                service: noopService,
            }},
            (err, res, body) => {
                if(err) return reject("Error: " + res.body.message);
                let task = body.task;

                if (!options.json) console.log("Waiting for upload task to be ready...");
                util.waitForFinish(headers, task, process.stdout.isTTY && !options.json, function(err) {
                    if(err) {
                        return reject(err);
                    }
                    let req = request.post({url: config.api.wf + "/task/upload/" + task._id + "?p=upload.tar.gz&untar=true", headers: headers});
                    archive.pipe(req);
                    archive.finalize();
                    
                    req.on('response', res => {
                        if(res.statusCode != "200") return reject("Error: " + res.body.message);
                        if (!options.json) console.log("Dataset successfully uploaded");
                        
                        if (datatype.validator && !datatype.force) {
                            if (!options.json) console.log("Validating data... (" + datatype.validator + ")");
                            let validationConfig = {};
                            datatype.files.forEach(file => {
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
                                if (err) return reject(err);
                                else if (res.statusCode != 200) return reject(res.body.message);
                                else {
                                    let validationTask = body.task;
                                    
                                    util.waitForFinish(headers, validationTask, process.stdout.isTTY && !options.json, async (err, task) => {
                                        if (err) {
                                            let error_log = await util.getFile(headers, 'error.log', validationTask, err);
                                            return reject("error.log from task (" + validationTask._id + "):\n" + error_log);
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
                                            registerDataset();
                                        }
                                    });
                                }
                            });
                        } else {
                            console.error("No validator available for this datatype. Skipping validation.");
                            registerDataset();
                        }
                        
                        function registerDataset() {
                            if (!options.json) console.log("Registering dataset...");

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
                                if(err) return reject(err);
                                if(res.statusCode != "200") return reject("Failed to upload: " + res.body.message);
                                if(!options.json) console.log("Waiting for dataset to archive...");
                                waitForArchive(body._id);
                            });
                        }

                        function waitForArchive(id) {
                            request.get(config.api.warehouse + '/dataset', { json: true, headers, qs: {
                                find: JSON.stringify({'_id': id}),
                            } }, (err, res, body) => {
                                if(err) return reject(err); 
                                if(body.datasets.length != 1) return reject("couldn't find exactly 1 dataset");
                                if(body.datasets[0].status != "stored") return setTimeout(function() {
                                    waitForArchive(id);
                                }, 5000);

                                if(!options.json) console.log("Done archiving. dataset id:"+id);
                                else console.log(JSON.stringify(body.datasets[0]));
                                resolve(body.datasets[0]);
                            });
                        }
                    });
                });
            });
        });
    });
}