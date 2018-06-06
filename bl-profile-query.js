#!/usr/bin/env node

const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter profiles by id')
    .option('-q, --query <query>', 'filter profiles by username, full name, or email address')
    .option('-r, --raw', 'output data in json format')
    .option('-j, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(async jwt => {
    commander.raw = commander.raw || commander.json;
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    let datatypeTable = {};
    
    try {
        let profiles = await util.queryProfiles(headers, {
            id: commander.id,
            search: commander.query
        });
        
        if (commander.raw) console.log(JSON.stringify(profiles));
        else formatProfiles(headers, profiles, { all: true }).then(console.log);
    } catch (err) {
        util.errorMaybeRaw(err, commander.raw);
    }
}).catch(err => {
    util.errorMaybeRaw(err, commander.raw);
});

/**
 * Format dataset information
 * @param {profile[]} data
 * @param {Object} whatToShow
 * @returns {Promise<string>}
 */
function formatProfiles(headers, data, whatToShow) {
    return new Promise((resolve, reject) => {
        data = data.sort((a, b) => a.id > b.id);

        let resultArray = data.map(profile => {
            let info = [];

            if (whatToShow.all || whatToShow.id) info.push("Id: " + profile.id);
            if (whatToShow.all || whatToShow.username) info.push("Username: " + profile.username);
            if (whatToShow.all || whatToShow.fullname) info.push("Full Name: " + profile.fullname);
            if (whatToShow.all || whatToShow.email) info.push("Email: " + profile.email);
            if (whatToShow.all || whatToShow.active) info.push("Active: " + profile.active);

            return info.join('\n');
        });
        
        resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
        resolve(resultArray.join('\n\n'));
    });
}
