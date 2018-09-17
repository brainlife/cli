#!/usr/bin/env node

const fs = require('fs');
const commander = require('commander');
const request = require('request');
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

let schema = { properties: {} };
if (!commander.username) schema.properties.username = {required: true};
schema.properties.password = { required: true, hidden: true };

prompt.message = null;
prompt.start();
prompt.get(schema, async function(err, results) {
    if(err) throw err;

    try {
        let rawJwt = await util.login({
            ldap: commander.ldap,
            ttl: commander.ttl,
            username: commander.username || results.username,
            password: results.password
        });
        
        let token = jwt.decode(rawJwt);
        let ttl = timediff(new Date(token.exp*1000), new Date());
        let formattedTime = Object.keys(ttl).map(units => {
            let time = ttl[units];
            if (time == 0 || units == 'milliseconds') return '';
            return time + " " + units;
        }).filter(t => t.trim().length > 0).join(", ");
        
        console.log("Successfully logged in for " + formattedTime);
    } catch (err) {
        console.error(err);
    }
});
