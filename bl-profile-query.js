#!/usr/bin/env node

const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter profiles by id')
    .option('-q, --query <query>', 'filter profiles by username, full name, or email address')
    .option('-j, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    let datatypeTable = {};
    
    util.queryProfiles(headers, {
        id: commander.id,
        search: commander.query
    }).then(profiles=>{
        if (commander.json) console.log(JSON.stringify(profiles));
        else console.log(formatProfiles(headers, profiles));
    }).catch(err=>{
        console.error(err);
    });
});

function formatProfiles(headers, data) {
    data = data.sort((a, b) => a.id > b.id);
    let resultArray = data.map(profile => {
        let info = [];
        info.push("sub: " + profile.sub);
        info.push("Username: " + profile.username);
        info.push("Full Name: " + profile.fullname);
        info.push("Email: " + profile.email);
        info.push("Active: " + profile.active);
        return info.join('\n');
    });
    resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
    return resultArray.join('\n\n');
}
