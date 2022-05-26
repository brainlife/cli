#!/usr/bin/env node

const fs = require('fs');
const commander = require('commander');
const request = require('request');
const colors = require('colors/safe');
const jwt = require('jsonwebtoken');
const timediff = require('datetime-difference');
const config = require('./config');
const util = require('./util');
const readlineSync = require('readline-sync');

commander
    .option('ldap', 'login using ldap')
    .option('--username <username>', 'your brainlife username (optional)')
    .option('--password <password>', 'your brainlife password (optional)')
    .option('--ttl <time to live>', 'set the amount of days before your token expires (default: 7)', 7)
    .parse(process.argv);

async function login() {
    let username = commander.username;
    if(!username) username = readlineSync.question("username: ");

    let password = commander.password;
    if(!password) password = readlineSync.question("password: ", {hideEchoBack: true});

    try {
        const _jwt = await util.login({
            ldap: commander.ldap,
            ttl: commander.ttl,
            username,
            password,
        });
        let token = jwt.decode(_jwt);
        let ttl = timediff(new Date(token.exp*1000), new Date());
        let formattedTime = Object.keys(ttl).map(units => {
            let time = ttl[units];
            if (time == 0 || units == 'milliseconds') return '';
            return time + " " + units;
        }).filter(t => t.trim().length > 0).join(", ");
        console.log("Successfully logged in for " + formattedTime);
    } catch (err) {
        console.error(err.toString());
    }

}

login();
