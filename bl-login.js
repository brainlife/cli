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
const util = require('./util');

commander
    .option('ldap', 'login using ldap')
    .parse(process.argv);

var schema = {
    properties: {
        username: {required: true},
        password: {required: true, hidden: true},
    }
};
prompt.message = null;
prompt.start();
prompt.get(schema, function(err, results) {
    if(err) util.error(err);

    let url = config.api.auth;
    if(commander.ldap) url += "/ldap/auth";
    else url += "/local/auth";

    request.post({ url, json: true, body: {username: results.username, password: results.password} }, (err, res, body) => {
        if(res.statusCode != 200) util.error("Error: " + res.body.message);

        //make sure .sca/keys directory exists
        let dirname = path.dirname(config.path.jwt);
        mkdirp(dirname, function (err) {
            if (err) util.error(err);

            fs.chmodSync(dirname, '700');
            fs.writeFileSync(config.path.jwt, body.jwt);
            fs.chmodSync(config.path.jwt, '600');
            let token = jwt.decode(body.jwt);
            console.log("Successfully logged in!");
        });
    });
});
