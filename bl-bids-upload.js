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
                //console.dir(fileinfo);
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
                    case "fmap": 
                        handle_fmap(_path+"/fmap", next_dir);
                        break;
                    default:
                        //TODO handle sub-A00000844_ses-20100101_scans.tsv
                        //console.log("unknown file/dir:"+_path+"/"+dir);
                        next_dir();
                    }
                }, cb);
            });
        }

        function get_meta(fileinfo) {
            let meta = {};
            for(let key in fileinfo) {
                let inkey = key;

                //ignore some keys (like _filename, _fullname..)
                if(key[0] == "_") continue;

                //rename some keys
                if(key == "sub") inkey = "subject";
                if(key == "ses") inkey = "session";

                //not sure if I should have these yet..
                if(key == "acq") inkey = "acquisition";
                if(key == "run") inkey = "run";

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

                /*
                //ignore some structural tag as they will be stored in metadata
                if(key == "sub") continue;
                if(key == "ses") continue;
                if(key == "run") continue;
                */
                
                //store other things as tag
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
                    switch(fileinfo._filename) {
                    case "T1w.nii.gz":
                        handle_anat_t1(_path, fileinfo, next_file);
                        break;
                    case "T2w.nii.gz":
                        handle_anat_t2(_path, fileinfo, next_file);
                        break;
                    case "FLAIR.nii.gz":
                        handle_anat_flair(_path, fileinfo, next_file);
                        break;
                    default:
                        //console.log("ignoring", file);
                        next_file();
                    }
                }, cb);
            });
        }

        function handle_fmap(_path, cb) {
            fs.readdir(_path, (err, files)=>{
                if(err) return cb(err);

                //group files by sub/ses/acq/run
                let groups = {}; 
                files.forEach(file=>{
                    let fileinfo = parseBIDSPath(file);
                    let key = "";
                    if(fileinfo.sub) key += "sub-"+fileinfo.sub;
                    if(fileinfo.ses) key += "ses-"+fileinfo.ses;
                    if(fileinfo.run) key += "run-"+fileinfo.run;
                    if(fileinfo.acq) key += "acq-"+fileinfo.acq;
                    if(!groups[key]) groups[key] = {infos: []};
                    groups[key].infos.push(fileinfo);
                    groups[key][fileinfo._filename] = true;
                });

                //for each group, load appropriate datatype
                async.eachOfSeries(groups, (group, key, next_group)=>{
                    if(group["fieldmap.nii.gz"]) return handle_fmap_real(_path, group.infos, next_group);
                    if(group["phasediff.nii.gz"]) return handle_fmap_phasediff(_path, group.infos, next_group);
                    if(group["phase1.nii.gz"]) return handle_fmap_2phasemag(_path, group.infos, next_group);
                    if(group["epi.bvec"]) return handle_fmap_b0(_path, group.infos, next_group);
                    if(group["epi.nii.gz"]) return handle_fmap_epi(_path, group.infos, next_group);

                    console.log("odd fmap");
                    console.dir(group)
                    next_group();
                }, cb)
            });
        }

        function handle_fmap_real(dir, infos, cb) {
            //TODO
            cb();
        }

        function handle_fmap_phasediff(dir, infos, cb) {
            let pd_fileinfo = infos.find(info=>info._filename == "phasediff.nii.gz");
            let pd_sidecar = get_sidecar_from_fileinfo(dir, pd_fileinfo);
            let dataset = {
                datatype: datatype_ids["neuro/fmap"],
                desc: pd_fileinfo._fullname,
                
                datatype_tags: ["phasediff"],
                tags: get_tags(pd_fileinfo),

                meta: Object.assign(pd_sidecar, get_meta(pd_fileinfo)),
            }

            let files = {};
            infos.forEach(info=>{files[info._filename] = dir+"/"+info._fullname});
            datasets.push({dataset, files});
            cb();
        }

        //return array of 3 objects.
        //0: items that are common in both. 
        //1: diffrent items for A, 
        //2: different items for B
        function object_diff(a, b) {
            let same = {};
            let diff_a = {};
            let diff_b = {};
            for(let key in a) {
                let av = a[key];
                let bv = b[key];
                if(Array.isArray(av) && av == bv.toString()) same[key] = av;
                else if(av == bv) same[key] = av;
                else {
                    diff_a[key] = av;
                    diff_b[key] = bv;
                }
            }

            //look for things that only exists in b
            for(let key in b) {
                if(a[key] === undefined) {
                    diff_a[key] = null; //should I?
                    diff_b[key] = b[key];
                }
            }
            return {same, a: diff_a, b: diff_b};
        }

        function handle_fmap_b0(dir, infos, cb) {
            /*
            { infos:
               [ { _fullname: 'sub-C01087_ses-01_dir-PA_run-01_epi.bval',
                   sub: 'C01087',
                   ses: '01',
                   dir: 'PA',
                   run: '01',
                   _filename: 'epi.bval' },
                 { _fullname: 'sub-C01087_ses-01_dir-PA_run-01_epi.bvec',
                   sub: 'C01087',
                   ses: '01',
                   dir: 'PA',
                   run: '01',
                   _filename: 'epi.bvec' },
                 { _fullname: 'sub-C01087_ses-01_dir-PA_run-01_epi.json',
                   sub: 'C01087',
                   ses: '01',
                   dir: 'PA',
                   run: '01',
                   _filename: 'epi.json' },
                 { _fullname: 'sub-C01087_ses-01_dir-PA_run-01_epi.nii.gz',
                   sub: 'C01087',
                   ses: '01',
                   dir: 'PA',
                   run: '01',
                   _filename: 'epi.nii.gz' } ],
              'epi.bval': true,
              'epi.bvec': true,
              'epi.json': true,
              'epi.nii.gz': true }
            */

            let epi = infos.find(info=>{return (info._filename == "epi.nii.gz")});
            let bvec = infos.find(info=>{return (info._filename == "epi.bvec")});
            let bval = infos.find(info=>{return (info._filename == "epi.bval")});
            let sidecar = get_sidecar_from_fileinfo(dir, epi);

            let dataset = {
                datatype: datatype_ids["neuro/dwi"],
                desc: epi._fullname,
                
                //datatype_tags: ["epi", epi.dir],
                datatype_tags: [], 

                //tags: get_tags(epi),
                tags: [ "fmap", "b0", epi.dir ],

                meta: get_meta(epi),
            }

            let files = {
                "dwi.nii.gz": dir+"/"+epi._fullname,
                "dwi.bvecs": dir+"/"+bvec._fullname,
                "dwi.bvals": dir+"/"+bval._fullname,
            };
            datasets.push({dataset, files});
            cb();
        }

        function handle_fmap_epi(dir, infos, cb) {
            let ap_fileinfo = infos.find(info=>{return (info.dir == "AP" && info._filename == "epi.nii.gz")});
            let ap_sidecar = get_sidecar_from_fileinfo(dir, ap_fileinfo);
            let pa_fileinfo = infos.find(info=>{return (info.dir == "PA" && info._filename == "epi.nii.gz")});
            let pa_sidecar = get_sidecar_from_fileinfo(dir, pa_fileinfo);

            let {same: meta_same, a: meta_ap, b: meta_pa} = object_diff(ap_sidecar, pa_sidecar);

            let dataset = {
                datatype: datatype_ids["neuro/fmap"],
                desc: ap_fileinfo._fullname,
                
                datatype_tags: ["epi"],

                tags: Array.from(new Set([...get_tags(ap_fileinfo), ...get_tags(pa_fileinfo)])), //merge and dedupe
                meta: Object.assign(meta_same, {ap: meta_ap, pa: meta_pa}, get_meta(ap_fileinfo)),
            }

            let files = {};
            infos.forEach(info=>{files[info.dir.toLowerCase()+"."+info._filename] = dir+"/"+info._fullname});
            datasets.push({dataset, files});
            cb();
        }

        function handle_fmap_2pharsemag(dir, infos, cb) {
            //TODO
            cb();
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
                        if(fs.existsSync(events_fullname)) {
                            files["events.tsv"] = events_fullname;
                        }
                        let sbref_fullname = _path+"/"+fullname.substring(0, fullname.length-11)+"sbref.nii.gz"; 
                        if(fs.existsSync(sbref_fullname)) {
                            files["sbref.nii.gz"] = sbref_fullname;
                        }
                        let sbrefjson_fullname = _path+"/"+fullname.substring(0, fullname.length-11)+"sbref.json"; 
                        if(fs.existsSync(sbrefjson_fullname)) {
                            files["sbref.json"] = sbrefjson_fullname;
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

        function get_sidecar_from_fileinfo(dir, fileinfo) {
            if(!fileinfo) return {}

            let fullname = fileinfo._fullname;
            let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
            let sidecar = get_sidecar(dir+"/"+sidecar_name);
            return sidecar;
        }

        function handle_anat_t1(dir, fileinfo, cb) {
            //load (optional?) sidecar
            let sidecar = get_sidecar_from_fileinfo(dir, fileinfo);

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

        function handle_anat_flair(dir, fileinfo, cb) {
            //load sidecar
            let fullname = fileinfo._fullname;
            let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
            let sidecar = get_sidecar(dir+"/"+sidecar_name);
            
            let dataset = {
                datatype: datatype_ids["neuro/anat/flair"],
                desc: fileinfo._fullname,
                tags: get_tags(fileinfo),

                meta: Object.assign(sidecar, get_meta(fileinfo)),
            }

            let files = {"flair.nii.gz": dir+"/"+fileinfo._fullname};
            datasets.push({dataset, files});
            cb();
        }

        function upload_datasets() {
            console.log("preparing upload destination");
     
            async.eachSeries(datasets, (dataset_and_files, next_dataset)=>{
                console.log("duplication check..", dataset_and_files.dataset.meta.subject, dataset_and_files.dataset.desc);
                request(config.api.warehouse + '/dataset', { json: true, headers, qs: {
                    find: JSON.stringify({
                        project: project._id,
                        removed: false, 
                        datatype: dataset_and_files.dataset.datatype, 
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
        }

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
                //console.dir(dataset.meta);
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
