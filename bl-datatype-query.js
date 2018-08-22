#!/usr/bin/env node

const request = require('request');
const config = require('./config');
const fs = require('fs');
const async = require('async');
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter datatype by id')
    .option('-q, --query <query>', 'filter datatype by name or description')
    .option('-s, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-j, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    util.queryDatatypes(headers, {
        id: commander.id,
        search: commander.query
    }, {
        skip: commander.skip,
        limit: commander.limit
    }).then(datatypes=>{
        if (commander.json) console.log(JSON.stringify(datatypes));
        else console.log(formatDatatypes(headers, datatypes, { all : true }));
    }).catch(err=>{
        console.error(err);
    });
});

function formatDatatypes(headers, data, whatToShow) {
    let resultArray = data.map(datatype => {
        let info = [];
        let formattedFiles = datatype.files.map(file => {
            return "[" + (file.required?'(required) ':'') + file.id + ": " + (file.filename||file.dirname) + "]";
        }).join('  ');

        if (whatToShow.all || whatToShow.id) info.push("Id: " + datatype._id);
        if (whatToShow.all || whatToShow.name) info.push("Name: " + datatype.name);
        if (whatToShow.all || whatToShow.desc) info.push("Description: " + datatype.desc);
        if (whatToShow.all || whatToShow.files) info.push("Files: " + formattedFiles);

        return info.join('\n');
    });
    
    resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
    return resultArray.join('\n\n');
}
