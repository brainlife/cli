#!/usr/bin/env node

const request = require('request-promise-native');
const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter publication by id')
    .option('-q, --query <query>', 'filter publication by name or description')
    .option('-a, --author <admin>', 'filter publication by a given author')
    .option('-d, --doi <doi>', 'filter publication by a given doi')
    .option('-s, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-j, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    
    util.queryPubs(headers, {
        id: commander.id,
        search: commander.query,
        author: commander.author,
        doi: commander.doi,
    }, {
        skip: commander.skip,
        limit: commander.limit
    }).then(async pubs=>{
        if (commander.json) console.log(JSON.stringify(pubs));
        else console.log(await formatPubs(headers, pubs));
    }).catch(err=>{
        console.error(err);
    });
});

async function formatPubs(headers, data) {
    let profiles = await util.queryAllProfiles(headers);
    let profileTable = {};
    profiles.forEach(profile => profileTable[profile.id] = profile);

    let resultArray = data.map(pub => {
        if(!pub.releases) return; //old thing?
        let info = [];
        let formattedAdmins = [];
        let formattedMembers = [];
        let formattedGuests = [];
        
        formattedAuthors = pub.authors.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
        formattedReleases = pub.releases.filter(r=>r.removed == false).map(r=>r.name+" ("+r._id+")");
        
        info.push("Id: " + pub._id);
        info.push("Name: " + pub.name);
        info.push("DOI: " + pub.doi);
        info.push("Description: " + pub.desc);
        info.push("Authors: " + formattedAuthors.join(', '));
        info.push("Release IDs: " + formattedReleases.join(', '));
        return info.join('\n');
    });
    
    resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
    return resultArray.join('\n\n');
}
