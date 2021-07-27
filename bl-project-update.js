#!/usr/bin/env node

const commander = require('commander');
const axios = require('axios');
const fs = require('fs');
const config = require('./config');
const util = require('./util');

commander
    .option('--id <id>', 'project ID to update')
    .option('--desc <desc>', 'description to set')
    .option('--readme <filename.md>', 'file path for README.md')
    .option('--participants <participants.tsv>', 'load participants.tsv containing list of subjects and phenotype')
    .option('--participant_columns <participants.json>', 'load participants.json containing bids column definition')
    .option('-j, --json', 'output in json format')
    .parse(process.argv);

try {
    if(!commander.id) throw new Error("please specify project id to update");
} catch (err) {
    console.error(err.toString());
    process.exit(1);
}

util.loadJwt().then(jwt => {
    let headers = { Authorization: "Bearer " + jwt, };

    let body = {}
    if(commander.desc) body.desc = commander.desc;
    if(commander.readme) body.readme = fs.readFileSync(commander.readme, {encoding: 'utf8'});

    axios.put(config.api.warehouse+'/project/'+commander.id, body, {headers}).then(res=>{
        if(commander.json) console.dir(res.data); //updated project
        else console.log("updated - project");

        if(commander.participants || commander.participant_columns) {
            let pbody = {}
            if(commander.participants) {
                let tsv = fs.readFileSync(commander.participants, "utf8").trim().split("\n");
                pbody.subjects = util.parseParticipantTSV(tsv);
                console.dir(pbody.subjects);
            }
            if(commander.participant_columns) {
                let json = fs.readFileSync(commander.participant_columns, "utf8");
                pbody.columns = util.escape_dot(JSON.parse(json));
            }
            axios.put(config.api.warehouse+'/participant/'+commander.id, pbody, {headers}).then(res=>{
                if(commander.json) console.dir(res.data); //updated project
                else console.log("updated - participants record");
            }).catch(util.handleAxiosError);
        }

    }).catch(util.handleAxiosError);

});

