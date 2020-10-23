#!/usr/bin/env node

const request = require('request-promise-native');
const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('--id <id>', 'dataset ID to update')
    .option('--desc <desc>', 'description to set')
    .option('--subject <subject>', 'set subject name')
    .option('--session <session>', 'set session name')
    .option('--run <run>', 'set run name')
    .option('--add_tag <tag>', 'tag to add', util.collect, [])
    .option('--remove_tag <tag>', 'tag to remove', util.collect, [])
    .option('-h, --h')
    .parse(process.argv);

if(commander.h) return commander.help();

if(!commander.id) throw new Error("please specify dataset id to update");

util.loadJwt().then(jwt => {

    //find the dataset to update
    request(config.api.warehouse + '/dataset', { 
        json: true, 
        headers: { 
            Authorization: "Bearer " + jwt,
        }, 
        qs: {
            find: JSON.stringify({_id: commander.id }),
            limit: 1,
        } 
    }).then(body=>{
        if(body.datasets.length != 1) throw new Error("failed to find the dataset");
        let dataset = body.datasets[0];
        let req = { meta: dataset.meta, tags: dataset.tags };
        if(commander.desc) req.desc = commander.desc;
        if(commander.subject) req.meta.subject = commander.subject;
        if(commander.session) req.meta.session = commander.session;
        if(commander.run) req.meta.run = commander.run;
        if(commander.subject == "") delete req.meta.subject;
        if(commander.session == "") delete req.meta.session;
        if(commander.run == "") delete req.meta.run;
        commander.add_tag.forEach(tag=>{
            if(!tag) return;
            if(!req.tags.includes(tag)) req.tags.push(tag);
        });
        commander.remove_tag.forEach(tag=>{
            if(!tag) return;
            let pos = req.tags.indexOf(tag);
            if(~pos) req.tags.splice(pos, 1);
        });

        request.put(config.api.warehouse+'/dataset/'+commander.id, {
            json : true,
            headers: { 
                Authorization: "Bearer " + jwt,
            }, 
            body: req,
        });
    });
});

