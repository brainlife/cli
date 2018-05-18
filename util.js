#!/usr/bin/env node

const request = require('request');
const config = require('./config');
const fs = require('fs');
const jsonwebtoken = require('jsonwebtoken');
const timeago = require('time-ago');
const async = require('async');
const tar = require('tar');
const spawn = require('child_process').spawn;
const terminalOverwrite = require('terminal-overwrite');
const prompt = require('prompt');

const delimiter = ',';

/** @module util.js */

/**
 * @typedef {Object} datatypeFile
 * @prop {string} id
 * @prop {string} filename
 * @prop {string} dirname
 * @prop {string} ext
 * @prop {boolean} required
 */

 /**
 * @typedef {Object} datatypeMeta
 * @prop {string} id
 * @prop {string} type
 * @prop {boolean} required
 */

/**
 * @typedef {Object} datatype
 * @prop {string} _id
 * @prop {string} name
 * @prop {string} desc
 * @prop {datatypeFile[]} files
 * @prop {datatypeMeta[]} meta
 */

/**
 * @typedef {Object} project
 * @prop {string} _id
 * @prop {string} name
 * @prop {string} desc
 * @prop {string} user_id
 * @prop {string} create_date
 * @prop {string} access
 * @prop {string[]} members
 * @prop {string[]} admins
 * @prop {boolean} removed
 * @prop {string[]} tags
 * @prop {string[]} guests
 * @prop {string} readme
 * @prop {string} license
 * @prop {boolean} listed
 */

/**
 * @typedef {Object} serviceStats
 * @prop {any} counts
 * @prop {number} counts.running
 * @prop {number} counts.waiting
 * @prop {number} counts.failed
 * @prop {number} counts.requested
 * @prop {number} users
 */

/**
 * @typedef {Object} appio
 * @prop {string} _id
 * @prop {string} id
 * @prop {string} datatype
 * @prop {string[]} datatype_tags
 * @prop {boolean} multi
 * @prop {boolean} optional
 */

/**
 * @typedef {Object} contributor
 * @prop {string} _id
 * @prop {string} name
 * @prop {string} email
 */

/**
 * @typedef {Object} app
 * @prop {string} _id
 * @prop {string} doi
 * @prop {{stars: number, service: serviceStats}} stats
 * @prop {string} user_id
 * @prop {string} create_date
 * @prop {string} name
 * @prop {string} desc
 * @prop {string} citation
 * @prop {string} github
 * @prop {string} github_branch
 * @prop {string[]} admins
 * @prop {contributor[]} contributors
 * @prop {string[]} projects
 * @prop {string[]} references
 * @prop {number} success_rate
 * @prop {string[]} tags
 * @prop {appio[]} inputs
 * @prop {appio[]} outputs
 * @prop {any} config
 */

/**
 * @typedef {Object} dataset
 * @prop {string} _id
 * @prop {string} user_id
 * @prop {string} project
 * @prop {string} datatype
 * @prop {string} name
 * @prop {string} desc
 * @prop {any} meta
 * @prop {string[]} tags
 * @prop {string[]} datatype_tags
 * @prop {string} storage
 * @prop {{subdir: string}} storage_config
 * @prop {boolean} removed
 * @prop {string} create_date
 */

 /**
  * @typedef {Object} profile
  * @prop {number} id
  * @prop {string} fullname
  * @prop {string} email
  * @prop {string} username
  * @prop {boolean} active
  */

/**
 * @typedef {Object} instance
 * @prop {string} _id
 * @prop {string} user_id
 * @prop {string} name
 * @prop {string} update_date
 * @prop {string} create_date
 * @prop {boolean} removed
 */

/**
 * @typedef {Object} task
 * @prop {string} _id
 * @prop {string} status_msg
 * @prop {string} request_date
 * @prop {string} status
 * @prop {string} progress_key
 * @prop {string} progress_key
 * @prop {string} user_id
 * @prop {string} preferred_resource_id
 * @prop {string} instance_id
 * @prop {string} service
 * @prop {string} name
 * @prop {string} create_date
 * @prop {string[]} resource_ids
 * @prop {number} run
 * @prop {string[]} deps
 * @prop {number} max_runtime
 * @prop {string} next_date
 * @prop {string[]} resource_deps
 * @prop {string} resource_id
 * @prop {any} _envs
 * @prop {string} start_date
 * @prop {string} finish_date
 * @prop {any[]} products
 */

/**
 * Common functions used across CLI scripts
 */

// fs.stat(config.path.jwt, (err, stat)=>{
//     if(err) {
//         console.log("not logged in?");
//         process.exit(1);
//     }
//     var jwt = fs.readFileSync(config.path.jwt);
//     var user = jsonwebtoken.decode(jwt);
//     var headers = { "Authorization": "Bearer "+jwt };

//     request.put({ url: config.api.warehouse + '/project/5afaf3a0ef96d50027ef368b?access=public', headers, json: true }, function(err, res, body) {
//         console.log(body);
//     });
// });

/**
 * Format dataset information
 * @name formatProfiles
 * @param {profile[]} data
 * @param {Object} whatToShow
 * @returns {Promise<string>}
 */
