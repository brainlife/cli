#!/usr/bin/env node

const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('--search <search>', 'run a query against all projects')
    .option('--admin <admin>', 'filter project by admins in it')
    .option('--member <members>', 'filter project by admins in it')
    .option('--guest <guests>', 'filter project by admins in it')
    .option('--raw', 'output data in raw format (JSON)')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };

    util.queryProjects(headers, commander.query, commander.admin, commander.member, commander.guest)
    .then(projects => {
        if (commander.raw) console.log(JSON.stringify(projects));
        else showProjects(headers, projects);
    }).catch(console.error);
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
                let formattedAdmins = d.admins.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
                let formattedMembers = d.members.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
                let formattedGuests = d.guests.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
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