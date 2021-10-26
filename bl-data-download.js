#!/usr/bin/env node

//const request = require('request-promise-native');
const request = require('request'); //deprecated by axios..
const axios = require('axios'); //deprecated by axios..
const config = require('./config');
const fs = require('fs');
const tar = require('tar');
const commander = require('commander');
const util = require('./util');
const terminalOverwrite = require('terminal-overwrite');
const size = require('window-size');

commander
    .option('-i, --id <id>', 'download a data object with the given id')
    .option('-d, --directory <directory>', 'directory to stream the downloaded data object to')
    .option('-j, --json', 'output info about downloaded data object in json format')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    if (commander.args.length > 0 && util.isValidObjectId(commander.args[0])) {
        commander.id = commander.id || commander.args[0];
        commander.args = commander.args.slice(1);
    }
    if (commander.args.length > 0) commander.directory = commander.directory || commander.args[0];
    downloadDataset(headers, commander.id, commander.directory, commander.json);
});

function downloadDataset(headers, id, dir, json) {
    dir = dir || id;
    if (!json) console.log("downloading data object to " + dir);

    //get dataset status first
    axios.get(config.api.warehouse+"/dataset", {
        headers, 
        params: {
            find: JSON.stringify({ _id: id }),
        }
    }).then(res=>{
        if(res.status != "200") {
            console.error("failed to find data object");
            console.dir(res.data);
            process.exit(1);
        }
        if(res.data.datasets.length != 1) {
            console.error("couldn't find the data object with id", id);
            process.exit(1);
        }
        if(res.data.datasets[0].status != "stored") {
            console.error("data object status is not 'stored': "+res.data.datasets[0].status);
            process.exit(1);
        }

        //proceed with downloading
        let contentLength = Infinity, loaded = 0;
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

        let progress_int = setInterval(showProgress, 200);
        showProgress(0);
        fs.mkdir(dir, err => {
            //don't use callback for get(). it will buffer all output and it will run out of buffer (2G max)
            request.get({ url: config.api.warehouse + "/dataset/download/" + id, headers, encoding: null })
            .on('error', err=>{
                throw err;
            })
            .on('response', res=>{
                if(res.statusCode != 200) {
                    //res.body is always undefined because we are pipling it to tar..
                    console.error("failed to download");
                    process.exit(1);

                    //so to grab the real error message, let's just call the API again
                    axios.get(config.api.warehouse+"/dataset/download/"+id, {headers}).then(res=>{
                        console.log("Failed to download data object");
                        console.dir(res.toJSON());
                        process.exit(1);
                    });
                }
                contentLength = parseInt(res.headers['content-length']);
            })
            .on('data', chunk => {
                loaded += chunk.length;
            })
            .on('end', () => {
                if (process.stdout.isTTY) terminalOverwrite.done();
                clearInterval(progress_int);
            }).pipe(tar.x({ C: dir }));
        });
    }).catch(res=>{
        console.error("response:", res.response.data.message);
        process.exit(1);
    });
}
