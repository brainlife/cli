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
    .option('--datatype_tag <datatype tag>', 'filter datasets by datatype tag', util.collect, [])
    .option('--tag <dataset tag>', 'filter datasets by dataset tag', util.collect, [])
    .option('-p, --project <projectid>', 'filter datasets by project id')
    .option('-u, --pub <releaseID>', 'filter datasets by publication release id')
    .option('-b, --subject <subject>', 'filter datasets by subject')
    .option('--session <session>', 'filter datasets by session ID')
    .option('--run <run>', 'filter datasets by run ID')
    .option('--taskid <projectid>', 'filter datasets by provenance task id')
    .option('-s, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-j, --json', 'output data in json format')
    .option('--s3', 'list raw S3 files/folders for the project (use with --project)')
    .option('--path <path>', 'S3 subfolder path to list within the project (use with --s3)')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };

    if (commander.s3) {
        if (!commander.project) {
            console.error("--project is required when using --s3");
            process.exit(1);
        }
        listS3Files(headers, commander.project, commander.path, commander.json);
        return;
    }

    let datatypeTable = {};
    util.queryDatasets(headers, {
        id: commander.id,
        search: commander.query,
        datatype: commander.datatype,
        datatypeTags: commander.datatype_tag,
        tags: commander.tag,
        project: commander.project,
        pub: commander.pub,
        subject: commander.subject,
        session: commander.session,
        run: commander.run,
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
}).catch(console.error);

async function outputDatasets(headers, data, skip) {
    //TODO - don't this this
    let projects = await util.queryAllProjects(headers);
    let datatypes = await util.queryAllDatatypes(headers);
    let profiles = await util.queryAllProfiles(headers);
    
    let projectTable = {}, datatypeTable = {}, profileTable = {};
    projects.forEach(project => projectTable[project._id] = project);
    datatypes.forEach(datatype => datatypeTable[datatype._id] = datatype);
    profiles.forEach(profile => profileTable[profile.sub] = profile);
    
    data.forEach(dataset => {
        let createDateObject = new Date(dataset.create_date);
        let formattedDate = createDateObject.toLocaleString() + " (" + timeago.ago(createDateObject) + ")";
        let formattedDatatype = datatypeTable[dataset.datatype].name;
        let formattedDatatypeTags = dataset.datatype_tags.length == 0 ? '' : "<" + dataset.datatype_tags.join(', ') + ">";
        let formattedTags = (dataset.tags || []).join(', ');
        let formattedProject = 'Unknown', formattedAdmins = [], formattedMembers = [], formattedGuests = [];

        if (projectTable[dataset.project]) {
            formattedProject = projectTable[dataset.project].name;
            if (projectTable[dataset.project].admins) {
                formattedAdmins = projectTable[dataset.project].admins.map(s => profileTable[s.toString()] ? profileTable[s].username : 'unknown');
            }
            if (projectTable[dataset.project].members) formattedMembers = projectTable[dataset.project].members.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
            if (projectTable[dataset.project].guests) formattedGuests = projectTable[dataset.project].guests.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
        }
        
        console.log("Id: " + dataset._id);
        console.log("Project: " + formattedProject);
        console.log("Admins: " + formattedAdmins.join(', '));
        console.log("Members: " + formattedMembers.join(', '));
        console.log("Guests: " + formattedGuests.join(', '));
        console.log("Subject: " + (dataset.meta && dataset.meta.subject ? dataset.meta.subject : 'N/A'));
        console.log("Session: " + (dataset.meta && dataset.meta.session ? dataset.meta.session : ""));
        console.log("Run: " + (dataset.meta && dataset.meta.run ? dataset.meta.run : ""));
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

async function listS3Files(headers, projectInput, subPath, json) {
    const projects = await util.resolveProjects(headers, projectInput);
    if (projects.length === 0) {
        console.error("No project found matching '" + projectInput + "' (or you don't have access)");
        process.exit(1);
    }
    if (projects.length > 1) {
        console.error("Multiple projects found matching '" + projectInput + "'. Please use a project ID.");
        process.exit(1);
    }
    const project = projects[0];
    const projectId = project._id;

    try {
        const data = await util.listWarehouseFiles(headers, projectId, subPath);

        if (json) {
            console.log(JSON.stringify({ project: projectId, path: subPath || '', folders: data.folders, objects: data.objects }));
            return;
        }

        console.log("Project: " + project.name + " (" + projectId + ")");
        if (subPath) console.log("Path:    " + subPath);
        console.log("");

        if ((!data.folders || data.folders.length === 0) && (!data.objects || data.objects.length === 0)) {
            console.log("(empty — no files found at this path)");
            return;
        }

        (data.folders || []).forEach(f => {
            console.log("  [DIR]  " + f.Name + "/");
        });
        (data.objects || []).forEach(f => {
            const sizeStr = util.formatBytes(f.Size);
            const date = f.LastModified ? new Date(f.LastModified).toLocaleDateString() : '';
            console.log("  [FILE] " + f.Name + " (" + sizeStr + (date ? ", " + date : "") + ")");
        });
        console.log("\n" + (data.folders || []).length + " folder(s), " + (data.objects || []).length + " file(s)" +
            (data.isTruncated ? " (truncated — use --limit or paginate with nextContinuationToken)" : ""));
    } catch (err) {
        if (err.response && err.response.status === 400) {
            console.error("This project's files are not stored on S3.");
        } else if (err.response && err.response.status === 403) {
            console.error("Access denied. You may not have permission to access this project's files.");
        } else if (err.response && err.response.status === 404) {
            console.error("Path not found: " + (subPath || '(project root)'));
        } else {
            console.error("Failed to list files: " + (err.message || err));
        }
        process.exit(1);
    }
}
