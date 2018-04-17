#!/usr/bin/env node

const fs = require('fs');
const commander = require('commander');
const request = require('request');
const mkdirp = require('mkdirp');
const path = require('path');
const prompt = require('prompt');
const colors = require('colors/safe');
const jwt = require('jsonwebtoken');
const config = require('./config');

commander
    .option('-u --username <username>', 'BrainLife username')
    .option('-p --password <password>', 'BrainLife password')
    .option('-l --ldap', 'use LDAP')
    .parse(process.argv);

var schema = {
    properties: {
        username: {required: true},
        password: {required: true, hidden: true},
    }
};
prompt.message = null;
prompt.override = commander;
prompt.start();
prompt.get(schema, function(err, results) {
    if(err) throw err; 
    for(var k in results) {
        commander[k] = results[k];
    }
    dorequest();
});

function dorequest() {
    var url = config.api.auth;
    if(commander.l) url+="/ldap/auth";
    else url+="/local/auth";

    console.log(url);
    request.post({
        url,
        json: true,
        body: {username: commander.username, password: commander.password}
    }, function(err, res, body) {
        if(err) throw err;
        if(res.statusCode != 200) return console.error(body);

        //make sure .sca/keys directory exists
        var dirname = path.dirname(config.path.jwt);
        mkdirp(dirname, function (err) {
            if (err) throw err;
            fs.chmodSync(dirname, '700');
            fs.writeFileSync(config.path.jwt, body.jwt);
            fs.chmodSync(config.path.jwt, '600');
            var token = jwt.decode(body.jwt);
            console.log("success!");
            console.error(token);
        });
    });
}