function formatProfiles(headers, data, whatToShow) {
	return new Promise((resolve, reject) => {
		data = data.sort((a, b) => a.id > b.id);

		let resultArray = data.map(d => {
			let info = [];

			if (whatToShow.all || whatToShow.id) info.push(`Id: ${d.id}`);
			if (whatToShow.all || whatToShow.username) info.push(`Username: ${d.username}`);
			if (whatToShow.all || whatToShow.fullname) info.push(`Full Name: ${d.fullname}`);
			if (whatToShow.all || whatToShow.email) info.push(`Email: ${d.email}`);
			if (whatToShow.all || whatToShow.active) info.push(`Active: ${d.active}`);

			return info.join('\n');
		});
		resultArray.push(`(Returned ${data.length} result${data.length == 1 ? '' : 's'})`);
		resolve(resultArray.join('\n\n'));
	});
}

/**
 * Filter profiles by user string
 * @param {profile[]} data
 * @param {string} queries
 */
function filterProfiles(data, queries) {
	let pattern = new RegExp((queries || '').split(delimiter).map(q => escapeRegExp(q.trim())).filter(q => q.length > 0).join('|'), 'ig');
	return data.filter(d => pattern.test(d.username) || pattern.test(d.fullname) || pattern.test(d.email));
}

/**
 * Format dataset information
 * @name formatDatasets
 * @param {dataset[]} data
 * @param {Object} whatToShow
 * @returns {Promise<string>}
 */
function formatDatasets(headers, data, whatToShow) {
	let projectTable = {}, datatypeTable = {};
	return new Promise((resolve, reject) => {
		queryProjects(headers)
		.then(projects => {
			projects.forEach(project => projectTable[project._id] = project);
			return queryDatatypes(headers);
		}).then(datatypes => {
			datatypes.forEach(datatype => datatypeTable[datatype._id] = datatype);
			let resultArray = data.map(d => {
				let info = [];
				let createDateObject = new Date(d.create_date);
				let formattedDate = `${createDateObject.toLocaleString()} (${timeago.ago(createDateObject)})`;
				let subject = d.meta && d.meta.subject ? d.meta.subject : 'N/A';
				let formattedProject = projectTable[d.project] ? projectTable[d.project].name : d.project;
				let formattedDatatype = datatypeTable[d.datatype] ? datatypeTable[d.datatype].name : d.datatype;
				let formattedDatatypeTags = d.datatype_tags.length == 0 ? '' : `<${d.datatype_tags.join(', ')}>`;

				if (whatToShow.all || whatToShow.id) info.push(`Id: ${d._id}`);
				if (whatToShow.all || whatToShow.project) info.push(`Project: ${formattedProject}`);
				if (whatToShow.all || whatToShow.subject) info.push(`Subject: ${subject}`);
				if (whatToShow.all || whatToShow.datatype) info.push(`Datatype: ${formattedDatatype}${formattedDatatypeTags}`);
				if (whatToShow.all || whatToShow.desc) info.push(`Description: ${d.desc||''}`);
				if (whatToShow.all || whatToShow.create_date) info.push(`Create Date: ${formattedDate}`);
				if (whatToShow.all || whatToShow.storage) info.push(`Storage: ${d.storage}`);
				if (whatToShow.all || whatToShow.status) info.push(`Status: ${d.status}`);
				// if (whatToShow.all || whatToShow.meta) info.push(`Meta: ${formattedMeta}`);

				return info.join('\n');
			});
			resultArray.push(`(Returned ${data.length} result${data.length == 1 ? '' : 's'})`);
			resolve(resultArray.join('\n\n'));

		}).catch(console.error);
	});
}

/**
 * Format app information
 * @name formatApps
 * @param {app[]} data
 * @param {any} whatToShow
 * @returns {Promise<string>}
 */
function formatApps(headers, data, whatToShow) {
	return new Promise((resolve, reject) => {
		queryDatatypes(headers)
		.then(datatypes => {
			let datatypeTable = {};

			datatypes.forEach(d => datatypeTable[d._id] = d);

			let resultArray = data.map(D => {
				let info = [];
				let formattedInputs = D.inputs.map(input => {
					let dtype = datatypeTable[input.datatype] ? datatypeTable[input.datatype].name : input.datatype;
					let tags = input.datatype_tags.length > 0 ? `<${input.datatype_tags.join(',')}>` : '';
					return `${dtype}${tags}${input.multi?'[]':''}${input.optional?'?':''}`;
				}).join(', ');

				let formattedOutputs = D.outputs.map(output => {
					let dtype = datatypeTable[output.datatype] ? datatypeTable[output.datatype].name : output.datatype;
					let tags = output.datatype_tags.length > 0 ? `<${output.datatype_tags.join(',')}>` : '';
					return `${dtype}${tags}${output.multi?'[]':''}${output.optional?'?':''}`;
				}).join(', ');

				if (whatToShow.all || whatToShow.id) info.push(`Id: ${D._id}`);
				if (whatToShow.all || whatToShow.name) info.push(`Name: ${D.name}`);
				if (whatToShow.all || whatToShow.datatypes) info.push(`Type: (${formattedInputs}) -> (${formattedOutputs})`);
				if (whatToShow.all || whatToShow.desc) info.push(`Description: ${D.desc}`);

				return info.join('\n');
			});
			resultArray.push(`(Returned ${data.length} result${data.length == 1 ? '' : 's'})`);
			resolve(resultArray.join('\n\n'));

		}).catch(console.error);
	});
}

/**
 * Format project information
 * @name formatProjects
 * @param {project[]} data
 * @param {Object} whatToShow
 * @returns {Promise<string>}
 */
