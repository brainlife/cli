#!/usr/bin/env node

const request = require('request');
const argv = require('minimist')(process.argv.slice(2));
const config = require('./config');
const fs = require('fs');
const async = require('async');
const spawn = require('child_process').spawn;

if(!Array.isArray(argv.tag)) argv.tag = [argv.tag];
if(!Array.isArray(argv.datatype_tag)) argv.datatype_tag = [argv.datatype_tag];

console.log("arguments");
console.dir(argv);

//TODO validate input arguments
if(!argv.name) throw new Error("name missing");
if(!argv.desc) throw new Error("desc missing");
if(!argv.project_id) throw new Error("project_id missing");
if(!argv.subject) throw new Error("subject missing");

//check if user is logged in
fs.stat(config.path.jwt, (err, stat)=>{
    if(err) {
        console.log("not logged in?");
        process.exit(1);
    }
    var headers = { "Authorization": "Bearer "+fs.readFileSync(config.path.jwt) };
    var instance;
    get_instance(headers).then(_instance=>{
        console.log("using instance");
        console.dir(instance);
        instance = _instance;

        return get_resource(headers);
    }).then(resource=>{
        console.log("resource to upload");
        console.dir(resource);
        run(headers, instance, resource);
    }).catch(err=>{
        console.error(err);
    });
});

var instance_name = "warehouse-cli.upload";
function get_instance(headers) {
    console.log("finding instance");
    return new Promise((resolve, reject)=>{
        //get instance that might already exist
        var find = { name: instance_name };
        request.get({url: config.api.wf+"/instance?find="+JSON.stringify(find), headers: headers, json: true}, function(err, res, body) {
            if(err) return reject(err);
            if(res.statusCode != 200) return reject(res.statusCode);
            if(body.instances[0]) resolve(body.instances[0]);
            else {
                //need to create new instance
                request.post({url: config.api.wf+"/instance", headers: headers, json: true, form: { name: instance_name },
                }, function(err, res, body) {
                    if(err) return reject(err);
                    resolve(body);
                }); 
            }
        });
    });
}

function get_resource(headers) {
    console.log("get resource");
    return new Promise((resolve, reject)=>{
        request.get({url: config.api.wf+"/resource/best?service=soichih/sca-service-noop", headers: headers, json: true}, function(err, res, body) {
            if(err) return reject(err);
            if(res.statusCode != 200) return reject(res.statusCode);
            if(!body.resource) return reject("no upload resource");
            resolve(body.resource);
        });
    });
}

function run(headers, instance, resource) {
    //search for datatype specified
    var find = { name: argv.type }
    request.get({url: config.api.warehouse+"/datatype?find="+JSON.stringify(find), json: true}, function(err, res, body) {
        if(err) throw err;
        if(!body.datatypes) throw new Error("Failed to load datatypes");
        if(body.datatypes.length != 1) throw new Error("Failed to load exact 1 datatypes");
        var datatype = body.datatypes[0];

        console.log("datatype");
        console.dir(datatype);  
        var dir = argv._[0];
        
        //look for files we expect
        var taropts = ['-cz'];
        async.forEach(datatype.files, (file, next_file)=>{
            console.log("looking for", file.filename||file.dirname);
            fs.stat(dir+"/"+file.filename, (err,stats)=>{
                if(err) {
                    //try dirname
                    fs.stat(dir+"/"+file.dirname, (err,stats)=>{
                        if(err) throw err;
                        console.dir([file, stats]);
                        taropts.push(file.dirname);
                        next_file();
                    });
                } else {
                    console.dir([file, stats]);
                    taropts.push(file.filename);
                    next_file();
                }
            });
        }, err=>{
            if(err) throw err;

            //submit noop to upload data
            //warehouse dataset post api need a real task to submit from
            request.post({url: config.api.wf+"/task", headers: headers, json: true, body: {
                instance_id: instance._id,
                name: "warehouse-cli.upload",
                service: "soichih/sca-service-noop",
            }}, function(err, res, body) {
                if(err) throw err;
                var task = body.task;
                console.log("task submitted");
                console.dir(body);

                console.log("uploading", task._id);
                var path = new Buffer(instance._id+'/'+task._id+'/upload.tar.gz').toString('base64');
                var req = request.post({url: config.api.wf+"/resource/upload/"+resource._id+"/"+path+"?untar=true", headers: headers});
                var tar = spawn('/bin/tar', taropts, {cwd: dir});
                tar.stdout.pipe(req).on('end', function() {
                    console.log("done uploading");

                    //TODO - should I submit validation/normalization task?

                    console.log("posting to warehouse");
                    request.post({url: config.api.warehouse+'/dataset', json: true, headers: headers, body: {
                        //info for dataset
                        project: argv.project_id,
                        name: argv.name,
                        desc: argv.desc,
                        datatype: datatype._id,
                        datatype_tags: argv.datatype_tag,
                        tags: argv.tag, 

                        meta: {subject: argv.subject},

                        instance_id: instance._id,
                        task_id: task._id, //we archive data from copy task
                    }}, function(err, res, body) {
                        if(err) throw err;
                        console.log("dataset registgered");
                        console.dir(body);
                    });
                });
            });
            
        });
    });
}


