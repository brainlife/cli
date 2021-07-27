#!/usr/bin/env node

const request = require('request-promise-native');
const config = require('./config');
const fs = require('fs');
//const async = require('async');
//const archiver = require('archiver');
//const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');
//const path = require('path');
const tmp = require('tmp');
const child_process = require('child_process');

commander
    .option('--output <directory>', 'path where you want to output the data')
    .option('--id <data_id>', 'specify data object id', util.collect, [])
    .option('--datatype <datatype>', 'filter data objects by datatypes', util.collect, [])
    .option('--datatype_tag <datatype tag>', 'filter data objects by datatype tag', util.collect, [])
    .option('--tag <data object tag>', 'filter data objects by data tag', util.collect, [])
    .option('--project <project_id>', 'filter data objects by project id')
    .option('--pub <publication_id>', 'filter data object by publication id')
    .option('--subject <subject>', 'filter data objects by subject', util.collect, [])
    .option('--skip <skip>', 'number of results to skip')
    .option('--limit <limit>', 'maximum number of results to show (default 100)')
    .parse(process.argv);

try {
    if (!commander.project && !commander.pub && commander.id.length == 0) throw new Error("please specify either project or pub id, or data object id");
} catch(err) {
    console.error(err.toString());
    process.exit(1);
}

util.loadJwt().then(async jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    
    //construct find query to pass to downscript api
    let find = { 
        project: commander.project,
        publications: commander.pub,
    };

    //if user is querying for published dataset, don't filter out removed datasets
    if(!commander.pub) find.removed = false;

    if(commander.datatype.length > 0) {
        let datatypes = [];
        for(let datatype of commander.datatype) {
            let type = await util.getDatatype(headers, datatype);
            datatypes.push(type._id);
        }
        find.datatype = {$in: datatypes};
    }

    if(commander.subject.length > 0) {
        find["meta.subject"] = {$in: commander.subject};
    }
    if(commander.id.length > 0) {
        find._id = {$in: commander.id};
    }
    if(commander.tag.length > 0) {
        let all = [];
        let nin = [];
        commander.tag.forEach(tag=>{
            if(tag[0] != "!") all.push(tag);
            else nin.push(tag.substring(1));
        });
        find.tags = {};
        if(all) find.tags["$all"] = all;
        if(nin) find.tags["$nin"] = nin;
    }
    if(commander.datatype_tag.length > 0) {
        let all = [];
        let nin = [];
        commander.datatype_tag.forEach(tag=>{
            if(tag[0] != "!") all.push(tag);
            else nin.push(tag.substring(1));
        });
        find.datatype_tags = {};
        if(all) find.datatype_tags["$all"] = all;
        if(nin) find.datatype_tags["$nin"] = nin;
    }
    
    request.post({url: config.api.warehouse + '/dataset/downscript', json: true, headers, 
        body: {
            find,
            limit: +(commander.limit||100),
            skip: +(commander.skip||0),
        }
    }, (err, res, body)=>{
        if(err) throw new Error(err);
        let tmpname = tmp.tmpNameSync();
        fs.writeFileSync(tmpname, body);
        fs.chmodSync(tmpname, 0o700);

        let opt = {};
        if(commander.output) opt.cwd = commander.output;
        let down = child_process.spawn(tmpname, opt);
        down.stdout.pipe(process.stdout);
        down.stderr.pipe(process.stderr);
        down.on('exit', code=>{
            fs.unlink(tmpname);
            process.exit(code);
        });
    });
});