function formatProjects(headers, data, whatToShow) {
	return new Promise((resolve, reject) => {
		queryProfiles(headers)
		.then(profiles => {
			let profileTable = {};
			profiles.forEach(profile => profileTable[profile.id] = profile);

			let resultArray = data.map(d => {
				let info = [];
				let formattedAdmins = d.admins.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
				let formattedMembers = d.members.map(s => profileTable[s] ? profileTable[s].username : 'unknown');
				let formattedGuests = d.guests.map(s => profileTable[s] ? profileTable[s].username : 'unknown');

				if (whatToShow.all || whatToShow.id) info.push(`Id: ${d._id}`);
				if (whatToShow.all || whatToShow.name) info.push(`Name: ${d.name}`);
				if (whatToShow.all || whatToShow.admins) info.push(`Admins: ${formattedAdmins.join(', ')}`);
				if (whatToShow.all || whatToShow.members) info.push(`Members: ${formattedMembers.join(', ')}`);
				if (whatToShow.all || whatToShow.guests) info.push(`Guests: ${formattedGuests.join(', ')}`);
				if (whatToShow.all || whatToShow.access) info.push(`Access: ${d.access}${d.listed?' (but listed for all users)':''}`);
				if (whatToShow.all || whatToShow.desc) info.push(`Description: ${d.desc}`);

				return info.join('\n');
			});
			resultArray.push(`(Returned ${data.length} result${data.length == 1 ? '' : 's'})`);
			resolve(resultArray.join('\n\n'));
		});
	});
}

/**
 * Format datatype information
 * @name formatDatatypes
 * @param {datatype[]} data
 * @param {{name: boolean, desc: boolean, files: boolean}} whatToShow
 * @returns {Promise<string>}
 */
function formatDatatypes(headers, data, whatToShow) {
	return new Promise((resolve, reject) => {
		let resultArray = data.map(d => {
			let info = [];
			let formattedFiles = d.files.map(file => {
				return `[${file.required?'(required) ':''}${file.id}: ${file.filename||file.dirname}]`;
			}).join('  ');

			if (whatToShow.all || whatToShow.id) info.push(`Id: ${d._id}`);
			if (whatToShow.all || whatToShow.name) info.push(`Name: ${d.name}`);
			if (whatToShow.all || whatToShow.desc) info.push(`Description: ${d.desc}`);
			if (whatToShow.all || whatToShow.files) info.push(`Files: ${formattedFiles}`);

			return info.join('\n');
		});

		resolve(resultArray.join('\n\n'));
	});
}

/**
 * @name queryProfiles
 * @desc Query the list of profiles
 * @param {string} search
 * @returns {Promise<profile[]>}
 */
function queryProfiles(headers, search) {
	return new Promise((resolve, reject) => {
		let searches = (search || '').split(delimiter);
		query(config.api.auth + '/profile', searches, searches,
			(ids, queries) => {
				let find = {}, orQueries = [], pattern = queries.join('|');
				if (ids.length > 0) orQueries.push({ _id: { $in: ids } });
				if (queries.length > 0) {
					orQueries.push({ username: { $regex: pattern, $options: 'ig' } });
					orQueries.push({ fullname: { $regex: pattern, $options: 'ig' } });
					orQueries.push({ email: { $regex: pattern, $options: 'ig' } });
				}
				if (orQueries.length > 0) find.$or = orQueries;

				return { find, sort: { username: 1 }, limit: 3000 };
			}, headers)
		.then((data, err) => {
			if (err) reject(err);
			else resolve(data.profiles);
		})
		.catch(console.error);
	});
}

/**
 * @name queryDatasets
 * @desc Query the list of datasets
 * @param {string} search
 * @param {string} datatypes
 * @returns {Promise<dataset[]>}
 */
function queryDatasets(headers, search, datatypes, projects, subject) {
	return new Promise((resolve, reject) => {
		let searches = (search || '').split(delimiter);
		let dtypeids;

		queryDatatypes(headers, datatypes)
		.then(dtypes => {
			dtypeids = dtypes.map(x => x._id);
			return queryProjects(headers, projects);
		})
		.then(prjcts => {
			let projectids = prjcts.map(x => x._id);
			query(config.api.warehouse + '/dataset', searches, searches,
				(ids, queries) => {
					let find = {}, orQueries = [], andQueries = [], pattern = queries.join('|');
					if (ids.length > 0) orQueries.push({ _id: { $in: ids } });
					if (queries.length > 0) {
						orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
						orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
					}

					if (Object.keys(dtypeids).length > 0) andQueries.push({ datatype: { $in: dtypeids } });
					if (Object.keys(projectids).length > 0) andQueries.push({ project: { $in: projectids } });
					if (subject) andQueries.push({ meta: { subject } });

					if (orQueries.length > 0) andQueries.push({ $or: orQueries });
					if (andQueries.length > 0) find.$and = andQueries;

					return { find, sort: { name: 1 } };
				}, headers)
			.then((data, err) => {
				if (err) reject(err);
				else resolve(data.datasets);
			}).catch(console.error);
		}).catch(console.error);
	});
}

/**
 * Download a dataset
 * @param {string} query
 * @param {any} headers
 */
