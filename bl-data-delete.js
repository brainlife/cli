#!/usr/bin/env node

const axios = require('axios');
const config = require('./config');
const fs = require('fs');
const commander = require('commander');
const util = require('./util');
const size = require('window-size');

commander
    .option('-i, --id <id>', 'data object id to remove')
    .option('-j, --json', 'output info in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    if (commander.args.length > 0 && util.isValidObjectId(commander.args[0])) {
        commander.id = commander.id || commander.args[0];
        commander.args = commander.args.slice(1);
    }

    axios.delete(config.api.warehouse+"/dataset/"+commander.id, {headers}).then(res=>{
        if(commander.json) console.dir(res.data);
        else console.log("successfully removed dataset");
    }).catch(err=>{
        if(commander.json) console.error(err.response.data);
        else console.error(err.response.data.message);
    });
});
