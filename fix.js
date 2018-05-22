#!/usr/bin/env node

const config = require('./config');
const commander = require('commander');
const request = require('request');
const util = require('./util');

util.loadJwt()
.then(jwt => {
    let headers = { 'Authorization': 'Bearer ' + jwt };
    putSession('5aff1441251f5200274d9cb2');

    function putSession(id) {
        request.put(config.api.warehouse + '/dataset/' + id, { headers, json: true, body: {
            meta: {
                subject: 12345,
                session: 1
            }
        } }, (err, res, body) => {
            if (err) throw err;
            console.log(res.body.meta);
        });
    }
}).catch(console.error);