function downloadDataset(headers, query) {
	queryDatasets(headers, query)
	.then(datasets => {
		if (datasets.length != 1) throw "Error: invalid dataset id given";
		let id = datasets[0]._id;
		console.log(`Streaming dataset to ${id}/`);

		fs.mkdir(id, err => {
			request.get({ url: config.api.warehouse+"/dataset/download/" + id, headers })
			.on('response', res => {
				if(res.statusCode != 200) throw `Error: ${res.body.message}`;
			}).pipe(tar.x({ C: id }));
		});
	});
}

/**
 * @name queryProjects
 * @desc Query the list of projects
 * @param {string} search
 * @param {string} authorSearch
 * @returns {Promise<project[]>}
 */
function queryProjects(headers, search, adminSearch, userSearch) {
	return new Promise((resolve, reject) => {
		let searches = (search || '').split(delimiter);
		let projectUserIds, projectAdminIds;
		
		queryProfiles(headers)
		.then(_profiles => {
			projectUserIds = filterProfiles(_profiles, userSearch).map(p => p.id);
			projectAdminIds = filterProfiles(_profiles, adminSearch).map(p => p.id);
			return query(config.api.warehouse + '/project', searches, searches,
			(ids, queries) => {
				let find = { removed: false }, orQueries = [], andQueries = [], pattern = queries.join('|');
				if (ids.length > 0) orQueries.push({ _id: { $in: ids } });
				if (queries.length > 0) {
					orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
					orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
				}
				
				if (projectAdminIds.length > 0) andQueries.push({ admins: { $elemMatch: { $in: projectAdminIds } } });
				if (projectUserIds.length > 0) {
					let subOr = [];
					subOr.push({ admins: { $elemMatch: { $in: projectUserIds } } });
					subOr.push({ members: { $elemMatch: { $in: projectUserIds } } });
					subOr.push({ guests: { $elemMatch: { $in: projectUserIds } } });
					andQueries.push({ $or: subOr });
				}
				
				if (orQueries.length > 0) andQueries.push({ $or: orQueries });
				if (andQueries.length > 0) find.$and = andQueries;
				
				return { find, sort: { access: 1 } };
			}, headers);
		})
		.then((data, err) => {
			if (err) reject(err);
			else resolve(data.projects);
		})
		.catch(console.error);
	});
}

/**
 * @name queryApps
 * @desc Query the list of apps
 * @param {string} search
 * @param {string} inputs
 * @param {string} outputs
 * @returns {Promise<app[]>}
 */
function queryApps(headers, search, inputs, outputs) {
	return new Promise((resolve, reject) => {
		let vm = {};
		let searches = (search || '').split(delimiter);

		queryDatatypes(headers, inputs)
		.then(inputDatatypes => {
			vm.inputDatatypes = inputDatatypes.map(x => x._id);
			return queryDatatypes(headers, outputs);
		}).then(outputDatatypes => {
			vm.outputDatatypes = outputDatatypes.map(x => x._id);
			query(config.api.warehouse + '/app', searches, searches,
				(ids, queries) => {
					let find = {}, orQueries = [], andQueries = [], pattern = queries.join('|');
					if (ids.length > 0) orQueries.push({ _id: { $in: ids } });
					if (queries.length > 0) {
						orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
						orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
					}

					if (vm.inputDatatypes.length > 0) {
						andQueries.push({ inputs: { $elemMatch: { datatype: { $in: vm.inputDatatypes } } } });
					}
					if (vm.outputDatatypes.length > 0) {
						andQueries.push({ outputs: { $elemMatch: { datatype: { $in: vm.outputDatatypes } } }});
					}

					if (orQueries.length > 0) andQueries.push({ $or: orQueries });
					if (andQueries.length > 0) find.$and = andQueries;
					return { find, sort: { name: 1 } };
				}, headers)
			.then((data, err) => {
				if (err) reject(err);
				else resolve(data.apps);
			}).catch(console.error);
		}).catch(console.error);
	});
}

/**
 * @name queryDatatypes
 * @desc Query the list of datatypes
 * @param {string} search
 * @returns {Promise<datatype[]>}
 */
function queryDatatypes(headers, search) {
	return new Promise((resolve, reject) => {
		let searches = (search || '').split(delimiter);
		query(config.api.warehouse + '/datatype', searches, searches,
			(ids, queries) => {
				let find = {}, orQueries = [], pattern = queries.join('|');
				if (ids.length > 0) orQueries.push({ _id: { $in: ids } });
				if (queries.length > 0) {
					orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
					orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
				}
				if (orQueries.length > 0) find.$or = orQueries;
				return { find, sort: { name: 1 } };
			}, headers)
		.then((data, err) => {
			if (err) reject(err);
			else resolve(data.datatypes);
		}).catch(console.error);
	});
}

/**
 * @desc Query a url for information
 * @param {string} url
 * @param {string[]} ids
 * @param {string[]} queries
 * @param {(filteredIds: string[], filteredQueries: string[]) => {find: any, sort: any, select: string, limit: number, skip: number}} options
 * @param {any} headers
 * @returns {Promise<any>}
 */
function query(url, ids, queries, options, headers) {
	ids = ids.map(x=>x.trim()).filter(isValidObjectId);
	queries = queries.map(q => escapeRegExp(q.trim())).filter(q => q.length > 0);
	options = options(ids, queries);

	let params = Object.keys(options)
	.map(x => `${x}=${/find|sort/.test(x) ? JSON.stringify(options[x]) : options[x]}`)
	.join('&');

	return new Promise((resolve, reject)=>{
		request.get({url: `${url}${params?'?':''}${params}`, headers: headers, json: true}, function(err, res, body) {
			if (res.statusCode != 200) {
				throw `Error: ${res.body.message}`;
			}
			if(err) throw new Error(res);
			return resolve(body);
		});
	});
}

