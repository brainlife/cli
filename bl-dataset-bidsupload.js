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

commander
    .usage('[options] (path to the root of bids directory - where you have participants.tsv)')
    .option('-d, --directory <directory>', 'path to the root of bids directory')
    .option('-p, --project <projectid>', 'project id to upload the dataset to')
    .option('-s, --skip', '(deprecated - using --force) Skip BIDS validator')
    .option('--force', 'Skip BIDS validator')
    .option('-t, --tag <tag>', 'add a tag to all uploaded dataset', util.collect, [])
    .option('-h, --h');

commander.parse(process.argv);

if (commander.h) commander.help();
if (!commander.project) throw new Error("no project given to upload dataset to. -p");
if (commander.args.length > 0) commander.directory = commander.args[0];
if (!commander.directory) throw new Error("please specify BIDS root directory. -d");

//sub-CC510395_ses-001_T1w.nii.gz
function parseBIDSPath(_path) {
    let obj = {_fullname: _path};
    let base = path.basename(_path);
    let parts = base.split("_");
    parts.forEach(part=>{
        let tokens = part.split("-");
        if(tokens.length == 1) {
            obj._filename = tokens[0];
        }
        if(tokens.length == 2) {
            obj[tokens[0]] = tokens[1];
        }
    });
    return obj;
}

if(commander.skip) upload();
else {
    console.log("Running bids validator");
    validate.BIDS(commander.directory, {ignoreWarnings: true}, (issues, structure)=>{
        console.log(JSON.stringify(issues, null, 4));
        if(!commander.force && issues.errors.length > 0) {
            console.error("BIDS validator detected errors! Please specify --skip to skip validating and try uploading them anyways");
            process.exit(1);
        }
        upload();
    });
}

