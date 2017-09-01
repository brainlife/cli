#!/usr/bin/env node

const process = require('process');
const fs = require('fs');

const argv = require('minimist')(process.argv.slice(2));
switch(argv._[0]) {
case "login": require('./login'); break;
case "import": require('./import'); break;
case "export": require('./export'); break;
default:
    console.log(fs.readFileSync(__dirname+"/README.md", {encoding: "utf8"}));
}
