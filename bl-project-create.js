#!/usr/bin/env node

const commander = require('commander');
const axios = require('axios');
const fs = require('fs');
const jsonwebtoken = require('jsonwebtoken');
const config = require('./config');
const util = require('./util');

// NOTE: `--name` collides with commander's own reserved `Command.prototype.name`
// (a method, not the parsed option). With the default storeOptionsAsProperties
// behavior, both `commander.name` AND `commander.opts().name` resolve to that
// inherited method (a truthy function) instead of the string the user typed --
// `!commander.opts().name` never throws, and `JSON.stringify()`ing it into a
// request body silently drops the function, so the project gets created with
// no name at all. storeOptionsAsProperties(false) must be called before
// .option() and makes opts() return a genuinely independent plain object.
commander.storeOptionsAsProperties(false);

commander
    .option('--name <name>', 'project name')
    .option('--desc <desc>', 'description to set')
    .option('--readme <filename.md>', 'file path for README.md')
    .option('-j, --json', 'output in json format')
    .parse(process.argv);

const opts = commander.opts();

try {
    if(!opts.name) throw new Error("please specify project name (--name)");
} catch (err) {
    console.error(err.toString());
    process.exit(1);
}

util.loadJwt().then(async jwt => {
    let headers = { Authorization: "Bearer " + jwt };

    let body = { name: opts.name };
    if(opts.desc) body.desc = opts.desc;
    if(opts.readme) body.readme = fs.readFileSync(opts.readme, {encoding: 'utf8'});

    axios.post(config.api.warehouse+'/project/', body, {headers}).then(async res=>{
        let project = res.data;

        // project creation adds the caller to a new group; the group_id is only
        // reflected in a freshly issued token, so refresh now (same as bl bids upload)
        // so the new project's group is usable immediately in later commands.
        let token = jsonwebtoken.decode(jwt);
        let expDate = new Date(token.exp*1000);
        let now = new Date();
        let diff = expDate.getTime() - now.getTime();
        let ttl = Math.ceil(diff/(1000*3600*24));
        await util.refresh({ttl}, headers);

        if(opts.json) console.log(JSON.stringify(project));
        else {
            console.log("created project: "+project._id);
            console.log("https://"+config.host+"/project/"+project._id);
            console.log("refreshed access token so the new project's group is usable immediately");
        }
    }).catch(util.handleAxiosError);
});
