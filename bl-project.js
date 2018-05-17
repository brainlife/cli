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
const prompt = require('prompt');
const chalk = require('chalk');
const util = require('./util');

commander
	.option('query <query>', 'run a query against all projects')
	.option('update <projectid>', '(experimental) update a project with the given projectid')
	.option('raw', 'output data in raw format (JSON)')
	.parse(process.argv);

fs.stat(config.path.jwt, (err, stat)=>{
	if(err) {
		console.log("not logged in?");
		process.exit(1);
	}
	var jwt = fs.readFileSync(config.path.jwt);
	var user = jsonwebtoken.decode(jwt);
	var headers = { "Authorization": "Bearer "+jwt };

	if (commander.query) {
		util.queryProjects(headers, commander.query)
		.then(projects => {
			if (commander.raw) console.log(JSON.stringify(projects));
			else showProjects(headers, projects);
		}).catch(console.error);
	}
	else if (commander.update) {
		console.log('\n(to avoid updating a field, leave it blank)');
		prompt.message = null;
		prompt.start();
		prompt.get({ properties: {
			access: { pattern: /public|private/, message: 'access must be public or private', required: false },
			name: { description: 'name (like "Test Name")', required: false },
			desc: { description: 'description (like "some test description")', required: false },
			admins: { description: 'admins (like "username1, username2, ...")', required: false },
			members: { description: 'members (like "username1, username2, ...")', required: false },
			guests: { description: 'guests (like "username1, username2, ...")', required: false }
		}}, function(err, results) {
			util.updateProject(headers, commander.update, results)
			.then(project => {
				if (commander.raw) console.log(JSON.stringify(project));
				else showProjects(headers, [project]);
			}).catch(console.error);
		});
	}
	else commander.outputHelp();
});

/**
 * Output a set of projects to the console
 * @param {*} projects
 * @param {*} headers
 */
function showProjects(headers, projects) {
	util.formatProjects(headers, projects, {
		id: true,
		access: true,
		name: true,
		admins: true,
		members: true,
		guests: true,
		desc: true
	})
	.then(console.log)
	.catch(console.error);
}