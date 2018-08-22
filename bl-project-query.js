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
    }).then(projects=>{
        if (commander.json) console.log(JSON.stringify(projects));
        else showProjects(headers, projects);
    }).catch(err=>{
        console.error(err);
    });
});

/**
 * Output a set of projects to the console
 * @param {*} projects
 * @param {*} headers
 */
function showProjects(headers, projects) {
    formatProjects(headers, projects, {
        id: true,
        access: true,
        name: true,
        admins: true,
        members: true,
        guests: true,
        desc: true
    })
    .then(console.log)
    .catch(console.error);
}

/**
 * Format project information
 * @param {project[]} data
 * @param {Object} whatToShow
 * @returns {Promise<string>}
 */
function formatProjects(headers, data, whatToShow) {
    return new Promise(async (resolve, reject) => {
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

            if (whatToShow.all || whatToShow.id) info.push("Id: " + project._id);
            if (whatToShow.all || whatToShow.name) info.push("Name: " + project.name);
            if (whatToShow.all || whatToShow.admins) info.push("Admins: " + formattedAdmins.join(', '));
            if (whatToShow.all || whatToShow.members) info.push("Members: " + formattedMembers.join(', '));
            if (whatToShow.all || whatToShow.guests) info.push("Guests: " + formattedGuests.join(', '));
            if (whatToShow.all || whatToShow.access) info.push("Access: " + formattedAccess);
            if (whatToShow.all || whatToShow.desc) info.push("Description: " + project.desc);

            return info.join('\n');
        });
        
        resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
        resolve(resultArray.join('\n\n'));
    });
}
