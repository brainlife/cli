#!/usr/bin/env node

const request = require('request-promise-native');
const config = require('./config');
const fs = require('fs');
const async = require('async');
const archiver = require('archiver');
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');
const path = require('path');
const validate = require('bids-validator');
const terminalOverwrite = require('terminal-overwrite');

const bids_walker = require('./bids-walker');

commander
    .usage('[options] (path to the root of bids directory - where you have participants.tsv)')
    .option('-d, --directory <directory>', 'path to the root of bids directory')
    .option('-p, --project <projectid>', 'project id to upload the dataset to')
    .option('-v, --validate', 'Run BIDS validator')
    .option('-t, --tag <tag>', 'add a tag to all uploaded dataset', util.collect, [])
    .option('-h, --h')
    .parse(process.argv);

if (commander.h) commander.help();
if (commander.args.length > 0) commander.directory = commander.args[0];
if (!commander.directory) throw new Error("please specify BIDS root directory. -d");

if(commander.validate) {
    console.log("Running bids validator");
    validate.BIDS(commander.directory, {ignoreWarnings: true}, (issues, structure)=>{
        console.log(JSON.stringify(issues, null, 4));
    });
} else {
    if (!commander.project) throw new Error("no project given to upload dataset to. -p");

    console.log("Uploading..");
    util.loadJwt().then(async jwt => {
        let headers = { "Authorization": "Bearer " + jwt };

        let instanceName = 'warehouse-cli.bidsupload';
        let instance = await util.findOrCreateInstance(headers, instanceName);
        let projects = await util.queryProjects(headers, {id: commander.project, search: commander.project});
        if (projects.length == 0) throw new Error("project '" + commander.project + "' not found");
        if (projects.length > 1) throw new Error("multiple projects matching '");
        let project = projects[0];
        let datatypes = {};
        (await util.queryAllDatatypes(headers)).forEach(datatype=>{
            datatypes[datatype.name] = datatype._id;
        });

        console.log("uploading to following project");
        console.dir(project);

        console.log("walking bids directory");
        bids_walker.walk(commander.directory, (err, bids)=>{
            if(err) throw err;

            let datasets = bids.datasets;
            //other things will be..
            //bids.README
            //bids.CHANGES
            //bids.participants
            //bids.dataset_description

            console.log("preparing upload destination");
            async.eachSeries(datasets, (dataset_and_files, next_dataset)=>{
                console.log("duplication check..", dataset_and_files.dataset.meta.subject, dataset_and_files.dataset.desc);
                request(config.api.warehouse + '/dataset', { json: true, headers, qs: {
                    find: JSON.stringify({
                        project: project._id,
                        removed: false, 
                        datatype: datatypes[dataset_and_files.dataset.datatype],
                        desc: dataset_and_files.dataset.desc, 
                        'meta.subject': dataset_and_files.dataset.meta.subject, 
                        //datatype_tags: dataset.dataset.datatype_tags //desc should take care of it?
                    }),
                }}).then(async body=>{
                    if(body.count == 0) {
                        let noop = await submit_noop(dataset_and_files.dataset);
                        do_upload(noop, dataset_and_files, next_dataset);
                    } else {
                        console.log("already uploaded");
                        next_dataset();
                    }
                });
            }, err=>{
                if(err) throw err;
                console.log("all done");
            });
        });

        function do_upload(noop, dataset_and_files, cb) {
            //console.log("uploading dataset", dataset_and_files);
            
            //create tar ball with all files
            let archive = archiver('tar', { gzip: true });
            //console.dir(dataset_and_files.files);
            for(var path in dataset_and_files.files) {
                //console.log("looking for", path, dataset_and_files.files[path]);
                archive.file(fs.realpathSync(dataset_and_files.files[path]), { name: path });
            }
            archive.on('error', err=>{
                throw err;
            });

            //then pipe to the noop
            let req = request.post({url: config.api.wf + "/task/upload/" + noop._id + "?p=upload.tar.gz&untar=true", headers: headers});
            archive.pipe(req);
            archive.finalize();

            let total = 0;
            archive.on('data', data=>{
                total += data.length; 
                //console.log(total);
            });
            let progress = setInterval(()=>{
                terminalOverwrite.clear();
                terminalOverwrite("transferred: "+(total/(1024*1024)).toFixed(1)+"MB");
            }, 5000);

            req.on('response', async res=>{
                clearInterval(progress);
                terminalOverwrite.done();

                if(res.statusCode != "200") throw res;
                let dataset = dataset_and_files.dataset;
                console.log("Dataset successfully uploaded.. now registering dataset");
                if(commander.tags) {
                    //append user specified tags to all dataset tags
                    let all = new Set([...commander.tags, ...dataset.tags]); //dedup
                    dataset.tags = [...all]; //convert back to array
                }
                request.post({url: config.api.warehouse + '/dataset', json: true, headers: headers, body: {
                    project: project._id,
                    task_id: noop._id,
                    output_id: "output", //app-noop isn't BL app so we just have to come up with a name (TODO why not register app?)

                    meta: dataset.meta,
                    desc: dataset.desc,
                    tags: dataset.tags,

                }}).then(_dataset=>{
                    console.log("registered dataset:", _dataset._id);
                    cb();
                });  
            });
        }

        function submit_noop(dataset) {

            //submit noop to upload data
            //warehouse dataset post api need a real task to submit from
            return request.post({ url: config.api.wf + "/task", headers, json: true, body: {
                instance_id: instance._id,
                name: instanceName,
                service: 'brainlife/app-noop',
                config: {
                    _outputs: [{
                        id: "output",
                        datatype: dataset.datatype,
                        datatype: datatypes[dataset.datatype],
                        datatype_tags: dataset.datatype_tags,
                        meta: dataset.meta,
                    }]
                }
            }}).then(body=>{
                let task = body.task;
                console.log("Waiting for upload task to be ready...");
                return new Promise((resolve, reject)=>{
                    util.waitForFinish(headers, task, true, err=>{
                        if(err) return reject(err);
                        resolve(task);
                    });
                });
            });
        }
    });
}
