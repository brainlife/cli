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
let util = require('./util');

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

exports.queryProfiles = util.queryProfiles;
exports.queryResources = util.queryResources;
exports.queryDatatypes = util.queryDatatypes;
exports.queryApps = util.queryApps;
exports.queryProjects = util.queryProjects;
exports.queryDatasets = util.queryDatasets;
exports.runApp = util.runApp;
exports.waitForFinish = util.waitForFinish;