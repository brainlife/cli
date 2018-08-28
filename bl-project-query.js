#!/usr/bin/env node

const request = require('request-promise-native');
const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter projects by id')
    .option('-q, --query <query>', 'filter projects by name or description')
    .option('-a, --admin <admin>', 'filter project with a given admin')
    .option('-m, --member <members>', 'filter project with a given member')
    .option('-g, --guest <guests>', 'filter project with a given guest')
    .option('-s, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-j, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    
    util.queryProjects(headers, {
        id: commander.id,
        search: commander.query,
        admin: commander.admin,
        member: commander.member,
        guest: commander.guest
    }, {
        skip: commander.skip,
        limit: commander.limit
    }).then(async projects=>{
        if (commander.json) console.log(JSON.stringify(projects));
        else console.log(await formatProjects(headers, projects));
    }).catch(err=>{
        console.error(err);
    });
});

async function formatProjects(headers, data) {
    let profiles = await util.queryAllProfiles(headers);
    let profileTable = {};
    profiles.forEach(profile => profileTable[profile.id] = profile);

    let resultArray = data.map(project => {
        let info = [];
        let formattedAdmins = [];
        let formattedMembers = [];
        let formattedGuests = [];
        
        if (project.admins) formattedAdmins = project.admins.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
        if (project.members) formattedMembers = project.members.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
        if (project.guests) formattedGuests = project.guests.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
        
        let formattedAccess = "Access: " + project.access;
        if (project.listed) formattedAccess += " (but listed for all users)";

        info.push("Id: " + project._id);
        info.push("Name: " + project.name);
        info.push("Admins: " + formattedAdmins.join(', '));
        info.push("Members: " + formattedMembers.join(', '));
        info.push("Guests: " + formattedGuests.join(', '));
        info.push("Access: " + formattedAccess);
        info.push("Description: " + project.desc);
        return info.join('\n');
    });
    
    resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
    return resultArray.join('\n\n');
}
