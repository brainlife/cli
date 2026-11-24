"use strict";

//uploads walked BIDS datasets (see bids-walker.js) to a project as data objects.
//shared by bl bids upload and bl aimport

const request = require('request-promise-native');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const terminalOverwrite = require('terminal-overwrite');
const config = require('./config');
const util = require('./util');
const chunks = require('./aimport/chunks');

//need to append any bids entities that make this object unique
//https://github.com/bids-standard/bids-specification/blob/master/src/schema/entities.yaml
const ENTITIES = [
    "task", "acq", "ce", "rec", "dir",
    "run", "mod", "echo", "flip", "inv", "mt", "part", "recording",
    "proc", "split",
    //"space", "res", "den", "label", "desc" //only for derivatives
];

//upload each {dataset, files} unless the project already has it.
//returns the desc of each uploaded and skipped dataset
//chunkMap (bl aimport reference datasets, see aimport/chunks.js): the chunks of each referenced
//array inside an uploaded folder are streamed from their source into the object's tar
exports.uploadDatasets = async function(headers, project, datasets, {tags = [], api = config.api, log = console.log,
    chunkMap = null, openSource = chunks.openSource} = {}) {
    let instanceName = 'upload.'+project.group_id; //same for bl data upload and web upload
    let instance = await util.findOrCreateInstance(headers, instanceName, {project, api});

    let datatypes = {};
    (await util.queryAllDatatypes(headers, api)).forEach(datatype=>{
        datatypes[datatype.name] = datatype._id;
    });

    let uploaded = [];
    let skipped = [];
    for(let dataset_and_files of datasets) {
        log("uploading an object...");
        log(dataset_and_files);

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
        ENTITIES.forEach(e=>{
            if(dataset_and_files.dataset.meta[e]) itemkey["meta."+e] = dataset_and_files.dataset.meta[e];
        });

        let body = await request(api.warehouse + '/dataset', { json: true, headers, qs: {
            find: JSON.stringify(itemkey),
        }});
        if(body.count == 0) {
            let noop = await submit_noop(headers, instance, datatypes, dataset_and_files.dataset, api, log);
            await do_upload(headers, noop, project, dataset_and_files, tags, api, log, {chunkMap, openSource});
            uploaded.push(dataset_and_files.dataset.desc);
        } else {
            log("already uploaded.. skipping");
            skipped.push(dataset_and_files.dataset.desc);
        }
    }
    return {uploaded, skipped};
}

exports.updateParticipants = function(headers, project, bids, {api = config.api} = {}) {
    let body = {
        subjects: bids.participants,
        columns: bids.participants_json,
    }
    console.info("updating participants/column data");
    return axios.put(api.warehouse+'/participant/'+project._id, body, {headers});
}