function upload() {
    util.loadJwt().then(async jwt => {
        let headers = { "Authorization": "Bearer " + jwt };

        let instanceName = 'warehouse-cli.bidsupload';
        let instance = await util.findOrCreateInstance(headers, instanceName);
        let projects = await util.queryProjects(headers, {id: commander.project, search: commander.project});
        if (projects.length == 0) throw new Error("project '" + commander.project + "' not found");
        if (projects.length > 1) throw new Error("multiple projects matching '");
        let project = projects[0];

        console.log("uploading to following project");
        console.dir(project);

        console.log("loading participants.tsv (or -data.tsv)", commander.directory);
        let participants = {};
        let tsv = null;
        if(fs.existsSync(commander.directory+"/participants.tsv")) {
            tsv = fs.readFileSync(commander.directory+"/participants.tsv", "utf8").trim().split("\n");
        }
        if(fs.existsSync(commander.directory+"/participant_data.tsv")) {
            tsv = fs.readFileSync(commander.directory+"/participant_data.tsv", "utf8").trim().split("\n");
        }
        if(tsv) {
            let tsv_head = tsv.shift().split("\t");
            
            //look for subject header..
            let subject_col = 0; //first one by default..
            [ "Observations", "participant_id" ].forEach(key=>{
                let col = tsv_head.indexOf(key);
                if(~col) subject_col = col;
            });
            tsv.forEach(row=>{
                let cols = row.split("\t");
                let subject = cols[subject_col];
                let participant = {};
                cols.forEach((col, idx)=>{
                    if(idx == subject_col) return;
                    participant[tsv_head[idx]] = col;
                });
                participants[subject] = participant;
            });
        }
        
        //TODO - soon I will be posting phenotype info to phenotype collection on warehouse

        let datatype_ids = {};
        (await util.queryAllDatatypes(headers)).forEach(datatype=>{
            datatype_ids[datatype.name] = datatype._id;
        });

        let datasets = []; //list of datasets to upload
        
        //start iterating subject directory
        fs.readdir(commander.directory, (err, dirs)=>{
            if(err) throw err;
            async.eachSeries(dirs, (dir, next_dir)=>{
                const stats = fs.statSync(commander.directory+"/"+dir);
                if(!stats.isDirectory()) return next_dir();
                let fileinfo = parseBIDSPath(dir);
                console.log("handing subject", fileinfo["sub"]);
                console.dir(fileinfo);
                handle_subject(commander.directory+"/"+dir, next_dir);
            }, err=>{
                if(err) throw err;
                upload_datasets();
            });
        });

        function handle_subject(_path, cb) {
            fs.readdir(_path, (err, dirs)=>{
                if(err) return cb(err);
                async.forEach(dirs, (dir, next_dir)=>{
                    if(dir.indexOf("ses-") == 0) return handle_subject(_path+"/"+dir, next_dir);
                    switch(dir) {
                    case "anat": 
                        handle_anat(_path+"/anat", next_dir);
                        break;
                    case "dwi": 
                        handle_dwi(_path+"/dwi", next_dir);
                        break;
                    case "func": 
                        handle_func(_path+"/func", next_dir);
                        break;
                    default:
                        //TODO handle sub-A00000844_ses-20100101_scans.tsv
                        console.log("unknown file/dir:"+_path+"/"+dir);
                        next_dir();
                    }
                }, cb);
            });
        }

        function get_meta(fileinfo) {
            let meta = {};
            for(let key in fileinfo) {
                let inkey = key;
                if(key == "sub") inkey = "subject";
                if(key == "ses") inkey = "session";
                meta[inkey] = fileinfo[key];
            }
            return meta;
        }
        function get_tags(fileinfo) {
            let tags = [];
            if(commander.tag) tags = commander.tag.slice();
            for(let key in fileinfo) {
                if(key == "_filename") continue;
                if(key == "_fullname") continue;
                if(key == "sub") continue;
                if(key == "ses") continue;
                tags.push(key+"-"+fileinfo[key]);
            }
            return tags;
        }

        function handle_dwi(_path, cb) {
            fs.readdir(_path, (err, files)=>{
                if(err) return cb(err);
                async.forEach(files, (file, next_file)=>{
                    let fileinfo = parseBIDSPath(file);
                    switch(fileinfo._filename) {
                    case "dwi.nii.gz":
                        //console.dir(fileinfo);
                        let fullname = fileinfo._fullname;
                        let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
                        let sidecar = get_sidecar(_path+"/"+sidecar_name);

                        let dataset = {
                            datatype: datatype_ids["neuro/dwi"],
                            desc: fileinfo._fullname,
                            
                            //datatype_tags,
                            tags: get_tags(fileinfo),

                            meta: Object.assign(sidecar, get_meta(fileinfo)),
                        }

                        let bvecs = fullname.substring(0, fullname.length-7)+".bvec"; 
                        let bvals = fullname.substring(0, fullname.length-7)+".bval"; 
                        let files = {
                            "dwi.nii.gz": _path+"/"+fileinfo._fullname,
                            "dwi.bvecs": _path+"/"+bvecs,
                            "dwi.bvals": _path+"/"+bvals,
                        };
                        datasets.push({dataset, files});
                        next_file(); 
                        break;
                    default:
                        //console.log("ignoring", file);
                        next_file();
                    }
                }, cb);
            });
        }

        function handle_anat(_path, cb) {
            fs.readdir(_path, (err, files)=>{
                if(err) return cb(err);
                async.forEach(files, (file, next_file)=>{

                    let fileinfo = parseBIDSPath(file);
                    //console.log(file);
                    //console.dir(fileinfo);
                    switch(fileinfo._filename) {
                    case "T1w.nii.gz":
                        handle_anat_t1(_path, fileinfo, next_file);
                        break;
                    case "T2w.nii.gz":
                        handle_anat_t2(_path, fileinfo, next_file);
                        break;
                    default:
                        //console.log("ignoring", file);
                        next_file();
                    }
                }, cb);
            });
        }

        function handle_func(_path, cb) {
            fs.readdir(_path, (err, files)=>{
                if(err) return cb(err);
                async.forEach(files, (file, next_file)=>{
                    let fileinfo = parseBIDSPath(file);
                    //console.log(file);
                    //console.dir(fileinfo);
                    switch(fileinfo._filename) {
                    case "bold.nii.gz":
                        //console.dir(fileinfo);

                        let fullname = fileinfo._fullname;
                        let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
                        let sidecar = get_sidecar(_path+"/"+sidecar_name);

                        let dataset = {
                            datatype: datatype_ids["neuro/func/task"],
                            desc: fileinfo._fullname,
                            
                            datatype_tags: [ fileinfo.task.toLowerCase() ], 
                            tags: get_tags(fileinfo),

                            meta: Object.assign(sidecar, get_meta(fileinfo)),
                        }
                        let files = {
                            "bold.nii.gz": _path+"/"+fileinfo._fullname,
                        };

                        let events_fullname = _path+"/"+fullname.substring(0, fullname.length-11)+"events.tsv"; 
                        //console.log("checking path", events_fullname);
                        if(fs.existsSync(events_fullname)) {
                            files["events.tsv"] = events_fullname;
                        }
                        datasets.push({dataset, files});
                        next_file(); 
                        break;
                    default:
                        console.log("ignoring", file, fileinfo._filename);
                        next_file(); 
                    }
                }, cb);
            });
        }

        function get_sidecar(path) {
            let sidecar = {};
            try {
                sidecar = fs.readFileSync(path, "utf8");
                sidecar = JSON.parse(sidecar);
            } catch (err) {
                console.error('no sidecar!', path);
            }
            return sidecar;
        }

        function handle_anat_t1(dir, fileinfo, cb) {
            //load (optional?) sidecar
            let fullname = fileinfo._fullname;
            let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
            let sidecar = get_sidecar(dir+"/"+sidecar_name);

            //console.dir(sidecar);
            let dataset = {
                datatype: datatype_ids["neuro/anat/t1w"],
                desc: fileinfo._fullname,
                
                //datatype_tags,
                tags: get_tags(fileinfo),

                meta: Object.assign(sidecar, get_meta(fileinfo)),
            }

            let files = {"t1.nii.gz": dir+"/"+fileinfo._fullname};
            datasets.push({dataset, files});
            cb();
        }

        function handle_anat_t2(dir, fileinfo, cb) {
            //load sidecar
            let fullname = fileinfo._fullname;
            let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
            let sidecar = get_sidecar(dir+"/"+sidecar_name);
            
            let dataset = {
                datatype: datatype_ids["neuro/anat/t2w"],
                desc: fileinfo._fullname,
                tags: get_tags(fileinfo),

                meta: Object.assign(sidecar, get_meta(fileinfo)),
            }

            let files = {"t2.nii.gz": dir+"/"+fileinfo._fullname};
            datasets.push({dataset, files});
            cb();
        }

        function upload_datasets() {
            console.log("preparing upload destination");
     
            async.eachSeries(datasets, (dataset, next_dataset)=>{
                console.log("checking", dataset.dataset.desc);
                request(config.api.warehouse + '/dataset', { json: true, headers, qs: {
                    find: JSON.stringify({
                        project: project._id,
                        removed: false, 
                        datatype: dataset.dataset.datatype, 
                        desc: dataset.dataset.desc, 
                        'meta.subject': dataset.dataset.meta.subject, 
                        //datatype_tags: dataset.dataset.datatype_tags //desc should take care of it?
                    }),
                }}).then(async body=>{
                    if(body.count == 0) {
                        let noop = await submit_noop(dataset.dataset.datatype, dataset.dataset.datatype_tags);
                        upload(noop, dataset, next_dataset);
                    } else {
                        console.log("already uploaded");
                        next_dataset();
                    }
                });
            }, err=>{
                if(err) throw err;
                console.log("all done");
            });
        }

        function upload(noop, dataset, cb) {
            console.log("uploading dataset", dataset);
            
            //create tar ball with all files
            let archive = archiver('tar', { gzip: true });
            console.dir(dataset.files);
            for(var path in dataset.files) {
                archive.file(fs.realpathSync(dataset.files[path]), { name: path });
            }
            archive.on('error', err=>{
                throw err;
            });

            //then pipe to the noop
            let req = request.post({url: config.api.wf + "/task/upload/" + noop._id + "?p=upload.tar.gz&untar=true", headers: headers});
            archive.pipe(req);
            archive.finalize();
            req.on('response', async res=>{
                if(res.statusCode != "200") throw new Error(res.body.message);
                let body = dataset.dataset;
                console.log("Dataset successfully uploaded.. now registering dataset");
                body.project = project._id;
                body.task_id = noop._id;
                body.output_id = "output";    //app-noop isn't BL app so we just have to come up with a name (TODO why not create it?)
                request.post({url: config.api.warehouse + '/dataset', json: true, headers: headers, body}).then(_dataset=>{
                    console.log("registered!");
                    cb();
                });  
            });
         }

        function submit_noop(datatype, datatype_tags) {
            //submit noop to upload data
            //warehouse dataset post api need a real task to submit from
            return request.post({ url: config.api.wf + "/task", headers, json: true, body: {
                instance_id: instance._id,
                name: instanceName,
                service: 'brainlife/app-noop',
                config: {
                    _outputs: [{
                         id: "output",
                         datatype,
                         datatype_tags,
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

        /*
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
        */

    });
}

