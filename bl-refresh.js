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
    .option('--ttl <time to live>', 'set the amount of days before refreshed token expires (default: 1)', 1)
    .parse(process.argv);

let schema = { properties: {} };
if (!commander.username) schema.properties.username = {required: true};
schema.properties.password = { required: true, hidden: true };

util.loadJwt().then(async jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    await util.refresh({ttl: commander.ttl}, headers);
    /*
    try {
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
    */
});
