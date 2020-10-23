#!/usr/bin/env node

//const request = require('request-promise-native');
const request = require('request');
const config = require('./config');
const fs = require('fs');
const tar = require('tar');
const commander = require('commander');
const util = require('./util');
const terminalOverwrite = require('terminal-overwrite');
const size = require('window-size');

commander
    .option('-i, --id <id>', 'download a dataset with the given id')
    .option('-d, --directory <directory>', 'directory to stream the downloaded dataset to')
    .option('-j, --json', 'output info about downloaded dataset in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    if (commander.args.length > 0 && util.isValidObjectId(commander.args[0])) {
        commander.id = commander.id || commander.args[0];
        commander.args = commander.args.slice(1);
    }
    if (commander.args.length > 0) commander.directory = commander.directory || commander.args[0];
    downloadDataset(headers, commander.id, commander.directory, commander.json);
});

function downloadDataset(headers, id, dir, json) {
    let contentLength = Infinity, loaded = 0;
    dir = dir || id;
    
    if (!json) console.log("Download dataset to " + dir);
    let progress_int = setInterval(showProgress, 200);
    showProgress(0);

    fs.mkdir(dir, err => {
        //don't use callback for get(). it will buffer all output and it will run out of buffer (2G max)
        request.get({ url: config.api.warehouse + "/dataset/download/" + id, headers, encoding: null })
        .on('error', err=>{
            throw err;
        })
        .on('response', res=>{
            contentLength = parseInt(res.headers['content-length']);
            //console.dir(res.headers);
            if(res.statusCode != 200) throw res.statusMessage;
        })
        .on('data', chunk => {
            loaded += chunk.length;
            //showProgress(loaded / contentLength);
            //console.log(loaded);
        })
        .on('end', () => {
            if (process.stdout.isTTY) terminalOverwrite.done();
            clearInterval(progress_int);
            //if (!json) console.log("Done!");
        }).pipe(tar.x({ C: dir }));
    });

    function showProgress() {
        if (process.stdout.isTTY && !json) {
            let percentage = loaded / contentLength;
            let progressBar = '', progressBarLength = size.width - 12;
            for (let i = 0; i < progressBarLength; i++) {
                if (i / progressBarLength > percentage) progressBar += ' ';
                else progressBar += '=';
            }
            if (!percentage) {
                terminalOverwrite('Waiting..');
            } else {
                terminalOverwrite(Math.round(percentage*100) + '% done [' + progressBar + ']');
            }
        }
    }
}
