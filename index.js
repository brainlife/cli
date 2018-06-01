#!/usr/bin/env node

/**
 * brainlife npm module
 */

const request = require('request');
const mkdirp = require('mkdirp');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const config = require('./config');
const util = require('./util');

/**
 * login to brainlife
 * @param {string} username Your username
 * @param {string} password Your password
 * @returns {Promise<string>} JWT token
 */
exports.login = function (username, password) {
	return new Promise((resolve, reject) => {
		request.post({ url: config.api.auth + '/local/auth', json: true, body: { username, password } }, (err, res, body) => {
			if (res.statusCode != 200) reject(res);

			//make sure .sca/keys directory exists
			let dirname = path.dirname(config.path.jwt);
			mkdirp(dirname, function (err) {
				if (err) reject(err);

				fs.chmodSync(dirname, '700');
				fs.writeFileSync(config.path.jwt, body.jwt);
				fs.chmodSync(config.path.jwt, '600');
				resolve(body.jwt);
			});
		});
	});
}

/**
 * Run a Brain Life application
 * @param {any} headers
 * @param {string|string[]} appSearch
 * @param {string|string[]} projectSearch
 * @param {string|string[]} resourceSearch
 * @param {any} userInputs
 * @param {any} userConfig
 * @returns {Promise<task>} Task of the running application
 */
exports.runApp = function (headers, appSearch, projectSearch, resourceSearch, userInputs, userConfig) {
	let arrangedInputs = [];
	Object.keys(userInputs).forEach(key => {
		if (key.indexOf(':') != -1) util.error("Error: key '" + key + "' should not contain ':'");
		arrangedInputs.push(key + ':' + userInputs[key]);
	});
	if (typeof userConfig == 'object') userConfig = JSON.stringify(userConfig);
	
	return util.runApp(headers, appSearch, arrangedInputs, projectSearch, resourceSearch, userConfig, true);
}

/**
 * Query the list of profiles
 * @param {any} headers
 * @param {string|string[]} idSearch
 * @param {string|string[]} search
 * @param {number|string} skip
 * @param {number|string} limit
 * @returns {Promise<profile[]>} The list of profiles that match the given query
 */
exports.queryProfiles = util.queryProfiles;

/**
 * Query the list of resources
 * @param {string|string[]} idSearch
 * @param {string|string[]} search
 * @param {string|string[]} status
 * @param {string|string[]} service
 * @param {number|string} skip
 * @param {number|string} limit
 * @returns {Promise<resource[]>} The list of resources that match the given query
 */
exports.queryResources = util.queryResources;

/**
 * Query the list of datatypes
 * @param {string|string[]} idSearch
 * @param {string|string[]} search
 * @param {number|string} skip
 * @param {number|string} limit
 * @returns {Promise<datatype[]>} The list of datatypes that match the given query
 */
exports.queryDatatypes = util.queryDatatypes;

/**
 * Query the list of apps
 * @param {string|string[]} search
 * @param {string|string[]} inputs
 * @param {string|string[]} outputs
 * @param {number|string} skip
 * @param {number|string} limit
 * @returns {Promise<app[]>} The list of apps that match the given query
 */
exports.queryApps = util.queryApps;

/**
 * Query all projects
 * @param {any} headers
 * @param {string|string[]} idSearch
 * @param {string|string[]} search
 * @param {string|string[]} adminSearch
 * @param {string|string[]} memberSearch
 * @param {string|string[]} guestSearch
 * @param {number|string} skip
 * @param {number|string} limit
 * @returns {Promise<project[]>} The list of projects that match the given query
 */
exports.queryProjects = util.queryProjects;

/**
 * Query the list of datasets
 * @param {any} headers
 * @param {string|string[]} idSearch
 * @param {string|string[]} search
 * @param {string|string[]} admin
 * @param {string|string[]} datatype
 * @param {string[]} datatype_tags
 * @param {string|string[]} project
 * @param {string} subject
 * @param {number|string} skip
 * @param {number|string} limit
 * @returns {Promise<dataset[]>} The list of datasets that match the given query
 */
exports.queryDatasets = util.queryDatasets;

/**
 * Returns whether or not a given string is a valid object ID
 * @param {string} str
 * @returns {boolean}
 */
exports.isValidObjectId = util.isValidObjectId;

/**
 * Get an instance for a service
 * @param {any} headers
 * @param {string} instanceName
 * @param {project} project
 * @returns {Promise<instance>} Gets an available instance, or makes a new one
 */
exports.getInstance = util.getInstance;

/**
 * Wait for a running task to finish
 * @param {any} headers
 * @param {task} task
 * @param {(error: string, task: task) => any} cb
 */
exports.waitForFinish = util.waitForFinish;