/**
 * @desc Update a project
 * @param {any} updates
 * @param {any} headers
 * @returns {Promise<project>}
 */
function updateProject(headers, id, updates) {
	let profileTable = [];
	return new Promise((resolve, reject) => {
		queryProfiles(headers)
		.then(profiles => {
			profiles.forEach(profile => profileTable[profile.username.trim()] = profileTable[profile.id] = profile);
			return queryProjects(headers, id);
		})
		.then(projects => {
			if (projects.length != 1) throw `Error: invalid project id`;

			if (updates.admins && updates.admins.trim().length > 0) {
				updates.admins = updates.admins.split(",").map(username => {
					username = username.trim();
					if (profileTable[username]) return profileTable[username].id;
					else throw `Error: no user found with username '${username}' when checking admins`;
				})
			}
			if (updates.members && updates.members.trim().length > 0) {
				updates.members = updates.members.split(",").map(username => {
					username = username.trim();
					if (profileTable[username]) return profileTable[username].id;
					else throw `Error: no user found with username '${username}' when checking members`;
				})
			}
			if (updates.guests && updates.guests.trim().length > 0) {
				username = username.trim();
				updates.guests = updates.guests.split(",").map(username => {
					if (profileTable[username]) return profileTable[username].id;
					else throw `Error: no user found with username '${username}' when checking guests`;
				})
			}

			let updateValues = toNonNullObject(updates);
			if (Object.keys(updateValues) == 0) throw `Error: no values to update project with`;

			request.put(`${config.api.warehouse}/project/${projects[0]._id}`, { json: updateValues, updateValues, headers: headers }, (err, res, body) => {
				resolve(body);
			});
		})
	});
}

/**
 * @desc Get an instance for a service
 * @param {any} headers
 * @param {string} instanceName
 * @param {project} project
 * @returns {Promise<instance>}
 */
function getInstance(headers, instanceName, options) {
	return new Promise((resolve, reject)=>{
		// get instance that might already exist
		var find = { name: instanceName };
		options = options || {};
		
		request.get({url: config.api.wf+"/instance?find="+JSON.stringify(find), headers: headers, json: true}, (err, res, body) => {
			if(err) return reject(err);
			if(res.statusCode != 200) return reject(res.statusCode);
			if(body.instances[0]) resolve(body.instances[0]);
			else {
				// need to create new instance
				let body = { name: instanceName, desc: options.desc };
				if (options.project) {
					body.config = { brainlife: true };
					body.group_id = options.project.group_id;
				}
				
				request.post({url: config.api.wf + "/instance", headers: headers, json: true, body,
				}, function(err, res, body) {
					if(err) return reject(err);
					resolve(body);
				});
			}
		});
	});
}

/**
 * @desc Get the best resource for a service
 * @param {any} headers
 * @param {string} service
 * @returns {Promise<string>}
 */
function getBestResource(headers, service) {
	return new Promise((resolve, reject)=>{
		request.get({url: `${config.api.wf}/resource/best?service=${service}`, headers: headers, json: true}, function(err, res, body) {
			if(err) return reject(err);
			if(res.statusCode != 200) return reject(res.statusCode);
			if(!body.resource) return reject(`Error: no resource found that runs service ${service}`);
			resolve(body.resource);
		});
	});
}

/**
 * @desc Run a Brain Life application
 * @param {any} headers
 * @param {string} appSearch
 * @param {string} inputSearch
 * @param {string} projectSearch
 */
