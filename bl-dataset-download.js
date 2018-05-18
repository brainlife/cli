#!/usr/bin/env node

const request = require('request');
const argv = require('minimist')(process.argv.slice(2));
const config = require('./config');
const fs = require('fs');
const async = require('async');
const spawn = require('child_process').spawn;
//const WebSocketClient = require('websocket').client;
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const chalk = require('chalk');
const util = require('./util');

commander
	.option('--id <id>', 'download a dataset with the given id')
	.parse(process.argv);

util.loadJwt().then(jwt => {
	let headers = { "Authorization": "Bearer " + jwt };
	util.downloadDataset(headers, commander.id);
}).catch(console.error);