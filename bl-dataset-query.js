#!/usr/bin/env node

const request = require('request-promise-native');
const argv = require('minimist')(process.argv.slice(2));
const config = require('./config');
const fs = require('fs');
const async = require('async');
const spawn = require('child_process').spawn;
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');
const timeago = require('time-ago');

commander
    .option('-i, --id <id>', 'filter datasets by id')
    .option('-q, --search <search>', 'filter datasets by desc')
    .option('-d, --datatype <datatype>', 'filter datasets by datatype')
    .option('-t, --datatype_tag <datatype tag>', 'filter datasets by datatype tag')
    .option('-p, --project <projectid>', 'filter datasets by project id')
    .option('--sub, --subject <subject>', 'filter datasets by subject')
    .option('--taskid <projectid>', 'filter datasets by provenance task id')
    .option('-s, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-r, --raw', 'output data in json format')
    .option('-j, --json', 'output data in json format')
    .option('--product', 'get all product.json information')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(async jwt => {
    commander.raw = commander.raw || commander.json;
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    let datatypeTable = {};
    
    if (!argv['datatype_tag']) argv['datatype_tag'] = [];
    if (!Array.isArray(argv['datatype_tag'])) argv['datatype_tag'] = [ argv['datatype_tag'] ];
    
    let datasets = await util.queryDatasets(headers, {
        id: commander.id,
        search: commander.search,
        datatype: commander.datatype,
        datatypeTags: argv['datatype_tag'],
        project: commander.project,
        subject: commander.subject,
        taskId: commander.taskid
    }, {
        skip: commander.skip,
        limit: commander.limit
    });
    
    if (commander.product) getProductJSON(headers, datasets).then(console.log);
    else if (commander.raw) console.log(JSON.stringify(datasets));
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
        
        let resultArray = data.map(d => {
            let info = [];
            let createDateObject = new Date(d.create_date);
            let formattedDate = createDateObject.toLocaleString() + " (" + timeago.ago(createDateObject) + ")";
            let subject = d.meta && d.meta.subject ? d.meta.subject : 'N/A';
            let formattedDatatype = datatypeTable[d.datatype].name;
            let formattedDatatypeTags = d.datatype_tags.length == 0 ? '' : "<" + d.datatype_tags.join(', ') + ">";
            
            let formattedProject = 'Unknown', formattedAdmins = [], formattedMembers = [], formattedGuests = [];
            if (projectTable[d.project]) {
                formattedProject = projectTable[d.project].name;
                
                if (projectTable[d.project].admins) formattedAdmins = projectTable[d.project].admins.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
                if (projectTable[d.project].members) formattedMembers = projectTable[d.project].members.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
                if (projectTable[d.project].guests) formattedGuests = projectTable[d.project].guests.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
            }
            
            if (whatToShow.all || whatToShow.id) info.push("Id: " + d._id);
            if (whatToShow.all || whatToShow.project) info.push("Project: " + formattedProject);
            if (whatToShow.all || whatToShow.project) info.push("Admins: " + formattedAdmins.join(', '));
            if (whatToShow.all || whatToShow.project) info.push("Members: " + formattedMembers.join(', '));
            if (whatToShow.all || whatToShow.project) info.push("Guests: " + formattedGuests.join(', '));
            if (whatToShow.all || whatToShow.subject) info.push("Subject: " + subject);
            if (whatToShow.all || whatToShow.subject) info.push("Session: " + (d.meta ? (d.meta.session || "") : ""));
            if (whatToShow.all || whatToShow.datatype) info.push("Datatype: " + formattedDatatype + formattedDatatypeTags);
            if (whatToShow.all || whatToShow.desc) info.push("Description: " + (d.desc||''));
            if (whatToShow.all || whatToShow.create_date) info.push("Create Date: " + formattedDate);
            if (whatToShow.all || whatToShow.storage) info.push("Storage: " + (d.storage || 'N/A'));
            if (whatToShow.all || whatToShow.status) info.push("Status: " + (d.status || 'unknown'));
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