function runApp(headers, appSearch, inputSearch, projectSearch) {
	let datatypes, inputs, app, instance, project;
	let datatypeTable = {};
	let app_inputs = [], app_outputs = [];
	let output_metadata = {};
	let instanceName;

	queryDatatypes(headers)
	.then(_datatypes => {
		datatypes = _datatypes;
		datatypes.forEach(d => datatypeTable[d._id] = d);
		return queryDatasets(headers, inputSearch);
	})
	.then(_inputs => {
		inputs = _inputs;

		return queryApps(headers, appSearch, inputSearch, '');
	})
	.then(_apps => {
		if (_apps.length == 0) throw `Error: No apps found matching ${appSearch}`;
		if (_apps.length > 1) throw `Error: Invalid ID '${appSearch}'`;
		app = _apps[0];
		instanceName = `cli.'${app.name}'.${generateHash()}`;
		
		return queryProjects(headers, projectSearch);
	})
	.then(_projects => {
		if (_projects.length == 0) throw `Error: No projects found matching ${projectSearch}`;
		if (_projects.length > 1) throw `Error: Invalid ID '${projectSearch}'`;
		project = _projects[0];

		return getInstance(headers, instanceName, { project, desc: `(CLI) ${app.name}` });
	})
	.then(instance => {
		let all_dataset_ids = inputs.map(x => x._id);
		let flattenedConfig = flattenConfig(app.config, []);
		let flattenedPrompt = {};
		Object.keys(flattenedConfig).forEach(key => {
			if (flattenedConfig[key].type != 'input') {
				flattenedPrompt[key] = {
					type: flattenedConfig[key].type,
					default: flattenedConfig[key].default,
					description: `${JSON.parse(key).join('->')} (${flattenedConfig[key].description||'null'}) (type: ${flattenedConfig[key].type})`
				};
			}
		});

		prompt.message = null;
		prompt.start();
		prompt.get({ properties: flattenedPrompt }, (err, values) => {
			if (err) throw err;

			request.get({ headers, url: `${config.api.warehouse}/dataset/token?ids=${JSON.stringify(all_dataset_ids)}`, json: true }, (err, res, body) => {
				if (err) throw err;

				let jwt = body.jwt;
				if (app.inputs.length != inputs.length) throw `Error: App expects ${app.inputs.length} inputs but ${inputs.length} was given`;

				let sorted_app_inputs = app.inputs.sort((a, b) => a._id > b._id);
				let sorted_user_inputs = inputs.sort((a, b) => a._id > b._id);

				// type validation
				sorted_user_inputs.forEach((input, idx) => {
					if (input.datatype != sorted_app_inputs[idx].datatype) {
						throw `Error: Input ${idx+1} (dataset id ${input._id}) has datatype ${datatypeTable[input.datatype].name} but expected ${datatypeTable[sorted_app_inputs[idx].datatype].name}`;
					}
					let sorted_app_dtags = sorted_app_inputs[idx].datatype_tags.sort((a,b) => a > b);
					let sorted_user_dtags = input.datatype_tags.sort((a,b) => a > b);
					
					// datatype tag validation, if you want to do that sort of thing
					
					// let invalid_dtags_error = `Error: Input ${idx+1} (dataset id ${input._id} with datatype ${datatypeTable[input.datatype].name}) has datatype tags [${input.datatype_tags.join(', ')}] but expected [${sorted_app_inputs[idx].datatype_tags.join(', ')}]`;

					// if (sorted_app_dtags.length != sorted_user_dtags.length) throw invalid_dtags_error;

					// sorted_user_dtags.forEach((dtag, idx) => {
					// 	if (dtag != sorted_app_dtags[idx]) throw invalid_dtags_error;
					// });
				});

				let downloads = [], productRawOutputs = [];
				let datatypeToAppInput = {};
				let inputTable = {};
				inputs.forEach(input => inputTable[input.datatype] = input);
				app.inputs.forEach(input => datatypeToAppInput[input.datatype] = input);

				app.inputs.forEach(input => {
					let user_input = inputTable[input.datatype];

					downloads.push({
						url: `${config.api.warehouse}/dataset/download/safe/${user_input._id}?at=${jwt}`,
						untar: 'auto',
						dir: user_input._id
					});

					let output = {
						id: input.id,
						subdir: user_input._id,
						dataset_id: user_input._id,
						task_id: user_input.task_id || user_input.prov.task_id,
						datatype: user_input.datatype,
						datatype_tags: user_input.datatype_tags,
						tags: user_input.tags,
						meta: user_input.meta,
						project: user_input.project
					};
					productRawOutputs.push(output);
					app_inputs.push(Object.assign({ keys: [ datatypeToAppInput[input.datatype].id ] }, output));

					for (var k in user_input.meta) {
						if (!output_metadata[k]) output_metadata[k] = user_input.meta[k];
					}
				});

				request.post({ headers, url: `${config.api.wf}/task`, json: true, body: {
					instance_id: instance._id,
					name: "Staging Dataset",
					service: "soichih/sca-product-raw",
					desc: "Staging Dataset",
					config: { download: downloads, _outputs: productRawOutputs, _tid: 0 }
				}}, (err, res, body) => {
					if (err) throw err;
					console.log("Data Staging Task Created, PROCESS: ");
					
					let task = body.task;
					waitForFinish(headers, task, 0, (err, task) => {
						if (err) throw message;
						let preparedConfig = expandFlattenedConfig(flattenedConfig, values, task, inputs, datatypeTable, app);
						
						// link task to app inputs
						app_inputs.forEach(input => input.task_id = task._id);
						
						app.outputs.forEach(output => {
							app_outputs.push({
								id: output.id,
								datatype: output.datatype,
								datatype_tags: output.datatype_tags,
								desc: output.id + " from "+ app.name,
								meta: output_metadata,
								files: output.files,
								archive: {
									project: project._id,
									desc: `${output.id} from ${app.name}`
								},
							});
						});
						
						Object.assign(preparedConfig, {
							_app: app._id,
							_tid: 1,
							_inputs: app_inputs,
							_outputs: app_outputs,
						});

						// console.log(JSON.stringify(preparedConfig));
						// prepare and run the app task
						
						request.post({ url: `${config.api.wf}/task`, headers, json: true, body: {
							instance_id: instance._id,
							name: instanceName,
							service: app.github,
							desc: `Running ${app.name}`,
							service_branch: app.github_branch,
							config: preparedConfig,
							deps: [ task._id ]
							
						}}, (err, res, body) => {
							if (err) throw err;
							if (res.statusCode != 200) throw `Error: ${res.body.message}`;

							let appTask = body.task;
							console.log(`${app.name} Task Created, PROCESS: `);

							waitForFinish(headers, appTask, 0, (err, appTask) => {
								if (err) throw err;
								console.log(`Data will be automatically archived to Project '${project.name}'`);
							});
						});
					});
				})
			});
		});
	}).catch(console.error);

	/**
	 * Flatten a tree config object into an object with depth 1
	 * @param {any} config
	 * @param {string[]} path
	 */
	function flattenConfig(config, path) {
		let result = {};
		if (config.type) result[JSON.stringify(path)] = JSON.parse(JSON.stringify(config));
		else {
			Object.keys(config).forEach(key => {
				let thisPath = path.map(x=>x);
				thisPath.push(key);

				Object.assign(result, flattenConfig(config[key], thisPath));
			});
		}

		return result;
	}

	/**
	 *
	 * @param {any} flattened
	 * @param {any} values
	 * @param {task} download_task
	 * @param {input[]} inputs
	 * @param {datatype[]} datatypeTable
	 * @param {app} app
	 */
	function expandFlattenedConfig(flattened, values, download_task, inputs, datatypeTable, app) {
		// app input -> datatype -> input
		let idToAppInputTable = {};
		let idToDatatype = {};
		let datatypeToUserInputTable = {};

		app.inputs.forEach(input => idToAppInputTable[input.id] = input);
		app.inputs.forEach(input => idToDatatype[input.id] = input.datatype);
		inputs.forEach(input => datatypeToUserInputTable[input.datatype] = input);
		let idToUserInput = id => datatypeToUserInputTable[idToDatatype[id]];
		let result = {}, flattenedCalculatedConfig = {};

		Object.keys(flattened).forEach(path => {
			if (flattened[path].type == 'input') {
				let userInput = idToUserInput(flattened[path].input_id);
				let appInput = idToAppInputTable[flattened[path].input_id];
				let dtype = datatypeTable[userInput.datatype];
				let idToFile = {};
				dtype.files.forEach(file => idToFile[file.id] = file);

				let inputDtypeFile = idToFile[flattened[path].file_id];
				
				// TODO support case of userInput.multi == true
				if (userInput.multi) throw `Error: Arrays not yet supported as input types`;
				flattenedCalculatedConfig[path] = `../${download_task._id}/${userInput._id}/${inputDtypeFile.filename||inputDtypeFile.dirname}`;
			}
			else flattenedCalculatedConfig[path] = values[path];
		});
		// this split up is required to maintain soft copying on recurring properties
		Object.keys(flattened).forEach(path => {
			var recurObj = result;
			var rightBefore = null, nextKey = '';
			JSON.parse(path).forEach(key => {
				if (!recurObj[key]) recurObj[key] = {};
				nextKey = key;
				rightBefore = recurObj;

				recurObj = recurObj[key];
			});
			// object references are almost like pointers
			rightBefore[nextKey] = flattenedCalculatedConfig[path];
		});
		// console.log(result);
		return result;
	}

	let gearFrames = ['', '.', '..', '...'];
	/**
	 *
	 * @param {any} headers
	 * @param {task} task
	 * @param {(error: string, task: task) => any} cb
	 */
	function waitForFinish(headers, task, gear, cb) {
		var find = {_id: task._id};

		request.get({ url: `${config.api.wf}/task?find=${JSON.stringify({_id: task._id})}`, headers, json: true}, (err, res, body) => {
			if(err) return cb(err, null);
			if (res.statusCode != 200) throw `Error: ${res.body.message}`;

			let task = body.tasks[0];

			if (task.status == "finished") {
				terminalOverwrite.clear();
				terminalOverwrite(`STATUS: Successfully finished\n(${timeago.ago(new Date(task.finish_date))})`);
				terminalOverwrite.done();
				return cb(null, task);
			}
			if (task.status == "failed") {
				terminalOverwrite.clear();
				terminalOverwrite(`STATUS: failed`);
				terminalOverwrite.done();
				return cb(`Error: ${task.status_msg}`, null);
			}
			terminalOverwrite.clear();
			terminalOverwrite(`STATUS: ${task.status_msg}${gearFrames[gear]}\n(running since ${timeago.ago(new Date(task.create_date))})`);

			setTimeout(function() {
				waitForFinish(headers, task, (gear + 1) % gearFrames.length, cb);
			}, 1000);
		});
	}
}

