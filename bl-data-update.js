#!/usr/bin/env node

const axios = require('axios');
const config = require('./config');
const commander = require('commander');
const util = require('./util');
const fs = require('fs');

commander
    .option('--id <id>', 'data ID to update')
    .option('--desc <desc>', 'description to set')
    .option('--subject <subject>', 'set subject name')
    .option('--session <session>', 'set session name')
    .option('--run <run>', 'set run name')
    .option('--add_tag <tag>', 'add object tags', util.collect, [])
    .option('--remove_tag <tag>', 'remove object tags', util.collect, [])
    .option('--add_dtag <tag>', 'add datatype tags (use with caution)', util.collect, [])
    .option('--remove_dtag <tag>', 'remove datatype tags (use with caution)', util.collect, [])
    .option('-m, --meta <metadata-filename>', 'file path for (sidecar).json containing metadata that you would like to set')
    .parse(process.argv);

try {
    if(!commander.id) throw new Error("please specify data id (--id) to update");
} catch (err) {
    console.error(err.toString());
    process.exit(1);
}

util.loadJwt().then(jwt => {

    //find the data to update
    axios.get(config.api.warehouse + '/dataset', { 
        headers: { 
            Authorization: "Bearer " + jwt,
        }, 
        params: {
            find: JSON.stringify({_id: commander.id }),
            limit: 1,
        } 
    }).then(async res=>{
        if(res.data.datasets.length != 1) throw new Error("failed to find the dataset");
        let dataset = res.data.datasets[0];
        let req = { 
            meta: dataset.meta, 
            tags: dataset.tags, 
            datatype_tags: dataset.datatype_tags
        };
        if(commander.desc) req.desc = commander.desc;
        if(commander.subject) req.meta.subject = commander.subject;
        if(commander.session) req.meta.session = commander.session;
        if(commander.run) req.meta.run = commander.run;
        if(commander.subject == "") delete req.meta.subject;
        if(commander.session == "") delete req.meta.session;
        if(commander.run == "") delete req.meta.run;

        if(commander.meta) {
            let sidecar = JSON.parse(fs.readFileSync(commander.meta, 'ascii')); //why ascii?
            Object.assign(req.meta, sidecar);
        }

        //data object tags
        commander.add_tag.forEach(tag=>{
            if(!tag) return;
            if(!req.tags.includes(tag)) req.tags.push(tag);
        });
        commander.remove_tag.forEach(tag=>{
            if(!tag) return;
            let pos = req.tags.indexOf(tag);
            if(~pos) req.tags.splice(pos, 1);
        });

        //datatype tags
        commander.add_dtag.forEach(tag=>{
            if(!tag) return;
            if(!req.datatype_tags.includes(tag)) req.datatype_tags.push(tag);
        });
        commander.remove_dtag.forEach(tag=>{
            if(!tag) return;
            let pos = req.datatype_tags.indexOf(tag);
            if(~pos) req.datatype_tags.splice(pos, 1);
        });

        axios.put(config.api.warehouse+'/dataset/'+commander.id, req, {
            json : true,
            headers: { 
                Authorization: "Bearer " + jwt,
            }, 
        });
    });
});

