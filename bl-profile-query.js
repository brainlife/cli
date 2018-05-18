#!/usr/bin/env node

const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
	.option('--search <search>', 'filter profiles by id, username, full name, or email address')
	.option('--raw', 'output data in raw format (JSON)')
	.parse(process.argv);

util.loadJwt().then(jwt => {
	let headers = { "Authorization": "Bearer " + jwt };
	let datatypeTable = {};

	util.queryProfiles(headers)
	.then(profiles => {
		profiles = util.filterProfiles(profiles, commander.search);
		if (commander.raw) console.log(JSON.stringify(profiles));
		else formatProfiles(headers, profiles, { all: true }).then(console.log);
	}).catch(console.error);
}).catch(console.error);

/**
 * Format dataset information
 * @param {profile[]} data
 * @param {Object} whatToShow
 * @returns {Promise<string>}
 */
function formatProfiles(headers, data, whatToShow) {
	return new Promise((resolve, reject) => {
		data = data.sort((a, b) => a.id > b.id);

		let resultArray = data.map(d => {
			let info = [];

			if (whatToShow.all || whatToShow.id) info.push("Id: " + d.id);
			if (whatToShow.all || whatToShow.username) info.push("Username: " + d.username);
			if (whatToShow.all || whatToShow.fullname) info.push("Full Name: " + d.fullname);
			if (whatToShow.all || whatToShow.email) info.push("Email: " + d.email);
			if (whatToShow.all || whatToShow.active) info.push("Active: " + d.active);

			return info.join('\n');
		});
		
		resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data));
		resolve(resultArray.join('\n\n'));
	});
}
