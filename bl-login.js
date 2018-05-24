#!/usr/bin/env node

const fs = require('fs');
const commander = require('commander');
const request = require('request');
const mkdirp = require('mkdirp');
const path = require('path');
const prompt = require('prompt');
const colors = require('colors/safe');
const jwt = require('jsonwebtoken');
const timediff = require('datetime-difference');
const config = require('./config');
const util = require('./util');

commander
    .option('ldap', 'login using ldap')
    .option('--username <username>', 'your username')
    .option('--ttl <time to live>', 'set the amount of days before your token expires (default: 1)', 1)
    .parse(process.argv);


var schema = {
    properties: {
        password: {required: true, hidden: true},
    }
};
if (!commander.username) schema.properties.username = {required: true};

prompt.message = null;
prompt.start();
prompt.get(schema, function(err, results) {
    if(err) util.error(err);

    let url = config.api.auth;
    if(commander.ldap) url += "/ldap/auth";
    else url += "/local/auth";
    
    request.post({ url, json: true, body: {username: commander.username || results.username, password: results.password, ttl: 1000*60*60*24*(commander.ttl || 1)} }, (err, res, body) => {
        if(res.statusCode != 200) util.error("Error: " + res.body.message);

        //make sure .sca/keys directory exists
        let dirname = path.dirname(config.path.jwt);
        mkdirp(dirname, function (err) {
            if (err) util.error(err);

            fs.chmodSync(dirname, '700');
            fs.writeFileSync(config.path.jwt, body.jwt);
            fs.chmodSync(config.path.jwt, '600');
            let token = jwt.decode(body.jwt);
            let ttl = timediff(new Date(token.exp*1000), new Date());
            let formattedTime = Object.keys(ttl).map(units => {
                let time = ttl[units];
                if (time == 0 || units == 'milliseconds') return '';
                return time + " " + units;
            }).filter(t => t.trim().length > 0).join(", ");
            
            console.log("Successfully logged in!");
            console.log("Your jwt token will last for " + formattedTime);
        });
    });
});
