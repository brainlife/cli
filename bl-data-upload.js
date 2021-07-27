#!/usr/bin/env node

const request = require('request-promise-native');
const axios = require('axios');
const config = require('./config');
const fs = require('fs');
const async = require('async');
const archiver = require('archiver');
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');

commander
    .option('-p, --project <projectid>', 'project id to upload dataset to')
    .option('-d, --datatype <datatype>', 'datatype of uploaded dataset')
    .option('--datatype_tag <datatype_tag>', 'add a datatype tag to the uploaded dataset', util.collect, [])
    .option('-n, --desc <description>', 'description of uploaded dataset')
    .option('-s, --subject <subject>', '(metadata) subject of the uploaded dataset')
    .option('-e, --session <session>', '(metadata) session of the uploaded dataset')
    .option('-r, --run <run>', '(metadata) run of the uploaded dataset')
    .option('-t, --tag <tag>', 'add a tag to the uploaded dataset', util.collect, [])
    .option('-m, --meta <metadata-filename>', 'file path for (sidecar).json containing additional metadata')
    .option('-j, --json', 'output uploaded dataset information in json format');

//TODO..
//.option('--force', 'force the dataset to be uploaded, even if no validator is present')

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
    if(arg.indexOf("--") === 0 && arg != "--help" && !getcliopt(arg)) {
        fileList[arg.substring(2)] = process.argv[i+1];
        i++; //skip
    } else {
        new_argv.push(arg);
    }
}
commander.parse(new_argv);

try {
    if(!commander.project) throw new Error("Please specify project (-p) to upload data to");
    if(!commander.datatype) throw new Error("Please specify datatype (-d) of the object");
    if(!commander.subject) throw new Error("Please specify subject name (-s)");
} catch(err) {
    console.error(err.toString());
    process.exit(1);
}

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    let dataset = {
        datatype: commander.datatype,
        project: commander.project,
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
            dataset.meta = JSON.parse(fs.readFileSync(commander.meta, 'ascii')); //why ascii?
            uploadDataset(headers, dataset);
        });
    } else {
        uploadDataset(headers, dataset);
    }
});

async function uploadDataset(headers, options) {
    options = options || {};

    let files = options.files || {};
    let desc = options.desc || '';
    let datatype_tags = options.datatype_tags || [];
    let tags = options.tags || [];
    let metadata = options.meta || {};
    let filenames = Object.keys(files);
    
    if (options.subject) {
        metadata.subject = options.subject;
    }
    if (options.session) {
        metadata.session = options.session;
    }
    if (options.run) {
        metadata.run = options.run;
        tags.push("run-"+options.run); //let's add run to tag
    }
    
    let datatype = await util.getDatatype(headers, options.datatype);

    let projects = await util.resolveProjects(headers, options.project);
    if (projects.length == 0) throw new Error("project '" + options.project + "' not found");
    if (projects.length > 1) throw new Error("multiple projects matching '");

    //check to make sure user didn't set anything weird via command line
    for(let id in fileList) {
        let file = datatype.files.find(f=>f.id == id);
        if(!file) {
            console.error("Unknown parameter", "--"+id);
            console.error("Please use the following file IDS for The specified datatype");
            datatype.files.forEach(f=>{
                console.log("--"+f.id, f.filename||f.dirname, f.desc||'')
            });
            process.exit(1);
        }
    }
    
    let archive = archiver('tar', { gzip: true });
    let project = projects[0];

    let instanceName = 'upload.'+project.group_id; //same for web ui upload
    let instance = await util.findOrCreateInstance(headers, instanceName, {project});
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
            if (!options.json) console.log("Looking for " + (file.filename||file.dirname));
            fs.stat(file.filename||file.dirname, (err,stats)=>{
                if(err) {
                    if (file.dirname) {
                        fs.stat(file.dirname, (err, stats) => {
                            if (err) throw new Error("unable to stat " + file.dirname + " ... Does the specified directory exist?");
                            
                            archive.directory(file.dirname, file.dirname);
                            next_file();
                        });
                    } else {
                        if(file.required) throw new Error(err);
                        if (!options.json) console.log("Couldn't find " + file.filename + " but it's not required for this datatype");
                        next_file();
                    }
                } else {
                    archive.file(file.filename, { name: (file.filename||file.dirname) });
                    next_file();
                }
            });
        }
    }, err => {
        if(err) throw err;

        archive.finalize();
        
        //submit noop to upload data
        //warehouse dataset post api need a real task to submit from
        axios.post(config.api.amaretti+"/task", {
            instance_id: instance._id,
            name: instanceName,
            service: 'brainlife/app-noop',
            config: {}, //must exists
        }, {headers}).then(res=>{
            let task = res.data.task;
            if (!options.json) console.log("preparing to upload..");
            util.waitForFinish(headers, task, !options.json, function(err) {
                if(err) throw err;
                if (!options.json) console.log("uploading data..");

                //TODO - update to use axios, and use upload2 api that uses formdata/multipart
                let req = request.post({url: config.api.amaretti+"/task/upload/"+task._id+"?p=upload/upload.tar.gz&untar=true", headers});
                archive.pipe(req);

                req.on('response', res=>{
                    if(res.statusCode != "200") throw new Error(res);

                    if (!options.json) console.log("data successfully uploaded. finalizing upload..");
                    axios.post(config.api.warehouse+'/dataset/finalize-upload', {
                        task: task._id,
                        datatype: datatype._id,
                        subdir: "upload",

                        //data object info
                        datatype_tags,
                        meta: metadata,
                        tags,
                        desc,

                    }, {headers}).then(res=>{
                        if(res.data.validator_task) {
                            if (!options.json) console.log("validating...");
                            util.waitForFinish(headers, res.data.validator_task, !options.json, async (err, archive_task, datasets) => {
                                if (err) {
                                    console.error("validation failed", err);
                                    process.exit(1);
                                } else {
                                    if(!options.json) console.log("validator finished");
                                    if (task.product && !options.json) {
                                        if (task.product.warnings && task.product.warnings.length > 0) {
                                            task.product.warnings.forEach(warning => console.log("Warning: " + warning));
                                        }
                                    }
                                    if(!options.json) {
                                        console.log("successfully uploaded");
                                        console.log("https://"+config.host+"/project/"+project._id+"/dataset/"+datasets[0]._id);
                                    } else {
                                        //finally dump the dataset
                                        console.log(JSON.stringify(datasets[0], null, 4));
                                    }
                                 }
                            });
                        } else {
                            if(!options.json) console.log("no validator registered for this datatype. skipping validation");
                            util.waitForArchivedDatasets(headers, 1, task, !options.json, (err, datasets)=>{
                                if(err) throw err;
                                if(!options.json) console.log("successfully uploaded. data object id:", datasets[0]._id);
                                else {
                                    //finally dump the dataset
                                    console.log(JSON.stringify(datasets[0], null, 4));
                                }
                            })
                        }
                    }).catch(err=>{
                        if(err.response && err.response.data && err.response.data.message) console.log(err.response.data.message);
                        else console.error(err);
                    });
                });
            });
        }).catch(err=>{
            console.error(err);
        });
    });
}

/*
async function getDatatype(headers, query) {
    return new Promise(async (resolve, reject) => {
        axios.get(config.api.warehouse+'/datatype', { 
            headers,
            params: {
                find: JSON.stringify({
                    $or: [ {id: query}, {name: query}, ]
                }),
            } 
        }).then(res=>{
            if(res.data.datatypes.length == 0) return reject("no matching datatype:"+query);
            return resolve(res.data.datatypes[0]);
        });
    });
}
*/


