#!/usr/bin/env node

const request = require('request-promise-native');
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
    .usage('[options] (directory)')
    .option('--dir, --directory <directory>', 'directory where your dataset is located')
    .option('-p, --project <projectid>', 'project id to upload dataset to')
    .option('-d, --datatype <datatype>', 'datatype of uploaded dataset')
    .option('--datatype_tag <datatype_tag>', 'add a datatype tag to the uploaded dataset')
    .option('--desc, --description <description>', 'description of uploaded dataset')
    .option('-s, --subject <subject>', 'subject of the uploaded dataset')
    .option('--se, --session <session>', 'session of the uploaded dataset')
    .option('-t, --tag <tag>', 'add a tag to the uploaded dataset')
    .option('-m, --meta <metadata-filename>', 'name of file containing additional metadata (JSON) of uploaded dataset')
    .option('-r, --raw', 'output uploaded dataset information in json format')
    .option('-j, --json', 'output uploaded dataset information in json format')
    .option('--force', 'force the dataset to be uploaded, even if no validator is present')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    commander.raw = commander.raw || commander.json;
    if (commander.h) commander.help();
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
    } else {
        doUpload();
    }
    
    function doUpload() {
        uploadDataset(headers, {
            datatype: commander.datatype,
            project: commander.project,
            directory: commander.directory,
            description: commander.description,
            datatype_tags: argv['datatype_tag'],
            subject: commander.subject,
            session: commander.session,
            tags: argv['tag'], meta,
            raw: commander.raw,
            force: commander.force });
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
function uploadDataset(headers, options) {
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
        let datatypes, projects;
        
        if (util.isValidObjectId(options.datatype)) {
            datatypes = await util.queryDatatypes(headers, { id: options.datatype });
        } else {
            datatypes = await util.queryDatatypes(headers, { search: options.datatype });
        }
        
        if (util.isValidObjectId(options.project)) {
            projects = await util.queryProjects(headers, { id: options.project });
        } else {
            projects = await util.queryProjects(headers, { search: options.project });
        }
        
        if (datatypes.length == 0) util.errorMaybeRaw("Error: datatype '" + options.datatype + "' not found", options.raw);
        if (datatypes.length > 1) util.errorMaybeRaw("Error: multiple datatypes matching '" + datatypeSearch + "'", options.raw);
        
        if (projects.length == 0) util.errorMaybeRaw("Error: project '" + options.project + "' not found", options.raw);
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
            if(err) util.error(err);

            //submit noop to upload data
            //warehouse dataset post api need a real task to submit from
            request.post({ url: config.api.wf + "/task", headers, json: true, body: {
                instance_id: instance._id,
                name: instanceName,
                service: noopService,
            }},
            (err, res, body) => {
                if(err) util.error("Error: " + res.body.message);
                let task = body.task;

                if (!options.raw) console.log("Waiting for upload task to be ready...");
                util.waitForFinish(headers, task, process.stdout.isTTY && !options.raw, function(err) {
                    if(err) util.error(err);
                    let req = request.post({url: config.api.wf + "/task/upload/" + task._id + "?p=upload.tar.gz&untar=true", headers: headers});
                    let tar = spawn('tar', taropts, { cwd: directory });
                    tar.stdout.pipe(req);
                    
                    req.on('response', res => {
                        if(res.statusCode != "200") util.error("Error: " + res.body.message);
                        if (!options.raw) console.log("Dataset successfully uploaded");
                        
                        if (datatype.validator && !datatype.force) {
                            if (!options.raw) console.log("Validating data... (" + datatype.validator + ")");
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
                                if (err) util.error(err);
                                else if (res.statusCode != 200) util.error(res.body.message);
                                else {
                                    let validationTask = body.task;
                                    util.waitForFinish(headers, validationTask, process.stdout.isTTY && !options.raw, (err, task) => {
                                        if (err) util.error(err);
                                        if (task.product) {
                                            if (!options.raw) {
                                                if (task.product.warnings && task.product.warnings.length > 0) {
                                                    task.product.warnings.forEach(warning => console.log("Warning: " + warning));
                                                } else {
                                                    console.log("Your data looks good!");
                                                }
                                            }
                                        }
                                        registerDataset();
                                    });
                                }
                            });
                        } else {
                            if (!options.raw && !options.force) util.error("Warning: There currently exists no validator for this dataset's datatype. If you would like to upload your data anyways, use bl dataset upload --force");
                            registerDataset();
                        }
                        
                        function registerDataset() {
                            if (!options.raw) console.log("Registering dataset...");

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
                            }}, async (err, res, body) => {
                                if(err) util.error(err);
                                if(res.statusCode != "200") util.error("Failed to upload: " + res.body.message);
                                if(!options.raw) console.log("Waiting for dataset to archive...");
                                
                                let dataset = waitForArchive(body._id);
                                if (options.raw) console.log(dataset);
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

                                if(!options.raw) console.log("Done archiving. dataset id:"+id);
                                resolve(body.datasets[0]);
                            });
                        }
                    });
                });
            });
        });
    });
}