function submit_noop(headers, instance, datatypes, dataset, api, log) {
    //submit noop to upload data
    //warehouse dataset post api need a real task to submit from
    return request.post({ url: api.amaretti + "/task", headers, json: true, body: {
        instance_id: instance._id,
        name: instance.name,
        service: 'brainlife/app-noop',
        max_runtime: 600*1000, //10 minutes should be enough..
        config: {
            _outputs: [{
                id: "output",
                datatype: datatypes[dataset.datatype],
                datatype_tags: dataset.datatype_tags,
                meta: dataset.meta,
            }]
        }
    }}).then(body=>{
        let task = body.task;
        log("Waiting for upload task to be ready...");
        return new Promise((resolve, reject)=>{
            util.waitForFinish(headers, task, true, err=>{
                if(err) return reject(err);
                resolve(task);
            }, api);
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

//append a stream of known size and wait until the archive has taken it in, so only one
//chunk source is open at a time. With stats, archiver's tar plugin pipes the stream into
//the tar entry instead of collecting it in memory.
function appendAndWait(archive, stream, data) {
    return new Promise((resolve, reject)=>{
        const cleanup = ()=>{
            archive.removeListener('entry', onEntry);
            archive.removeListener('error', onError);
            stream.removeListener('error', onError);
        };
        const onEntry = entry=>{
            if(entry.name !== data.name) return;
            cleanup();
            resolve();
        };
        const onError = err=>{
            cleanup();
            stream.destroy();
            reject(err);
        };
        archive.on('entry', onEntry);
        archive.on('error', onError);
        stream.on('error', onError);
        archive.append(stream, data);
    });
}

//the tar.gz of one object: its files now, and feed() streams the chunks of the referenced
//arrays inside its folders (one at a time; a chunk missing at its source is the fill value)
async function buildArchive(dataset_and_files, {chunkMap = null, openSource = chunks.openSource, log = console.log} = {}) {
    let archive = archiver('tar', { gzip: true });
    const refs = [];
    for(let name in dataset_and_files.files) {
        let fullpath = dataset_and_files.files[name];

        const stats = await fs.promises.stat(fullpath);
        if(stats.isDirectory()) {
            //archive.file() doesn't handle symlinks, so I need to walk the directory in case it contains symlinks
            let entries = await walkDir(fullpath);
            entries.forEach(entry=>{
                let subpath = entry.substring(fullpath.length);
                log(entry, name+subpath);
                archive.append(fs.createReadStream(entry), {name: name+subpath});
            });
            for(const ref of chunks.arraysUnder(chunkMap, fullpath)) refs.push({name, ...ref});
        } else {
            //regular file
            archive.file(fs.realpathSync(fullpath), { name });
        }
    }

    const feed = async ()=>{
        for(const {name, sub, meta} of refs) {
            let streamed = 0, missing = 0;
            for(const key of chunks.chunkKeys(meta)) {
                const src = await openSource(meta.source, key, {inputDir: chunkMap.inputDir});
                if(!src) {
                    missing++;
                    continue;
                }
                await appendAndWait(archive, src.stream, {name: name+'/'+sub+'/'+key,
                    stats: {size: src.size, mode: 0o644, mtime: src.mtime || new Date()}});
                streamed++;
            }
            //the array path is BIDS-named (no identifiers); its source is never printed
            log("streamed "+streamed+" chunk(s) of "+name+'/'+sub+(missing ? " ("+missing+" missing at the source: fill value)" : ""));
        }
    };
    return {archive, feed};
}
exports.buildArchive = buildArchive;

async function do_upload(headers, noop, project, dataset_and_files, tags, api, log, {chunkMap = null, openSource = chunks.openSource} = {}) {

    //create tar ball with all files
    const {archive, feed} = await buildArchive(dataset_and_files, {chunkMap, openSource, log});

    return new Promise((resolve, reject)=>{
        let progress = null;
        //stop the progress timer on any error, or it keeps the process alive
        const fail = err=>{
            clearInterval(progress);
            reject(err);
        };
        archive.on('error', fail);

        //then pipe to the noop
        //TODO - replace with axios, and use upload2 API which uses muti-part
        let req = request.post({
            url: api.amaretti+"/task/upload/"+noop._id+"?p=upload.tar.gz&untar=true",
            headers,
        });
        req.catch(()=>{}); //errors are handled by the 'error' and 'response' events
        req.on('error', fail);
        archive.pipe(req);
        feed().then(()=>archive.finalize(), err=>{
            archive.abort();
            req.abort();
            fail(err);
        });

        let total = 0;
        archive.on('data', data=>{
            total += data.length;
        });
        progress = setInterval(()=>{
            terminalOverwrite.clear();
            terminalOverwrite("Uploading .. "+(total/(1024*1024)).toFixed(1)+"MB");
        }, 5000);

        req.on('response', res=>{
            clearInterval(progress);
            terminalOverwrite.done();

            if(res.statusCode != "200") return reject(new Error("upload failed with status "+res.statusCode));
            let dataset = dataset_and_files.dataset;
            log("Data object successfully uploaded.. now registering");

            //append user specified tags to all dataset tags
            let all = new Set([...tags, ...dataset.tags]); //dedup
            dataset.tags = [...all]; //convert back to array

            request.post({url: api.warehouse+'/dataset', json: true, headers: headers, body: {
                project: project._id,
                task_id: noop._id,
                output_id: "output", //app-noop isn't BL app so we just have to come up with a name (TODO why not register app?)

                meta: dataset.meta,
                desc: dataset.desc,
                tags: dataset.tags,

            }}).then(_dataset=>{
                log("Registered data object:", _dataset._id);
                resolve(_dataset);
            }).catch(reject);
        });
    });
}
