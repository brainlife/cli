#!/usr/bin/env node

const fs = require('fs');
const request = require('request');
const mkdirp = require('mkdirp');
const path = require('path');
const prompt = require('prompt');
const colors = require('colors/safe');
const jwt = require('jsonwebtoken');
const program = require('commander');

const pkg = require('./package');
const config = require('./config');

console.dir(process.argv);

program
  .version(pkg.version)
  .command('rerun', 'rerun task')
  .command('stop', 'stop a task')
  .command('list', 'list tasks')
  .parse(process.argv);

/*
function dorequest() {
    var url = config.api.auth;
    if(commander.l) url+="/ldap/auth";
    else url+="/local/auth";

    request.post({
        url: url,
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
            console.dir(token);
        });
    });
}
*/
