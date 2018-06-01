#!/usr/bin/env node

const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter projects by id')
    .option('-s, --search <search>', 'filter projects by name or description')
    .option('-a, --admin <admin>', 'filter project by admins in it')
    .option('-m, --member <members>', 'filter project by members in it')
    .option('-g, --guest <guests>', 'filter project by guests in it')
    .option('--sk, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-r, --raw', 'output data in raw format (JSON)')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(async jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    
    let projects = await util.queryProjects(headers, commander.id, commander.search, commander.admin, commander.member, commander.guest, commander.skip, commander.limit);
    
    if (commander.raw) console.log(JSON.stringify(projects));
    else showProjects(headers, projects);
}).catch(console.error);

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
    return new Promise((resolve, reject) => {
        util.queryProfiles(headers)
        .then(profiles => {
            let profileTable = {};
            profiles.forEach(profile => profileTable[profile.id] = profile);

            let resultArray = data.map(d => {
                let info = [];
                let formattedAdmins = []; let formattedMembers = []; let formattedGuests = [];
                
                if (d.admins) formattedAdmins = d.admins.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
                if (d.members) formattedMembers = d.members.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
                if (d.guests) formattedGuests = d.guests.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
                
                let formattedAccess = "Access: " + d.access;
                if (d.listed) formattedAccess += " (but listed for all users)";

                if (whatToShow.all || whatToShow.id) info.push("Id: " + d._id);
                if (whatToShow.all || whatToShow.name) info.push("Name: " + d.name);
                if (whatToShow.all || whatToShow.admins) info.push("Admins: " + formattedAdmins.join(', '));
                if (whatToShow.all || whatToShow.members) info.push("Members: " + formattedMembers.join(', '));
                if (whatToShow.all || whatToShow.guests) info.push("Guests: " + formattedGuests.join(', '));
                if (whatToShow.all || whatToShow.access) info.push("Access: " + formattedAccess);
                if (whatToShow.all || whatToShow.desc) info.push("Description: " + d.desc);

                return info.join('\n');
            });
            
            resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
            resolve(resultArray.join('\n\n'));
        });
    });
}