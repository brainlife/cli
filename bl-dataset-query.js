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
    .option('-i, --id <id>', 'filter datasets by id')
    .option('-q, --query <query>', 'filter datasets by desc')
    .option('-d, --datatype <datatype>', 'filter datasets by datatype')
    .option('--datatype_tag <datatype tag>', 'filter datasets by datatype tag', collect, [])
    .option('--tag <dataset tag>', 'filter datasets by dataset tag', collect, [])
    .option('-p, --project <projectid>', 'filter datasets by project id')
    .option('-b, --subject <subject>', 'filter datasets by subject')
    .option('--taskid <projectid>', 'filter datasets by provenance task id')
    .option('-s, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-j, --json', 'output data in json format')
    .option('--product', 'get all product.json information')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(async jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    let datatypeTable = {};
    
    let datasets = await util.queryDatasets(headers, {
        id: commander.id,
        search: commander.query,
        datatype: commander.datatype,
        datatypeTags: commander.datatype_tag,
        tags: commander.tag,
        project: commander.project,
        subject: commander.subject,
        taskId: commander.taskid
    }, {
        skip: commander.skip,
        limit: commander.limit
    });
    
    if (commander.product) getProductJSON(headers, datasets).then(console.log);
    else if (commander.json) console.log(JSON.stringify(datasets));
    else {
        formatDatasets(headers, datasets, commander.skip, { all: true }).then(console.log);
    }
}).catch(util.error);

function getProductJSON(headers, data) {
    return new Promise(async (resolve, reject) => {
        let productTable = {};
        for (let d of data) {
            if (d.prov && typeof d.prov.task_id == 'string') {
                let task = await getTask(headers, d.prov.task_id);
                if (task.product) productTable[task._id] = task.product;
            }
        }
        resolve(JSON.stringify(productTable));
    });    
}

/**
 * Format dataset information
 * @param {dataset[]} data
 * @param {Object} whatToShow
 * @returns {Promise<string>}
 */
function formatDatasets(headers, data, skip, whatToShow) {
    return new Promise(async (resolve, reject) => {
        let projects = await util.queryAllProjects(headers);
        let datatypes = await util.queryAllDatatypes(headers);
        let profiles = await util.queryAllProfiles(headers);
        
        let projectTable = {}, datatypeTable = {}, profileTable = {};
        
        projects.forEach(project => projectTable[project._id] = project);
        datatypes.forEach(datatype => datatypeTable[datatype._id] = datatype);
        profiles.forEach(profile => profileTable[profile.id] = profile);
        
        let resultArray = data.map(dataset => {
            let info = [];
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
            
            if (whatToShow.all || whatToShow.id) info.push("Id: " + dataset._id);
            if (whatToShow.all || whatToShow.project) info.push("Project: " + formattedProject);
            if (whatToShow.all || whatToShow.project) info.push("Admins: " + formattedAdmins.join(', '));
            if (whatToShow.all || whatToShow.project) info.push("Members: " + formattedMembers.join(', '));
            if (whatToShow.all || whatToShow.project) info.push("Guests: " + formattedGuests.join(', '));
            if (whatToShow.all || whatToShow.subject) info.push("Subject: " + subject);
            if (whatToShow.all || whatToShow.subject) info.push("Session: " + (dataset.meta ? (dataset.meta.session || "") : ""));
            if (whatToShow.all || whatToShow.datatype) info.push("Datatype: " + formattedDatatype + formattedDatatypeTags);
            if (whatToShow.all || whatToShow.desc) info.push("Description: " + (dataset.desc||''));
            if (whatToShow.all || whatToShow.create_date) info.push("Create Date: " + formattedDate);
            if (whatToShow.all || whatToShow.storage) info.push("Storage: " + (dataset.storage || 'N/A'));
            if (whatToShow.all || whatToShow.status) info.push("Status: " + (dataset.status || 'unknown'));
            if (whatToShow.all || whatToShow.status) info.push("Tags: " + formattedTags);
            // if (whatToShow.all || whatToShow.meta) info.push("Meta: " + formattedMeta);

            return info.join('\n');
        });
        
        if (data.count) {
            skip = +(skip || '');
            if (skip == 0 && data.length == data.count) resultArray.push("(Showing all " + data.length + " of " + data.length + " datasets)");
            else if (skip + data.length >= data.count) resultArray.push("(Showing last " + data.length + " of " + data.count + " datasets)");
            else if (skip == 0) resultArray.push("(" + data.count + " total datasets, showing first " + data.length + ". To view the next " + Math.min(data.length, data.count - data.length) + ", run 'bl dataset query --skip " + data.length + "'");
            else {
                resultArray.push("(Showing datasets " + skip + " - " + (skip + data.length) + " of " + data.count + ")");
            }
        }
        else {
            resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
        }
        resolve(resultArray.join('\n\n'));
    });
}

/**
 * Get a task from a task id
 * @param {any} headers 
 * @param {string} taskId 
 */
function getTask(headers, taskId) {
    return new Promise((resolve, reject) => {
        if (!util.isValidObjectId(taskId)) error("'" + taskId + "' is not a valid task id.");
        let url = config.api.wf + '/task/' + taskId;
        request.get(url, { headers, json: true }, (err, res, body) => {
            if (err) reject(err);
            else if (res.statusCode != 200) reject(res.statusCode + ": " + res.statusMessage);
            else {
                resolve(body);
            }
        });
    });
}

function collect(val, arr) {
    arr.push(val);
    return arr;
}