/**
 * @desc Upload a dataset
 * @param {any} headers
 * @param {string} datatypeSearch
 * @param {string} projectSearch
 * @param {{directory: string, description: string, datatype_tags: string, subject: string, session: string}} options
 * @returns {Promise<string>}
 */
function uploadDataset(headers, datatypeSearch, projectSearch, options) {
	return new Promise((resolve, reject) => {
		let instance, resource, datatypes;
		let instanceName = 'warehouse-cli.upload';
		let noopService = 'soichih/sca-service-noop';

		options = options || {};
		let directory = options.directory || '.';
		let description = options.description || '';
		let datatype_tags = (options.datatype_tags || '').split(',').map(x => x.trim()).filter(x => x.length > 0);
		let tags = (options.tags || '').split(',').map(x => x.trim()).filter(x => x.length > 0);

		let metadata = {};
		if (options.meta) metadata = JSON.parse(fs.readFileSync(options.meta, 'ascii'));
		if (options.subject) metadata.subject = options.subject;
		if (options.session) metadata.session = options.session;

		getInstance(headers, instanceName)
		.then(_instance => {
			instance = _instance;
			return getBestResource(headers, noopService);
		}).then(_resource => {
			resource = _resource;
			return queryDatatypes(headers, datatypeSearch);
		}).then(_datatypes => {
			datatypes = _datatypes;
			if (datatypes.length == 0) throw "Error: Datatype not found";
			if (datatypes.length > 1) throw `Error: ${datatypes.length} possible results found matching datatype '${datatypeSearch}'`;
			return queryProjects(headers, projectSearch);
		}).then(projects => {
			if (projects.length == 0) throw "Error: Project not found";
			if (projects.length > 1) throw `Error: ${projects.length} possible results found matching project '${projectSearch}'`;

			let taropts = ['-czh'];

			let datatype = datatypes[0];
			let project = projects[0];

			async.forEach(datatype.files, (file, next_file)=>{
				console.log(`Looking for ${directory}/${(file.filename||file.dirname)}`);
				fs.stat(`${directory}/${file.filename}`, (err,stats)=>{
					if(err) {
						if (file.dirname) {
							fs.stat(`${directory}/${file.dirname}`, (err, stats) => {
								if (err) throw `Error: unable to stat ${directory}/${file.dirname} ... Does the directory exist?`;
								taropts.push(file.dirname);
								next_file();
							});
						} else {
							if(file.required) throw err;
							else {
								console.log(`Couldn't find ${(file.filename||file.dirname)} but it's not required for this datatype`);
								next_file();
							}
						}
					} else {
						taropts.push(file.filename);
						next_file();
					}
				});
			}, err => {
				if(err) throw err;

				//submit noop to upload data
				//warehouse dataset post api need a real task to submit from
				request.post({ url: `${config.api.wf}/task`, headers, json: true, body: {
					instance_id: instance._id,
					name: instanceName,
					service: noopService,
				}},
				(err, res, body) => {
					if(err) throw `Error: ${res.body.message}`;
					let task = body.task;

					console.log("Waiting for upload task to be ready...");
					waitForFinish(headers, task, function(err) {
						if(err) throw err;

						console.log("Starting upload");

						let req = request.post({url: `${config.api.wf}/task/upload/${task._id}?p=upload.tar.gz&untar=true`, headers: headers});
						let tar = spawn('tar', taropts, { cwd: directory });
						tar.stdout.pipe(req);

						req.on('response', res => {
							if(res.statusCode != "200") throw `Error: ${res.body.message}`;
							console.log("Dataset successfully uploaded!");
							console.log("Now registering dataset...");

							request.post({url: config.api.warehouse + '/dataset', json: true, headers: headers, body: {
								project: project._id,
								desc: description,
								datatype: datatype._id,
								datatype_tags,
								tags: tags,

								meta: metadata,

								instance_id: instance._id,
								task_id: task._id, // we archive data from copy task
								output_id: "output",    // sca-service-noop isn't BL app so we just have to come up with a name
							}}, (err, res, body) => {
								if(err) throw err;
								if(res.statusCode != "200") throw `Failed to upload: ${res.body.message}`;
								console.log("Finished dataset registration!");
								resolve(body);
							});
						});
					});
				});
			});
		}).catch(console.error);

		// TODO use event subscription instead
		function waitForFinish(headers, task, cb) {
			var find = {_id: task._id};
			request.get({ url: `${config.api.wf}/task?find=${JSON.stringify({_id: task._id})}`, headers, json: true}, (err, res, body) => {
				if(err) return cb(err);
				if (res.statusCode != 200) throw `Error: ${res.body.message}`;

				terminalOverwrite.clear();

				if(body.tasks[0].status == "finished") return cb();
				if(body.tasks[0].status == "failed") return cb(body.tasks[0].status_msg);

				process.stdout.write(".");
				setTimeout(function() {
					waitForFinish(headers, task, cb);
				}, 1000);
			});
		}
	});
}

