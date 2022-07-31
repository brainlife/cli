#!/usr/bin/env node

const commander = require('commander');
const pkg = require('./package');
/*
const axios = require('axios');

async function checkVersion() {
    const masterPkg = await axios.get("https://raw.githubusercontent.com/brainlife/cli/master/package.json");
    const masterVersion = masterPkg.data.version;
}
checkVersion();
*/

console.log(pkg.version);
