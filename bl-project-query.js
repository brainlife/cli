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

async function formatProjects(headers, projects) {

    //query all sub that I need to query for profiles
    let subs = [];
    function add_to_subs(sub) {
        if(!subs.includes(sub)) subs.push(sub);
    }
    projects.forEach(project=>{
        if(project.admins) project.admins.forEach(add_to_subs);
        if(project.guests) project.guests.forEach(add_to_subs);
        if(project.members) project.members.forEach(add_to_subs);
    });
    let users = await util.queryProfiles(headers, {subs: {$in: subs}}, {limit: 0});

    function find_user_by_sub(sub) {
        return users.find(u=>u.sub.toString() == sub);
    }
    let resultArray = projects.map(project => {
        let info = [];

        let admins = [];
        if(project.admins) admins = project.admins.map(find_user_by_sub).filter(i=>i != null).map(i=>i.username);
        let members = [];
        if(project.members) members = project.members.map(find_user_by_sub).filter(i=>i != null).map(i=>i.username);
        let guests = [];
        if(project.guests) guests = project.guests.map(find_user_by_sub).filter(i=>i != null).map(i=>i.username);
        
        let formattedAccess = "Access: " + project.access;
        if (project.listed) formattedAccess += " (but listed for all users)";

        info.push("Id: " + project._id);
        info.push("Name: " + project.name);
        info.push("Admins: " + admins.join(', '));
        info.push("Members: " + members.join(', '));
        info.push("Guests: " + guests.join(', '));
        info.push("Access: " + formattedAccess);
        info.push("Description: " + project.desc);
        return info.join('\n');
    });
    
    resultArray.push("(Returned " + projects.length + " " + util.pluralize("result", projects) + ")");
    return resultArray.join('\n\n');
}