/**
 * @desc Converts object with maybe null entries to an object with all nonnull values
 * @param {any} o
 * @returns {any}
 */
function toNonNullObject(o) {
	let result = {};
	Object.keys(o).forEach(k => {
		if (o[k] && (typeof o[k] != 'string' || o[k].trim().length > 0)) result[k] = o[k];
	});
	return result;
}

/**
 * @desc Converts object with maybe null entries to a Uri with nonnull objects
 * @param {any} o
 * @returns {string}
 */
function toNonNullUri(o) {
	let uri = [];
	Object.keys(o).forEach(k => {
		if (o[k] && o[k].trim().length > 0) uri.push(`${encodeURIComponent(k)}=${encodeURIComponent(o[k])}`);
	});

	let result = uri.join('&');
	return result.length > 0 ? '?' + result : result;
}

/**
 * @desc Escapes a user input string to make it safe for regex matching
 * @param {string} str
 */
function escapeRegExp(str) {
	return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

/**
 * @desc Returns whether or not a given string is a valid object ID
 * @param {string} str
 */
function isValidObjectId(str) {
	return /^[a-f\d]{24}$/i.test(str);
}

function foldr(step, base, list) {
	let result = base;
	for (let i = list.length - 1; i >= 0; i--) result = step(list[i], result);
	return result;
}

function generateHash(size) {
	let result = "";
	size = size || 32;
	for (let i = 0; i < size; i++) result = result + ("qwertyuiopasdfghjklzxcvbnm1234567890")[Math.floor(Math.random() * 36)];
	return result;
}

module.exports = {
	queryDatatypes, queryApps, queryProfiles, queryProjects, queryDatasets,
	updateProject,
	filterProfiles,
	downloadDataset, uploadDataset,
	runApp,
	formatDatatypes, formatProjects, formatApps, formatDatasets, formatProfiles
};