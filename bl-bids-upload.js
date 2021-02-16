#!/usr/bin/env node

const request = require('request-promise-native');
const axios = require('axios');
const config = require('./config');
const fs = require('fs');
const async = require('async');
const archiver = require('archiver');
const commander = require('commander');
const util = require('./util');
const path = require('path');
const terminalOverwrite = require('terminal-overwrite');
const jsonwebtoken = require('jsonwebtoken');

const bids_walker = require('./bids-walker');

commander
    .usage('[options] (path to the root of bids directory - where you have dataset_description.json)')
    .option('-d, --directory <directory>', 'path to the root of bids directory')
    .option('-p, --project <projectid>', "project id to upload the dataset to. if you don't specify, it will create a new project (authentication token will be refreshed)")
    .option('-t, --tag <tag>', 'add a tag to all uploaded dataset', util.collect, [])
    .option('-h, --h')
    .parse(process.argv);

if (commander.h) commander.help();
if (commander.args.length > 0) commander.directory = commander.args[0];
if (!commander.directory) throw new Error("please specify BIDS root directory. -d");

util.loadJwt().then(async jwt => {
    let headers = { "Authorization": "Bearer " + jwt };

    bids_walker.walk(commander.directory, async (err, bids)=>{
        if(err) throw err;

        let project;
        if(commander.project) {
            let projects = await util.queryProjects(headers, {id: commander.project, search: commander.project});
            if (projects.length == 0) throw new Error("project '" + commander.project + "' not found");
            if (projects.length > 1) throw new Error("multiple projects matching '");
            project = projects[0];
        }

        if(!project) {
            project = await createProject(bids);

            //I need to refresh project token as group id is stored in jwt token
            let token = jsonwebtoken.decode(jwt);
            let expDate = new Date(token.exp*1000);
            let now = new Date();
            let diff = expDate.getTime() - now.getTime();
            let ttl = Math.ceil(diff/(1000*3600*24));
            
            //console.dir(token);
            //console.log("expiration:", expDate);
            //console.log("diff:", diff);
            //console.log("using ttl", (diff/(1000*3600*24)));
            jwt = await util.refresh({ttl}, headers);
            headers = { "Authorization": "Bearer " + jwt };
            //token = jsonwebtoken.decode(jwt);
            //console.log(JSON.stringify(token, null, 4));
        }
        if(bids.participants || bids.participant_json) {
            await updateParticipant(bids, project);
        }

        let instanceName = 'warehouse-cli.bidsupload.'+project.group_id;
        let instance = await util.findOrCreateInstance(headers, instanceName, {project});

        let datatypes = {};
        (await util.queryAllDatatypes(headers)).forEach(datatype=>{
            datatypes[datatype.name] = datatype._id;
        });

        let datasets = bids.datasets;
        async.eachSeries(datasets, (dataset_and_files, next_dataset)=>{
            console.info("uploading an object...")
            console.dir(dataset_and_files);
            
            //similar code exists in bin/importdatalad.js
            let itemkey = {
                project: project._id,
                removed: false, 
                datatype: datatypes[dataset_and_files.dataset.datatype],
                desc: dataset_and_files.dataset.desc,  //TODO - too brittle.. what if user updates desc?
                'meta.subject': dataset_and_files.dataset.meta.subject,
            };
            if(dataset_and_files.dataset.meta.session) {
                itemkey['meta.session'] = dataset_and_files.dataset.meta.session;
            }

            //need to append any bids entities that make this object unique
            //https://github.com/bids-standard/bids-specification/blob/master/src/schema/entities.yaml
            let entities = [
                "task", "acq", "ce", "rec", "dir", 
                "run", "mod", "echo", "flip", "inv", "mt", "part", "recording",
                "proc", "split", 
                //"space", "res", "den", "label", "desc" //only for derivatives
            ];
            entities.forEach(e=>{
                if(dataset_and_files.dataset.meta[e]) itemkey["meta."+e] = dataset_and_files.dataset.meta[e];
            })
            
            request(config.api.warehouse + '/dataset', { json: true, headers, qs: {
                find: JSON.stringify(itemkey),
            }}).then(async body=>{
                if(body.count == 0) {
                    let noop = await submit_noop(instance, datatypes, dataset_and_files.dataset);
                    do_upload(noop, project, dataset_and_files, next_dataset);
                } else {
                    console.log("already uploaded.. skipping");
                    next_dataset();
                }
            });
        }, err=>{
            if(err) throw err;
            console.log("BIDS data uploaded to https://"+config.host+"/project/"+project._id);
        });
    });

    function submit_noop(instance, datatypes, dataset) {
        //submit noop to upload data
        //warehouse dataset post api need a real task to submit from
        return request.post({ url: config.api.amaretti + "/task", headers, json: true, body: {
            instance_id: instance._id,
            name: instance.name,
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

    async function walkDir(dir) {
        let files = await fs.promises.readdir(dir);
        files = await Promise.all(files.map(async file => {
            const filePath = path.join(dir, file);
            const stats = await fs.promises.stat(filePath);
            if (stats.isDirectory()) return walkDir(filePath);
            else if(stats.isFile()) return filePath;
        }));
        return files.reduce((all, folderContents) => all.concat(folderContents), []);
    }

    async function do_upload(noop, project, dataset_and_files, cb) {
        
        //create tar ball with all files
        let archive = archiver('tar', { gzip: true });
        for(var path in dataset_and_files.files) {
            let fullpath = dataset_and_files.files[path];

            const stats = await fs.promises.stat(fullpath);
            if(stats.isDirectory()) {
                //archive.file() doesn't handle symlinks, so I need to walk the directory in case it contains symlinks
                let entries = await walkDir(fullpath);
                entries.forEach(entry=>{
                    let subpath = entry.substring(fullpath.length);
                    console.log(entry, path+subpath);
                    archive.append(fs.createReadStream(entry), {name: path+subpath});
                }); 
            } else {
                //regular file
                archive.file(fs.realpathSync(fullpath), { name: path });
            }
        }
        archive.on('error', err=>{
            throw err;
        });

        //then pipe to the noop
        //TODO - replace with axios, and use upload2 API which uses muti-part
        let req = request.post({
            url: config.api.amaretti+"/task/upload/"+noop._id+"?p=upload.tar.gz&untar=true", 
            headers,
        });
        archive.pipe(req);
        archive.finalize();

        let total = 0;
        archive.on('data', data=>{
            total += data.length; 
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
            request.post({url: config.api.warehouse+'/dataset', json: true, headers: headers, body: {
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

    async function createProject(bids) {
        let body = {}
        body.name = bids.dataset_description.Name;
        body.desc = "created by bl bids upload";
        if(bids.README) body.readme = bids.README;
        let res = await axios.post(config.api.warehouse+'/project/', body, {headers});
        //console.log("created new project: ", res.data._id);
        return res.data;
    }

    async function updateParticipant(bids, project) {
        let body = {
            subjects: bids.participants,
            columns: bids.participants_json,
        }
        return axios.put(config.api.warehouse+'/participant/'+project._id, body, {headers});
    }
});

