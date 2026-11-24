#!/usr/bin/env node

const axios = require('axios');
const config = require('./config');
const commander = require('commander');
const util = require('./util');
const jsonwebtoken = require('jsonwebtoken');

const bids_walker = require('./bids-walker');
const bids_upload = require('./bids-upload');

commander
    .usage('[options] (path to the root of bids directory - where you have dataset_description.json)')
    .option('-d, --directory <directory>', 'path to the root of bids directory')
    .option('-p, --project <projectid>', "project id to upload the data object to. if you don't specify, it will create a new project (authentication token will be refreshed)")
    .option('-t, --tag <tag>', 'add a tag to all uploaded data object', util.collect, [])
    .parse(process.argv);

if (commander.args.length > 0) commander.directory = commander.args[0];

try {
    if (!commander.directory) throw new Error("please specify BIDS root directory (-d)");
} catch(err) {
    console.error(err.toString());
    process.exit(1);
}

util.loadJwt().then(async jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    bids_walker.walk(commander.directory, async (err, bids)=>{
        if(err) throw err;

        let project;
        if(commander.project) {
            let projects = await util.queryProjects(headers, {id: commander.project, search: commander.project});
            if (projects.length == 0) throw new Error("project '" + commander.project + "' not found");
            if (projects.length > 1) throw new Error("multiple projects matching '");
            project = projects[0];
        }

        if(!project) {
            project = await createProject(bids);

            //I need to refresh project token as group id is stored in jwt token
            let token = jsonwebtoken.decode(jwt);
            let expDate = new Date(token.exp*1000);
            let now = new Date();
            let diff = expDate.getTime() - now.getTime();
            let ttl = Math.ceil(diff/(1000*3600*24));
            
            //console.dir(token);
            //console.log("expiration:", expDate);
            //console.log("diff:", diff);
            //console.log("using ttl", (diff/(1000*3600*24)));
            jwt = await util.refresh({ttl}, headers);
            headers = { "Authorization": "Bearer " + jwt };
            //token = jsonwebtoken.decode(jwt);
            //console.log(JSON.stringify(token, null, 4));
        }
        if(bids.participants || bids.participants_json) {
            await bids_upload.updateParticipants(headers, project, bids);
        }

        await bids_upload.uploadDatasets(headers, project, bids.datasets, {tags: commander.tag});
        console.log("BIDS data uploaded to https://"+config.host+"/project/"+project._id);
    });

    async function createProject(bids) {
        let body = {}
        body.name = bids.dataset_description.Name;
        body.desc = "created by bl bids upload";
        if(bids.README) body.readme = bids.README;
        let res = await axios.post(config.api.warehouse+'/project/', body, {headers});
        return res.data;
    }
}).catch(console.error);

