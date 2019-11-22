#!/usr/bin/env node

//this module walks bids directory structure and construct a list of brainlife dataset structures with all the appropriate metadata

const fs = require('fs');
const async = require('async');
const path = require('path');

const bids_walker = require('./bids-walker');

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

exports.walk = (root, cb)=>{
    let bids = {
        README: null,
        CHANGES: null,
        dataset_description: {},
        participants: {}, //keyed by subjects (from participants.tsv)
        datasets: [],
    }

    let tsv = null;
    if(fs.existsSync(root+"/participants.tsv")) {
        tsv = fs.readFileSync(root+"/participants.tsv", "utf8").trim().split("\n");
    }
    if(fs.existsSync(root+"/participant_data.tsv")) {
        tsv = fs.readFileSync(root+"/participant_data.tsv", "utf8").trim().split("\n");
    }
    if(tsv) {
        console.log("loading participants.tsv (or -data.tsv)", root);
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
            bids.participants[subject] = participant;
        });
    }

    if(fs.existsSync(root+"/README")) {
        bids.README = fs.readFileSync(root+"/README", "utf8");
    }
    if(fs.existsSync(root+"/CHANGES")) {
        bids.CHANGES = fs.readFileSync(root+"/CHANGES", "utf8");
    }
    if(fs.existsSync(root+"/dataset_description.json")) {
        bids.dataset_description = require(root+"/dataset_description.json");
    }
    
    //start iterating subject directory
    fs.readdir(root, (err, paths)=>{
        if(err) throw err;

        //first load all sidecars at root level
        let common_sidecar = {};  //key: task-shape_bold.json value: content
        async.eachSeries(paths, (path, next_path)=>{
            if(path.endsWith(".json")) { //load things like root level task-XXX_bold.json
                console.log("loading root level sidecar:"+path);
                common_sidecar[path] = require(root+"/"+path);
            }
            return next_path();
        }, err=>{
            if(err) return cb(err);  
            
            //then handle subjects
            async.eachSeries(paths, (path, next_path)=>{
                const stats = fs.statSync(root+"/"+path);
                if(!stats.isDirectory()) return next_path(); 
                let fileinfo = parseBIDSPath(path);
                if(!fileinfo['sub']) {
                    console.log("couldn't find subject directory.. not bids root? "+path);
                    return next_path();
                }
                //console.log("handing subject", fileinfo["sub"]);
                handle_subject(common_sidecar, root+"/"+path, next_path);
            }, err=>{
                //all done load bids
                cb(err, bids);
            });
        });
    });

    function handle_subject(parent_sidecar, _path, cb) {

        //copy all sidecar from parent
        let common_sidecar = {};
        for(let path in parent_sidecar) {
            common_sidecar[path] = Object.assign({}, parent_sidecar[path]);
        }
        
        fs.readdir(_path, (err, dirs)=>{
            if(err) return cb(err);

            //first handle sidecars at subject level
            async.forEach(dirs, (dir, next_dir)=>{
                if(dir.endsWith(".json")) {
                    let sidecar = require(root+"/"+path);
                    if(!common_sidecar[path]) common_sidecar[path] = sidecar;
                    else for(let key in sidecar) common_sidecar[path][key] = sidecar[key]; //need to replace parent's value
                }
                next_dir();
            }, err=>{
                if(err) return cb(err);  
                //then handle modality or session
                async.forEach(dirs, (dir, next_dir)=>{
                    if(dir.indexOf("ses-") == 0) return handle_subject(common_sidecar, _path+"/"+dir, next_dir);
                    switch(dir) {
                    case "anat": 
                        handle_anat(common_sidecar, _path+"/anat", next_dir);
                        break;
                    case "dwi": 
                        handle_dwi(common_sidecar, _path+"/dwi", next_dir);
                        break;
                    case "func": 
                        handle_func(common_sidecar, _path+"/func", next_dir);
                        break;
                    case "fmap": 
                        handle_fmap(common_sidecar, _path+"/fmap", next_dir);
                        break;
                    default:
                        //TODO handle sub-A00000844_ses-20100101_scans.tsv
                        //console.log("unknown file/dir:"+_path+"/"+dir);
                        next_dir();
                    }
                }, cb);
            });
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
        for(let key in fileinfo) {
            if(key == "_filename") continue;
            if(key == "_fullname") continue;

            //ignore some structural tag as they will be stored in metadata
            if(key == "sub") continue;
            if(key == "ses") continue;

            //we want run to be stored in tag.. as it will be important to setup rules
            
            //store other things as tag
            tags.push(key+"-"+fileinfo[key]);
        }
        return tags;
    }

    function handle_dwi(parent_sidecar, _path, cb) {
        fs.readdir(_path, (err, files)=>{
            if(err) return cb(err);
            async.forEach(files, (file, next_file)=>{
                let fileinfo = parseBIDSPath(file);
                switch(fileinfo._filename) {
                case "dwi.nii.gz":
                    //let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
                    //let sidecar = get_sidecar(_path+"/"+sidecar_name);
                    let sidecar = {};
                    Object.assign(sidecar, parent_sidecar["dwi.json"]);
                    Object.assign(sidecar, get_sidecar_from_fileinfo(_path, fileinfo));

                    let dataset = {
                        datatype: "neuro/dwi",
                        desc: fileinfo._fullname,
                        
                        //datatype_tags,
                        tags: get_tags(fileinfo),

                        meta: Object.assign(sidecar, get_meta(fileinfo)),
                    }

                    let fullname = fileinfo._fullname;
                    let bvecs = fullname.substring(0, fullname.length-7)+".bvec"; 
                    let bvals = fullname.substring(0, fullname.length-7)+".bval"; 
                    let files = {
                        "dwi.nii.gz": _path+"/"+fileinfo._fullname,
                        "dwi.bvecs": _path+"/"+bvecs,
                        "dwi.bvals": _path+"/"+bvals,
                    };
                    bids.datasets.push({dataset, files});
                    next_file(); 
                    break;
                default:
                    next_file();
                }
            }, cb);
        });
    }

    function handle_anat(parent_sidecar, _path, cb) {
        fs.readdir(_path, (err, files)=>{
            if(err) return cb(err);
            async.forEach(files, (file, next_file)=>{
                let fileinfo = parseBIDSPath(file);
                switch(fileinfo._filename) {
                case "T1w.nii.gz":
                    handle_anat_t1(parent_sidecar, _path, fileinfo, next_file);
                    break;
                case "T2w.nii.gz":
                    handle_anat_t2(parent_sidecar, _path, fileinfo, next_file);
                    break;
                case "FLAIR.nii.gz":
                    handle_anat_flair(parent_sidecar, _path, fileinfo, next_file);
                    break;
                default:
                    next_file();
                }
            }, cb);
        });
    }

    function handle_fmap(parent_sidecar, _path, cb) {
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
                if(group["fieldmap.nii.gz"]) return handle_fmap_single(parent_sidecar, _path, group.infos, next_group);
                if(group["phasediff.nii.gz"]) return handle_fmap_phasediff(parent_sidecar, _path, group.infos, next_group);
                if(group["phase1.nii.gz"]) return handle_fmap_2phasemag(parent_sidecar, _path, group.infos, next_group);
                if(group["epi.nii.gz"]) return handle_fmap_pepolar(parent_sidecar, _path, group.infos, next_group);
                if(group["epi.bvec"]) return handle_fmap_b0(parent_sidecar, _path, group.infos, next_group); //"5th fieldmap..

                console.log("odd fmap");
                console.dir(group)
                next_group();
            }, cb)
        });
    }

    function handle_fmap_single(parent_sidecar, dir, infos, cb) {
        //TODO
        cb();
    }

    function handle_fmap_phasediff(parent_sidecar, dir, infos, cb) {
        let pd_fileinfo = infos.find(info=>info._filename == "phasediff.nii.gz");
        let sidecar = {};
        Object.assign(sidecar, parent_sidecar["phasediff.json"]);
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, pd_fileinfo));

        let dataset = {
            datatype: "neuro/fmap",
            desc: pd_fileinfo._fullname,
            
            datatype_tags: ["phasediff"],
            tags: get_tags(pd_fileinfo),

            meta: Object.assign(sidecar, get_meta(pd_fileinfo)),
        }

        let files = {};
        infos.forEach(info=>{files[info._filename] = dir+"/"+info._fullname});
        bids.datasets.push({dataset, files});
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

    function handle_fmap_b0(parent_sidecar, dir, infos, cb) {
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

        let sidecar = {};
        Object.assign(sidecar, parent_sidecar["epi.json"]); //is this right?
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, epi));

        let dataset = {
            datatype: "neuro/dwi",
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
        bids.datasets.push({dataset, files});
        cb();
    }

    function handle_fmap_pepolar(parent_sidecar, dir, infos, cb) {
        /* infos
        [ { _fullname: 'sub-01_dir-ap_epi.json',
            sub: '01',
            dir: 'ap',
            _filename: 'epi.json' },
          { _fullname: 'sub-01_dir-ap_epi.nii.gz',
            sub: '01',
            dir: 'ap',
            _filename: 'epi.nii.gz' },
          { _fullname: 'sub-01_dir-pa_epi.json',
            sub: '01',
            dir: 'pa',
            _filename: 'epi.json' },
          { _fullname: 'sub-01_dir-pa_epi.nii.gz',
            sub: '01',
            dir: 'pa',
            _filename: 'epi.nii.gz' } ]
        */
        
        //count number of dirs
        let dirs = [];
        infos.forEach(info=>{
            if(!dirs.includes(info.dir)) dirs.push(info.dir);
            if(info._filename == "epi.json") {
                let sidecar = {};
                Object.assign(sidecar, parent_sidecar["epi.json"]);
                Object.assign(sidecar, parent_sidecar[strip_hierachy(info._filename)]);
                Object.assign(sidecar, get_sidecar(dir+"/"+info._fullname));
                dirs[info.dir] = sidecar;
            }
        });

        //create epiN.json, etc..
        let files = {};
        let all_tags = [];
        let meta = {};
        infos.forEach(info=>{
            let id = dirs.indexOf(info.dir) + 1;
            if(info._filename == "epi.json") {
                files["epi"+id+".json"] = dir+"/"+info._fullname;
            }
            if(info._filename == "epi.nii.gz") {
                files["epi"+id+".nii.gz"] = dir+"/"+info._fullname;
                let tags = get_tags(info);
                meta = get_meta(info);
                all_tags = Array.from(new Set([...all_tags, ...tags]));
            }
        });

        delete meta.dir;

        let dataset = {
            datatype: "neuro/fmap",
            //desc: first_fileinfo._fullname,

            datatype_tags: ["pepolar"],
            tags: all_tags,
            //meta: Object.assign(meta_same, {ap: meta_ap, pa: meta_pa}, get_meta(ap_fileinfo)),
            meta,
        }

        bids.datasets.push({dataset, files});
        cb();
    }

    function handle_fmap_2pharsemag(parent_sidecar, dir, infos, cb) {
        //TODO
        cb();
    }

    //convert 
    //  sub-01_ses-01_task-ClipsVal05_acq-ap_bold.json
    //to 
    //  task-ClipsVal05_acq-ap_bold.json
    function strip_hierachy(filename) {
        let tokens = filename.split("_");
        let name = "";
        tokens.forEach(token=>{
            if(token.startsWith("sub-")) return;
            if(token.startsWith("ses-")) return;
            if(token.startsWith("run-")) return;
            if(name != "") name += "_";
            name += token;
        });
        return name;
    }

    function handle_func(parent_sidecar, _path, cb) {
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
                    let sidecar = {};

                    //compose sidecar
                    Object.assign(sidecar, parent_sidecar["bold.json"]);
                    Object.assign(sidecar, parent_sidecar[strip_hierachy(sidecar_name)]);
                    Object.assign(sidecar, get_sidecar(_path+"/"+sidecar_name));

                    let dataset = {
                        datatype: "neuro/func/task",
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

                    //TODO - sbref.json could be stored on the parent directory without hierarchy.. 

                    bids.datasets.push({dataset, files});
                    next_file(); 
                    break;
                default:
                    //console.log("ignoring(func)", file, fileinfo._filename);
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

    function handle_anat_t1(parent_sidecar, dir, fileinfo, cb) {
        //load (optional?) sidecar
        let sidecar = {};
        Object.assign(sidecar, parent_sidecar["t1w.json"]);
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, fileinfo));

        //console.dir(sidecar);
        let dataset = {
            datatype: "neuro/anat/t1w",
            desc: fileinfo._fullname,
            
            //datatype_tags,
            tags: get_tags(fileinfo),

            meta: Object.assign(sidecar, get_meta(fileinfo)),
        }

        let files = {"t1.nii.gz": dir+"/"+fileinfo._fullname};
        bids.datasets.push({dataset, files});
        cb();
    }

    function handle_anat_t2(parent_sidecar, dir, fileinfo, cb) {
        //load sidecar
        let fullname = fileinfo._fullname;
        //let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
        //let sidecar = get_sidecar(dir+"/"+sidecar_name);
        let sidecar = {};
        Object.assign(sidecar, parent_sidecar["t2w.json"]);
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, fileinfo));
        
        let dataset = {
            datatype: "neuro/anat/t2w",
            desc: fileinfo._fullname,
            tags: get_tags(fileinfo),

            meta: Object.assign(sidecar, get_meta(fileinfo)),
        }

        let files = {"t2.nii.gz": dir+"/"+fileinfo._fullname};
        bids.datasets.push({dataset, files});
        cb();
    }

    function handle_anat_flair(parent_sidecar, dir, fileinfo, cb) {
        //load sidecar
        let fullname = fileinfo._fullname;
        //let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
        //let sidecar = get_sidecar(dir+"/"+sidecar_name);
        let sidecar = {};
        Object.assign(sidecar, parent_sidecar["flair.json"]); //TODO is this right? (I haven't seen it)
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, fileinfo));
        
        let dataset = {
            datatype: "neuro/anat/flair",
            desc: fileinfo._fullname,
            tags: get_tags(fileinfo),

            meta: Object.assign(sidecar, get_meta(fileinfo)),
        }

        let files = {"flair.nii.gz": dir+"/"+fileinfo._fullname};
        bids.datasets.push({dataset, files});
        cb();
    }
}
