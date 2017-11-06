#!/usr/bin/env node

const request = require('request');
const argv = require('minimist')(process.argv.slice(2));
const config = require('./config');
const fs = require('fs');
const async = require('async');
const spawn = require('child_process').spawn;
const WebSocketClient = require('websocket').client;
const jsonwebtoken = require('jsonwebtoken');
const tar = require('tar');

if(!argv.id) throw new Error("id missing");

//check if user is logged in
fs.stat(config.path.jwt, (err, stat)=>{
    if(err) {
        console.log("not logged in?");
        process.exit(1);
    }
    var jwt = fs.readFileSync(config.path.jwt);
    var user = jsonwebtoken.decode(jwt);
    if(!user) throw new Error("couldn't decode jwt");
    //console.dir(user);
    var headers = { "Authorization": "Bearer "+jwt };

    fs.mkdir(argv.id, err=>{

        request.get({url: config.api.warehouse+"/dataset/download/"+argv.id, headers: headers})
        /*
        .on('error', err=>{
            throw err;
        })
        */
        .on('response', res=>{
            if(res.statusCode != 200) {
                console.dir(res);
                throw new Error(res.statusMessage);
            }
        })
        //.pipe(fs.createWriteStream('data.tar'))
        .pipe(
            tar.x({
                //strip: 1,
                C: argv.id,
            })
        )
    });
});


