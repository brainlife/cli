#!/usr/bin/env node

const request = require('request-promise-native');
const config = require('./config');
const fs = require('fs');
const async = require('async');
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');
const timeago = require('time-ago');

commander
    .option('--id <id>', 'dataset ID to update')
    .option('--desc <desc>', 'description to set')
    .option('--subject <subject>', 'set subject name')
    .option('--session <session>', 'set session name')
    .option('--run <run>', 'set run name')
    .option('--add_tag <tag>', 'tag to add', util.collect, [])
    .option('--remove_tag <tag>', 'tag to remove', util.collect, [])
    .option('-h, --h')
    .parse(process.argv);

if(commander.h) return commander.help();

if(!commander.id) throw new Error("please specify dataset id to update");

util.loadJwt().then(jwt => {

    //find the dataset to update
    request(config.api.warehouse + '/dataset', { 
        json: true, 
        headers: { 
            Authorization: "Bearer " + jwt,
        }, 
        qs: {
            find: JSON.stringify({_id: commander.id }),
        } 
    }).then(body=>{
        if(body.datasets.length != 1) throw new Error("failed to find the dataset");
        let dataset = body.datasets[0];
        let req = { meta: dataset.meta, tags: dataset.tags };
        if(commander.desc) req.desc = commander.desc;
        if(commander.subject) req.meta.subject = commander.subject;
        if(commander.session) req.meta.session = commander.session;
        if(commander.run) req.meta.run = commander.run;
        if(commander.subject == "") delete req.meta.subject;
        if(commander.session == "") delete req.meta.session;
        if(commander.run == "") delete req.meta.run;
        commander.add_tag.forEach(tag=>{
            if(!tag) return;
            if(!req.tags.includes(tag)) req.tags.push(tag);
        });
        commander.remove_tag.forEach(tag=>{
            if(!tag) return;
            let pos = req.tags.indexOf(tag);
            if(~pos) req.tags.splice(pos, 1);
        });

        request.put(config.api.warehouse+'/dataset/'+commander.id, {
            json : true,
            headers: { 
                Authorization: "Bearer " + jwt,
            }, 
            body: req,
        });
    });
    /*
    util.queryDatasets(headers, {
        id: commander.id,
        search: commander.query,
        datatype: commander.datatype,
        datatypeTags: commander.datatype_tag,
        tags: commander.tag,
        project: commander.project,
        pub: commander.pub,
        subject: commander.subject,
        taskId: commander.taskid
    }, {
        skip: commander.skip,
        limit: commander.limit
    }).then(async datasets=>{
        if (commander.json) console.log(JSON.stringify(datasets));
        else outputDatasets(headers, datasets, commander.skip);
    }).catch(err=>{
        console.error(err);
    });
    */
});

/*
async function outputDatasets(headers, data, skip) {
    let projects = await util.queryAllProjects(headers);
    let datatypes = await util.queryAllDatatypes(headers);
    let profiles = await util.queryAllProfiles(headers);
    
    let projectTable = {}, datatypeTable = {}, profileTable = {};
    projects.forEach(project => projectTable[project._id] = project);
    datatypes.forEach(datatype => datatypeTable[datatype._id] = datatype);
    profiles.forEach(profile => profileTable[profile.id] = profile);
    
    data.forEach(dataset => {
        let createDateObject = new Date(dataset.create_date);
        let formattedDate = createDateObject.toLocaleString() + " (" + timeago.ago(createDateObject) + ")";
        let subject = dataset.meta && dataset.meta.subject ? dataset.meta.subject : 'N/A';
        let formattedDatatype = datatypeTable[dataset.datatype].name;
        let formattedDatatypeTags = dataset.datatype_tags.length == 0 ? '' : "<" + dataset.datatype_tags.join(', ') + ">";
        let formattedTags = (dataset.tags || []).join(', ');
        let formattedProject = 'Unknown', formattedAdmins = [], formattedMembers = [], formattedGuests = [];

        if (projectTable[dataset.project]) {
            formattedProject = projectTable[dataset.project].name;
            if (projectTable[dataset.project].admins) formattedAdmins = projectTable[dataset.project].admins.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
            if (projectTable[dataset.project].members) formattedMembers = projectTable[dataset.project].members.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
            if (projectTable[dataset.project].guests) formattedGuests = projectTable[dataset.project].guests.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
        }
        
        console.log("Id: " + dataset._id);
        console.log("Project: " + formattedProject);
        console.log("Admins: " + formattedAdmins.join(', '));
        console.log("Members: " + formattedMembers.join(', '));
        console.log("Guests: " + formattedGuests.join(', '));
        console.log("Subject: " + subject);
        console.log("Session: " + (dataset.meta ? (dataset.meta.session || "") : ""));
        console.log("Datatype: " + formattedDatatype + formattedDatatypeTags);
        console.log("Description: " + (dataset.desc||''));
        console.log("Create Date: " + formattedDate);
        console.log("Storage: " + (dataset.storage || 'N/A'));
        console.log("Status: " + (dataset.status || 'unknown'));
        console.log("Tags: " + formattedTags);
        console.log("");
    });
    
    if (data.count) {
        skip = +(skip || '');
        if (skip == 0 && data.length == data.count) console.log("Showing all " + data.length + " of " + data.length + " datasets");
        else if (skip + data.length >= data.count) console.log("Showing last " + data.length + " of " + data.count + " datasets");
        else if (skip == 0) {
            console.log(data.count + " total datasets, showing first " + data.length +
                ". To view the next " + Math.min(data.length, data.count - data.length) + 
                ", run 'bl dataset query --skip " + data.length + "'");
        } else console.log("Showing datasets " + skip + " - " + (skip + data.length) + " of " + data.count);
    } else {
        console.log("Returned " + data.length + " " + util.pluralize("result", data));
    }
}
*/
