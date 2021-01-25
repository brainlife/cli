#!/usr/bin/env node

//this module walks bids directory structure and construct a list of brainlife dataset structures with all the appropriate metadata

const fs = require('fs');
const async = require('async');
const path = require('path');
const util = require('./util');

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
        if(tokens.length > 1) {
            obj[tokens[0]] = tokens.splice(1).join("-");
        }
    });
    return obj;
}

exports.walk = (root, cb)=>{
    let bids = {
        README: null,
        CHANGES: null,
        dataset_description: {},
        participants: [], //from participants.tsv
        participants_json: null, //from participants.json
        datasets: [], //{dataset, files} ... you have to do dataset.dataset.meta... maybe I should rename it to items"
    }

    let tsv = null;
    if(fs.existsSync(root+"/participants.tsv")) {
        tsv = fs.readFileSync(root+"/participants.tsv", "utf8").trim().split("\n");
    }
    if(fs.existsSync(root+"/participant_data.tsv")) {
        tsv = fs.readFileSync(root+"/participant_data.tsv", "utf8").trim().split("\n");
    }
    if(tsv) bids.participants = util.parseParticipantTSV(tsv);

    try {
        if(fs.existsSync(root+"/participants.json")) {
            let json = fs.readFileSync(root+"/participants.json", "utf8");
            bids.participants_json = util.escape_dot(JSON.parse(json));
        }
    } catch(err) {
        console.error(err);
        console.error("failed to parse participants.json.. ignoring");
        ///mnt/datalad/datasets.datalad.org/openfmri/ds000201 contains participants.json that's basically the participants.tsv
    }

    if(fs.existsSync(root+"/README")) {
        bids.README = fs.readFileSync(root+"/README", "utf8");
    }
    if(fs.existsSync(root+"/CHANGES")) {
        bids.CHANGES = fs.readFileSync(root+"/CHANGES", "utf8");
    }
    if(fs.existsSync(root+"/dataset_description.json")) {
        let json = fs.readFileSync(root+"/dataset_description.json");
        bids.dataset_description = JSON.parse(json);
        if(Array.isArray(bids.dataset_description.HowToAcknowledge)) {
            //ds000222 is storing this as array..
            bids.dataset_description.HowToAcknowledge = bids.dataset_description.HowToAcknowledge.toString();
        }
    }
    
    //start iterating subject directory
    fs.readdir(root, (err, paths)=>{
        if(err) throw err;

        //first load all sidecars at root level
        let common_sidecar = {};  //key: task-shape_bold.json value: content
        async.eachSeries(paths, (path, next_path)=>{
            if(path.endsWith(".json")) { //load things like root level task-XXX_bold.json
                //console.log("loading root level sidecar:"+path);
                try {
                    let json = fs.readFileSync(root+"/"+path);
                    common_sidecar[path] = JSON.parse(json);
                } catch(err) {
                    console.error("failed to parse "+root+"/"+path);
                    console.error(err);
                }
            }
            return next_path();
        }, err=>{
            if(err) return cb(err);  
            
            //then handle subjects
            async.eachSeries(paths, (path, next_path)=>{
                try {
                    const stats = fs.statSync(root+"/"+path);
                    if(!stats.isDirectory()) return next_path(); 
                } catch (err) {
                    //probably broken link?
                    return next_path();
                }
                let fileinfo = parseBIDSPath(path);
                if(!fileinfo['sub']) {
                    console.log("couldn't find subject directory.. not bids root? "+path);
                    return next_path();
                }
                handle_subject(common_sidecar, root+"/"+path, next_path);
            }, err=>{
                //all done load bids

                //escape "."(dot) inside meta
                //uncaughtException: key PVTMotivation1.1 must not contain '.'
                bids.datasets.forEach(dataset=>{
                    util.escape_dot(dataset.dataset.meta);
                });

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
                    try {
                        let json = fs.readFileSync(_path+"/"+dir);
                        let sidecar = JSON.parse(json);
                        if(!common_sidecar[dir]) common_sidecar[dir] = sidecar;
                        else for(let key in sidecar) common_sidecar[dir][key] = sidecar[key]; //need to replace parent's value
                    } catch(err) {
                        console.error("failed to parse subject level json: "+_path+"/"+dir);
                        console.error(err);
                    }
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
                    case "eeg": 
                        handle_eeg(common_sidecar, _path+"/eeg", next_dir);
                        break;
                    case "meg": 
                        handle_meg(common_sidecar, _path+"/meg", next_dir);
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
                case "dwi.nii":
                case "dwi.nii.gz":
                    //let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
                    //let sidecar = get_sidecar(_path+"/"+sidecar_name);
                    let sidecar = {};
                    Object.assign(sidecar, parent_sidecar["dwi.json"]);
                    Object.assign(sidecar, get_sidecar_from_fileinfo(_path, fileinfo, "dwi.json"));

                    let dataset = {
                        datatype: "neuro/dwi",
                        desc: fileinfo._fullname,
                        
                        datatype_tags: [],
                        tags: get_tags(fileinfo),

                        meta: Object.assign(sidecar, get_meta(fileinfo)),
                    }

                    let basename = get_basename(fileinfo);
                    let files = {
                        "dwi.nii.gz": _path+"/"+fileinfo._fullname,
                        "dwi.bvecs": _path+"/"+basename+"dwi.bvec",
                        "dwi.bvals": _path+"/"+basename+"dwi.bval",
                    };
                        
                    //TODO - sbref.json could be stored on the parent directory without hierarchy.. 
                    let sbref_fullname = _path+"/"+basename+"sbref.nii.gz"; 
                    if(fs.existsSync(sbref_fullname)) {
                        files["sbref.nii.gz"] = sbref_fullname;
                    }
                    let sbrefjson_fullname = _path+"/"+basename+"sbref.json"; 
                    if(fs.existsSync(sbrefjson_fullname)) {
                        files["sbref.json"] = sbrefjson_fullname;
                    }

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
                case "T1w.nii":
                case "T1w.nii.gz":
                    handle_anat_t1(parent_sidecar, _path, fileinfo, next_file);
                    break;
                case "T2w.nii":
                case "T2w.nii.gz":
                    handle_anat_t2(parent_sidecar, _path, fileinfo, next_file);
                    break;
                case "FLAIR.nii":
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

                console.log("odd fmap .. skipping");
                console.dir(group)
                next_group();
            }, cb)
        });
    }

    function handle_fmap_single(parent_sidecar, dir, infos, cb) {
        let fileinfo = infos.find(info=>info._filename == "fieldmap.nii.gz");
        let sidecar = {};
        Object.assign(sidecar, parent_sidecar["fieldmap.json"]);
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, fileinfo, "fieldmap.json"));

        let dataset = {
            datatype: "neuro/fmap",
            desc: fileinfo._fullname,
            
            datatype_tags: ["single"],
            tags: get_tags(fileinfo),

            meta: Object.assign(sidecar, get_meta(fileinfo)),
        }

        let files = {};
        infos.forEach(info=>{files[info._filename] = dir+"/"+info._fullname});
        bids.datasets.push({dataset, files});
        cb();
    }

    function handle_fmap_2phasemag(parent_sidecar, dir, infos, cb) {
        let fileinfo1 = infos.find(info=>info._filename == "phase1.nii.gz");
        let fileinfo2 = infos.find(info=>info._filename == "phase2.nii.gz");

        if(!fileinfo1 || !fileinfo2) {
            console.error("2phasemag given with only phase1?");
            console.dir(infos);
            return cb();
        }

        let sidecar = {};
        //Object.assign(sidecar, parent_sidecar["phase.json"]); //not sure if this is it..
        Object.assign(sidecar, 
            get_sidecar_from_fileinfo(dir, fileinfo1, "phase1.json"),  //is this right?
            get_sidecar_from_fileinfo(dir, fileinfo2, "phase2.json")); //is this right?

        let dataset = {
            datatype: "neuro/fmap",
            desc: fileinfo1._fullname+" and "+fileinfo2._fullname,
            
            datatype_tags: ["2phasemag"],
            tags: [...new Set([...get_tags(fileinfo1), ...get_tags(fileinfo2)])],

            meta: Object.assign(sidecar, get_meta(fileinfo1), get_meta(fileinfo2)),
        }

        let files = {};
        infos.forEach(info=>{files[info._filename] = dir+"/"+info._fullname});
        bids.datasets.push({dataset, files});
        cb();
    }

    function handle_fmap_phasediff(parent_sidecar, dir, infos, cb) {
        let pd_fileinfo = infos.find(info=>info._filename == "phasediff.nii.gz");
        let sidecar = {};
        Object.assign(sidecar, parent_sidecar["phasediff.json"]);
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, pd_fileinfo, "phasediff.json"));

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
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, epi, "epi.json"));

        let dataset = {
            datatype: "neuro/dwi",
            desc: epi._fullname,
            
            datatype_tags: [], 

            //tags: get_tags(epi),
            tags: [ "fmap", "b0", epi.dir ],

            meta: Object.assign(sidecar, get_meta(epi)),
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
        let sidecar = {};
        
        //count number of dirs
        let dirs = [];
        infos.forEach(info=>{
            if(!dirs.includes(info.dir)) dirs.push(info.dir);
            if(info._filename == "epi.json") {
                Object.assign(sidecar, parent_sidecar["epi.json"]);
                //Object.assign(sidecar, parent_sidecar[strip_hierachy(info._filename)]);
                Object.assign(sidecar, get_parent_sidecar(parent_sidecar, info._filename));
                Object.assign(sidecar, get_sidecar(dir+"/"+info._fullname));
            }
        });

        //create epiN.json, etc..
        let files = {};
        let all_tags = [];
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
            meta: Object.assign(sidecar, meta),
        }

        bids.datasets.push({dataset, files});


        cb();
    }

    function handle_fmap_2pharsemag(parent_sidecar, dir, infos, cb) {
        throw "2pahsemag todo";
        cb();
    }

    //deprecated by get_parent_sidecar()
    //convert 
    //  sub-01_ses-01_task-ClipsVal05_acq-ap_bold.json
    //to 
    //  task-ClipsVal05_acq-ap_bold.json

    //look for parent sidecars that belongs to the sidecar filename
    function get_parent_sidecar(parent_sidecars, filename) {

        let tokens = filename.split("_");
        function strip_token(hie) {
            let found;
            tokens.forEach((token, idx)=>{
                if(token.startsWith(hie)) {
                    found = idx;
                }
            });
            if(found !== undefined) tokens.splice(found, 1);
        }
        
        //look for json with no run  
        sidecar = {};

        strip_token("run-"); 
        filename = tokens.join("_");
        if(parent_sidecars[filename]) {
            console.debug("using", filename);
            sidecar = Object.assign({}, parent_sidecars[filename], sidecar);
        }

        strip_token("ses-"); 
        filename = tokens.join("_");
        if(parent_sidecars[filename]) {
            console.debug("using", filename);
            sidecar = Object.assign({}, parent_sidecars[filename], sidecar);
        }

        strip_token("sub-"); 
        filename = tokens.join("_");
        if(parent_sidecars[filename]) {
            console.debug("using", filename);
            sidecar = Object.assign({}, parent_sidecars[filename], sidecar);
        }

        return sidecar;
    }

    function handle_eeg(parent_sidecar, _path, cb) {
        fs.readdir(_path, (err, files)=>{
            if(err) return cb(err);
            async.forEach(files, (file, next_file)=>{
                let fileinfo = parseBIDSPath(file);
                if(!fileinfo.task) fileinfo.task = "unknown"; //like ds001165

                let basename = get_basename(fileinfo);
                let dtag;
                let files;
                switch(fileinfo._filename) {
                case "eeg.edf":
                    dtag = "edf";     
                    files = {
                        "eeg.edf": _path+"/"+fileinfo._fullname,
                    };
                    break;
                case "eeg.eeg":
                    dtag = "brainvision";     
                    files = {
                        "eeg.eeg": _path+"/"+fileinfo._fullname,
                        "eeg.vhdr": _path+"/"+basename+"eeg.vhdr",
                        "eeg.vmrk": _path+"/"+basename+"eeg.vmrk",
                    };
                    break;
                case "eeg.fdt":
                    dtag = "eeglab";
                    files = {
                        "eeg.fdt": _path+"/"+fileinfo._fullname,
                        "eeg.set": _path+"/"+basename+"eeg.set",
                    };
                    break;
                default: 
                    return next_file(); 
                }

                let sidecar_name = basename+"eeg.json"; //remove .nii.gz to replace it with .json

                //compose sidecar
                let sidecar = {};
                Object.assign(sidecar, parent_sidecar["eeg.json"]);
                //Object.assign(sidecar, parent_sidecar[strip_hierachy(sidecar_name)]);
                Object.assign(sidecar, get_parent_sidecar(parent_sidecar, sidecar_name));
                Object.assign(sidecar, get_sidecar(_path+"/"+sidecar_name));

                let dataset = {
                    datatype: "neuro/eeg",
                    desc: fileinfo._fullname,
                    
                    datatype_tags: [ dtag, fileinfo.task.toLowerCase() ], 
                    tags: get_tags(fileinfo),

                    meta: Object.assign(sidecar, get_meta(fileinfo)),
                }

                let channels_fullname = _path+"/"+basename+"channels.tsv"; 
                if(fs.existsSync(channels_fullname)) {
                    files["channels.tsv"] = channels_fullname;
                }
                let events_fullname = _path+"/"+basename+"events.tsv"; 
                if(fs.existsSync(events_fullname)) {
                    files["events.tsv"] = events_fullname;
                }

                //electrodes and coordsystem should come together if they are set
                let electrodes_fullname = _path+"/"+basename+"electrodes.tsv"; 
                if(fs.existsSync(electrodes_fullname)) {
                    files["electrodes.tsv"] = electrodes_fullname;
                }
                let coordsystem_fullname = _path+"/"+basename+"coordsystem.tsv"; 
                if(fs.existsSync(coordsystem_fullname)) {
                    files["coordsystem.tsv"] = coordsystem_fullname;
                }

                bids.datasets.push({dataset, files});
                next_file(); 
            }, cb);
        });
    }

    function handle_meg(parent_sidecar, _path, cb) {
        fs.readdir(_path, (err, files)=>{
            if(err) return cb(err);
            async.forEach(files, (file, next_file)=>{
                let fileinfo = parseBIDSPath(file);
                if(!fileinfo.task) fileinfo.task = "unknown"; //like ds001165 (for eeg)

                let basename = get_basename(fileinfo);
                let dtag;
                let files;
                switch(fileinfo._filename) {
                case "meg.ds":
                    dtag = "ctf";     
                    //TODO - I don't think setting it to directory will work.. but maybe it's downstream issue. let'sd see
                    files = {
                        "meg.ds": _path+"/"+fileinfo._fullname,
                    };
                    break;
                case "meg.fif":
                    dtag = "fif";     
                    files = {
                        "meg.fif": _path+"/"+fileinfo._fullname,
                    };
                    break;
                default: 
                    return next_file(); 
                }

                let sidecar_name = basename+"meg.json"; //remove .nii.gz to replace it with .json

                //compose sidecar
                let sidecar = {};
                Object.assign(sidecar, parent_sidecar["meg.json"]);
                //Object.assign(sidecar, parent_sidecar[strip_hierachy(sidecar_name)]);
                Object.assign(sidecar, get_parent_sidecar(parent_sidecar, sidecar_name));
                Object.assign(sidecar, get_sidecar(_path+"/"+sidecar_name));

                let dataset = {
                    datatype: "neuro/meg",
                    desc: fileinfo._fullname,
                    
                    datatype_tags: [ dtag, fileinfo.task.toLowerCase() ], 
                    tags: get_tags(fileinfo),

                    meta: Object.assign(sidecar, get_meta(fileinfo)),
                }

                let channels_fullname = _path+"/"+basename+"channels.tsv"; 
                if(fs.existsSync(channels_fullname)) {
                    files["channels.tsv"] = channels_fullname;
                }
                let events_fullname = _path+"/"+basename+"events.tsv"; 
                if(fs.existsSync(events_fullname)) {
                    files["events.tsv"] = events_fullname;
                }

                //electrodes and coordsystem should come together if they are set
                let electrodes_fullname = _path+"/"+basename+"electrodes.tsv"; 
                if(fs.existsSync(electrodes_fullname)) {
                    files["electrodes.tsv"] = electrodes_fullname;
                }
                let coordsystem_fullname = _path+"/"+basename+"coordsystem.tsv"; 
                if(fs.existsSync(coordsystem_fullname)) {
                    files["coordsystem.tsv"] = coordsystem_fullname;
                }

                bids.datasets.push({dataset, files});
                next_file(); 
            }, cb);
        });
    }


    //converts /something-123_another-123_bold.nii.gz to
    //         /something-123_another-123
    function get_basename(fileinfo) {
        return fileinfo._fullname.substring(0, fileinfo._fullname.length-fileinfo._filename.length);
    }

    function handle_func(parent_sidecar, _path, cb) {
        fs.readdir(_path, (err, files)=>{
            if(err) return cb(err);
            async.forEach(files, (file, next_file)=>{
                let fileinfo = parseBIDSPath(file);
                if(!fileinfo.task) fileinfo.task = "unknown"; //like ds001165
                switch(fileinfo._filename) {
                case "bold.nii":
                case "bold.nii.gz":

                    //let fullname = fileinfo._fullname;
                    //let sidecar_name = fullname.substring(0, fullname.length-fileinfo._filename.length)+"bold.json"; //remove .nii.gz to replace it with .json
                    let basename = get_basename(fileinfo);
                    let sidecar_name = basename+"bold.json";
                        
                    //compose sidecar
                    let sidecar = {};
                    Object.assign(sidecar, parent_sidecar["bold.json"]);
                    //Object.assign(sidecar, parent_sidecar[strip_hierachy(sidecar_name)]);
                    Object.assign(sidecar, get_parent_sidecar(parent_sidecar, sidecar_name));
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

                    let events_fullname = _path+"/"+basename+"events.tsv"; 
                    if(fs.existsSync(events_fullname)) {
                        files["events.tsv"] = events_fullname;
                    }
                        
                    //TODO - sbref.json could be stored on the parent directory without hierarchy.. 
                    let sbref_fullname = _path+"/"+basename+"sbref.nii.gz"; 
                    if(fs.existsSync(sbref_fullname)) {
                        files["sbref.nii.gz"] = sbref_fullname;
                    }
                    let sbrefjson_fullname = _path+"/"+basename+"sbref.json"; 
                    if(fs.existsSync(sbrefjson_fullname)) {
                        files["sbref.json"] = sbrefjson_fullname;
                    }

                    let physio_fullname = _path+"/"+basename+"physio.tsv.gz"; 
                    if(fs.existsSync(physio_fullname)) {
                        files["physio.tsv.gz"] = physio_fullname;
                    }
                    let physiojson_fullname = _path+"/"+basename+"physio.json"; 
                    if(fs.existsSync(physiojson_fullname)) {
                        files["physio.json"] = physiojson_fullname;
                    }

                    bids.datasets.push({dataset, files});
                    next_file(); 
                    break;
                default:
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
            //TODO - generates too many error messages
            //console.error('no sidecar!', path);
        }
        return sidecar;
    }

    function get_sidecar_from_fileinfo(dir, fileinfo, jsonname) {
        if(!fileinfo) return {}

        //let fullname = fileinfo._fullname;
        //let sidecar_name = fullname.substring(0, fullname.length-7)+".json"; //remove .nii.gz to replace it with .json
        let basename = get_basename(fileinfo);
        let sidecar = get_sidecar(dir+"/"+basename+jsonname);
        return sidecar;
    }

    function handle_anat_t1(parent_sidecar, dir, fileinfo, cb) {
        //load (optional?) sidecar
        let sidecar = {};
        Object.assign(sidecar, parent_sidecar["T1w.json"]);
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, fileinfo, "T1w.json"));

        let dataset = {
            datatype: "neuro/anat/t1w",
            desc: fileinfo._fullname,
            datatype_tags: [],
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
        Object.assign(sidecar, parent_sidecar["T2w.json"]);
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, fileinfo, "T2w.json"));
        
        let dataset = {
            datatype: "neuro/anat/t2w",
            desc: fileinfo._fullname,
            datatype_tags: [],
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
        Object.assign(sidecar, parent_sidecar["FLAIR.json"]); //TODO is this right? (I haven't seen it)
        Object.assign(sidecar, get_sidecar_from_fileinfo(dir, fileinfo, "FLAIR.json"));
        
        let dataset = {
            datatype: "neuro/anat/flair",
            desc: fileinfo._fullname,
            tags: get_tags(fileinfo),
            datatype_tags: [],

            meta: Object.assign(sidecar, get_meta(fileinfo)),
        }

        let files = {"flair.nii.gz": dir+"/"+fileinfo._fullname};
        bids.datasets.push({dataset, files});
        cb();
    }
}


