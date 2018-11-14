#!/usr/bin/env node

const request = require('request-promise-native');
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

    let query = {};
    if(commander.id) query._id = commander.id;
    if(commander.query) query.$or = [
        { name: { $regex: commander.query, $options: 'ig' } },
        { desc: { $regex: commander.query, $options: 'ig' } },
    ];

    request(config.api.warehouse + '/datatype', { headers, json: true,
        qs: {
            find: JSON.stringify(query),
            sort: "name",
            skip: commander.skip,
            limit: commander.limit,
        } 
    }).then(body=>{;
        if (commander.json) console.log(JSON.stringify(body.datatypes));
        else console.log(formatDatatypes(headers, body.datatypes, { all : true }));
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
