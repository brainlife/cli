#!/usr/bin/env node

/**
 * Common functions used across CLI scripts
 */

'use strict';

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

const gearFrames = [
    '               ',
    ' e             ',
    ' fe            ',
    ' ife           ',
    ' Life          ',
    '  Life         ',
    ' n Life        ',
    ' in Life       ',
    ' ain Life      ',
    ' rain Life     ',
    ' Brain Life    ',
    '  Brain Life   ',
    '   Brain Life  ',
    '    Brain Life ',
    '     Brain Life',
    '      Brain Lif',
    '       Brain Li',
    '        Brain L',
    '         Brain ',
    '          Brain',
    '           Brai',
    '            Bra',
    '             Br',
    '              B',
];

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
 * @typedef {Object} resource
 * @prop {string} _id
 * @prop {string} resource_id
 * @prop {string} name
 * @prop {string} type
 * @prop {string} update_date
 * @prop {string} create_date
 * @prop {string[]} gids
 * @prop {boolean} active
 * @prop {string} status
 * @prop {string} status_msg
 * @prop {string} status_update
 * @prop {string} lastok_date
 * @prop {any} envs
 * @prop {Object} config
 * @prop {string} ssh_public
 * @prop {string} resources
 * @prop {string} hostname
 * @prop {string} username
 */


/**
 * Load the user's jwt token
 * @returns {Promise<string>}
 */
function loadJwt() {
    return new Promise((resolve, reject) => {
        fs.stat(config.path.jwt, (err, stat) => {
            if (err) {
                error("Error: Couldn't find your access token. Please try logging in by running 'bl login'");
                process.exit(1);
            }
            let jwt = fs.readFileSync(config.path.jwt);
            let dec = jsonwebtoken.decode(jwt);
            if(!dec) return reject("Failed to decode you access token. Please try logging in by running 'bl login'");
            if(dec.exp < Date.now()/1000) return reject("You access token is expired. Please try logging in by running 'bl login'.");
            
            resolve(jwt); 
        });
    });
}

/**
 * Query the list of profiles
 * @param {any} headers
 * @param {string|string[]} idSearch
 * @param {string|string[]} search
 * @param {number|string} skip
 * @param {number|string} limit
 * @returns {Promise<profile[]>}
 */
function queryProfiles(headers, idSearch, search, skip, limit) {
    return new Promise((resolve, reject) => {
        let find = {}, orQueries = [];

        request.get(config.api.auth + '/profile?limit=' + (limit || -1) + '&offset=' + (skip || 0), { headers, json: true }, (err, res, body) => {
            if (err) error(err);
            else if (res.statusCode != 200) error(res.body.message);
            else {
                let profiles = body.profiles;
                if (idSearch || search) profiles = profiles.filter(profile => {
                    let maybe = false;
                    if (Array.isArray(idSearch)) {
                        maybe = maybe || idSearch.indexOf(profile.id) != -1;
                    }

                    if (idSearch && idSearch.length > 0) maybe = maybe || idSearch == profile.id;
                    if (search && search.length > 0) {
                        let pattern;
                        if (Array.isArray(search)) pattern = new RegExp(search.map(escapeRegExp).join('|'), 'g');
                        else pattern = new RegExp(escapeRegExp(search), 'g');

                        maybe = maybe                           ||
                                pattern.test(profile.fullname)  ||
                                pattern.test(profile.email)     ||
                                pattern.test(profile.username);
                    }
                    return maybe;
                });

                resolve(profiles);
            }
        });
    });
}

/**
 * Flexibly match profiles
 * @param {any} headers
 * @param {string|string[]} match
 * @returns {Promise<profile[]>}
 */
function matchProfiles(headers, match) {
    let options = match;
    if (!Array.isArray(options)) options = (options || '').split(delimiter);
    options = options.map(opt => opt.trim()).filter(opt => opt.length > 0);

    let ids = options.filter(isValidObjectId);
    let queries = options.filter(o => !isValidObjectId(o));

    return queryProfiles(headers, ids, queries, "0", "-1");
}

/**
 * Query the list of datasets
 * @param {any} headers
 * @param {string|string[]} idSearch
 * @param {string|string[]} search
 * @param {string|string[]} admin
 * @param {string|string[]} datatype
 * @param {string|string[]} datatype_tags
 * @param {string|string[]} project
 * @param {string} subject
 * @param {string|number} skip
 * @param {string|number} limit
 * @returns {Promise<dataset[]>}
 */
function queryDatasets(headers, idSearch, search, admin, datatype, datatype_tags, project, subject, skip, limit, taskid) {
    return new Promise(async (resolve, reject) => {
        let datatypes = await matchDatatypes(headers, datatype);
        // strictly only match datatypes that exactly equal what the user typed in
        if (datatype && datatype.length > 0 && !isValidObjectId(datatype)) datatypes = datatypes.filter(d => d.name == datatype);
        
        let projects = await matchProjects(headers, project, admin);
        
        if (datatype && datatypes.length == 0) error("No datatypes found matching '" + datatype + "'");
        if (project && projects.length == 0) error("No projects found matching '" + project + "'");
        if (admin && projects.length == 0) error("No matching projects found with admin search '" + admin + "'");
        
        let projectIds = projects.map(p => p._id);
        let find = { removed: false }, andQueries = [], orQueries = [];
        
        if (idSearch && idSearch.length > 0) {
            if (Array.isArray(idSearch)) {
                idSearch.forEach(id => { if (!isValidObjectId(id)) error('Not a valid dataset id: ' + id); });
                orQueries.push({ _id: { $in: idSearch } });
            } else {
                if (!isValidObjectId(idSearch)) error('Not a valid dataset id: ' + idSearch);
                orQueries.push({ _id: idSearch });
            }
        }
        if (search && search.length > 0) {
            let pattern;
            if (Array.isArray(search)) pattern = search.map(s => escapeRegExp(s)).join('|');
            else pattern = escapeRegExp(search);

            orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
            orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
        }
        if (datatype_tags && datatype_tags.length > 0) {
            if (typeof datatype_tags == 'string') datatype_tags = [ datatype_tags ];
            datatype_tags.forEach(tag => {
                if (tag.startsWith("!")) andQueries.push({ datatype_tags: { $not: { $elemMatch: { $eq: tag.substring(1) } } } });
                else {
                    andQueries.push({ datatype_tags: { $elemMatch: { $eq: tag } } });
                }
            });
        }
        if (project && projects.length > 0) {
            andQueries.push({ project: { $in: projects.map(p => p._id) } });
        }
        if (datatype && datatypes.length > 0) {
            andQueries.push({ datatype: { $in: datatypes } })
        }
        if (subject) {
            andQueries.push({ "meta.subject": subject });
        }
        
        if (orQueries.length > 0) {
            andQueries.push({ $or: orQueries });
        }
        if (andQueries.length > 0) {
            find.$and = andQueries;
        }
        if (taskid && taskid.length > 0) {
            andQueries.push({ 'prov.task_id': taskid });
        }
        
        request.get(config.api.warehouse + '/dataset', { json: true, headers, qs: {
            find: JSON.stringify(find),
            skip: skip || 0,
            limit: limit || 100
        } }, (err, res, body) => {
            if (err) error(err);
            else if (res.statusCode != 200) error(res.body.message);
            else {
                body.datasets.count = body.count;
                resolve(body.datasets);
            }
        });
    });
}

/**
 * Flexibly match datasets
 * @param {any} headers
 * @param {string|string[]} match
 * @param {string|string[]} admin
 * @param {string|string[]} datatype
 * @param {string[]} datatype_tags
 * @param {string|string[]} project
 * @param {string} subject
 * @returns {Promise<dataset[]>}
 */
function matchDatasets(headers, match, admin, datatype, datatype_tags, project, subject) {
    let options = match;
    if (!Array.isArray(options)) options = (options || '').split(delimiter);
    options = options.map(opt => opt.trim()).filter(opt => opt.length > 0);

    let ids = options.filter(isValidObjectId);
    let queries = options.filter(o => !isValidObjectId(o));
    
    return queryDatasets(headers, ids, queries, admin, datatype, datatype_tags, project, subject, "0", "0");
}

/**
 * Query all projects
 * @param {any} headers
 * @param {string|string[]} idSearch
 * @param {string|string[]} search
 * @param {string|string[]} adminSearch
 * @param {string|string[]} memberSearch
 * @param {string|string[]} guestSearch
 * @param {string|number} skip
 * @param {string|number} limit
 * @returns {Promise<project[]>}
 */
function queryProjects(headers, idSearch, search, adminSearch, memberSearch, guestSearch, skip, limit) {
    return new Promise(async (resolve, reject) => {
        let projectAdminIds = (await matchProfiles(headers, adminSearch)).map(u => u.id);
        let projectMemberIds = (await matchProfiles(headers, memberSearch)).map(u => u.id);
        let projectGuestIds = (await matchProfiles(headers, guestSearch)).map(u => u.id);
        let find = { removed: false }, andQueries = [], orQueries = [];
        
        if (idSearch && idSearch.length > 0) {
            if (Array.isArray(idSearch)) {
                idSearch.forEach(id => { if (!isValidObjectId(id)) error('Not a valid project id: ' + id); });
                orQueries.push({ _id: { $in: idSearch } });
            } else {
                if (!isValidObjectId(idSearch)) error('Not a valid project id: ' + idSearch);
                orQueries.push({ _id: idSearch });
            }
        }
        if (search && search.length > 0) {
            let pattern;
            if (Array.isArray(search)) pattern = search.map(s => escapeRegExp(s)).join('|');
            else pattern = escapeRegExp(search);

            orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
            orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
        }
        if (adminSearch && projectAdminIds.length > 0) {
            andQueries.push({ admins: { $elemMatch: { $in: projectAdminIds } } });
        }
        if (memberSearch && projectMemberIds.length > 0) {
            andQueries.push({ members: { $elemMatch: { $in: projectMemberIds } } });
        }
        if (guestSearch && projectGuestIds.length > 0) {
            andQueries.push({ guests: { $elemMatch: { $in: projectGuestIds } } });
        }

        if (orQueries.length > 0) {
            andQueries.push({ $or: orQueries });
        }
        if (andQueries.length > 0) {
            find.$and = andQueries;
        }

        request.get(config.api.warehouse + '/project', { headers, json: true, qs: {
            find: JSON.stringify(find),
            sort: JSON.stringify({ name: 1 }),
            skip: skip || 0,
            limit: limit || 100
        } }, (err, res, body) => {
            if (err) error(err);
            else if (res.statusCode != 200) error(res.body.message);
            else resolve(body.projects);
        });
    });
}

/**
 * Flexibly match projects
 * @param {any} headers
 * @param {string|string[]} match
 * @param {string|string[]} admins
 * @param {string|string[]} members
 * @param {string|string[]} guests
 * @returns {Promise<project[]>}
 */
function matchProjects(headers, match, admins, members, guests) {
    let options = match;
    if (!Array.isArray(options)) options = (options || '').split(delimiter);
    options = options.map(opt => opt.trim()).filter(opt => opt.length > 0);

    let ids = options.filter(isValidObjectId);
    let queries = options.filter(o => !isValidObjectId(o));
    
    return queryProjects(headers, ids, queries, admins, members, guests, "0", "0");
}

/**
 * Query the list of apps
 * @param {string|string[]} search
 * @param {string|string[]} inputs
 * @param {string|string[]} outputs
 * @param {number|string} skip
 * @param {number|string} limit
 * @returns {Promise<app[]>}
 */
function queryApps(headers, idSearch, search, inputs, outputs, skip, limit) {
    return new Promise(async (resolve, reject) => {
        let inputDatatypes = (await matchDatatypes(headers, inputs)).map(d => d._id);
        let outputDatatypes = (await matchDatatypes(headers, outputs)).map(d => d._id);
        
        let find = { removed: false }, andQueries = [], orQueries = [];
        if (idSearch && idSearch.length > 0) {
            if (Array.isArray(idSearch)) {
                idSearch.forEach(id => { if (!isValidObjectId(id)) error('Not a valid app id: ' + id); });
                orQueries.push({ _id: { $in: idSearch } });
            } else {
                if (!isValidObjectId(idSearch)) error('Not a valid app id: ' + idSearch);
                orQueries.push({ _id: idSearch });
            }
        }
        if (search && search.length > 0) {
            let pattern;
            if (Array.isArray(search)) pattern = search.map(s => escapeRegExp(s)).join('|');
            else pattern = escapeRegExp(search);

            orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
            orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
        }
        
        if (inputs && inputs.length > 0) {
            andQueries = andQueries.concat(inputDatatypes.map(datatype => { return { inputs: { $elemMatch: { datatype } } }; }));
        }
        if (outputs && outputs.length > 0) {
            andQueries = andQueries.concat(outputDatatypes.map(datatype => { return { outputs: { $elemMatch: { datatype } } }; }));
        }

        if (orQueries.length > 0) {
            andQueries.push({ $or: orQueries });
        }
        if (andQueries.length > 0) {
            find.$and = andQueries;
        }

        request.get(config.api.warehouse + '/app', { headers, json: true, qs: {
            find: JSON.stringify(find),
            sort: JSON.stringify({ name: 1 }),
            skip: skip || 0,
            limit: limit || 100
        } }, (err, res, body) => {
            if (err) error(err);
            else if (res.statusCode != 200) error(res.body.message);
            else {
                resolve(body.apps);
            }
        });
    });
}

/**
 * Flexibly match apps
 * @param {any} headers
 * @param {string|string[]} match
 * @param {string|string[]} inputs
 * @param {string|string[]} outputs
 * @returns {Promise<app[]>}
 */
function matchApps(headers, match, inputs, outputs) {
    let options = match;
    if (!Array.isArray(options)) options = (options || '').split(delimiter);
    options = options.map(opt => opt.trim()).filter(opt => opt.length > 0);

    let ids = options.filter(isValidObjectId);
    let queries = options.filter(o => !isValidObjectId(o));

    return queryApps(headers, ids, queries, inputs, outputs, "0", "0");
}

/**
 * Query the list of datatypes
 * @param {string|string[]} idSearch
 * @param {string|string[]} search
 * @param {number|string} skip
 * @param {number|string} limit
 * @returns {Promise<datatype[]>}
 */
function queryDatatypes(headers, idSearch, search, skip, limit) {
    return new Promise((resolve, reject) => {
        let find = {}, orQueries = [];
        if (idSearch && idSearch.length > 0) {
            if (Array.isArray(idSearch)) {
                idSearch.forEach(id => { if (!isValidObjectId(id)) error('Not a datatype id: ' + id); });
                orQueries.push({ _id: { $in: idSearch } });
            } else {
                if (!isValidObjectId(idSearch)) error('Not a datatype id: ' + idSearch);
                orQueries.push({ _id: idSearch });
            }
        }
        if (search && search.length > 0) {
            let pattern;
            if (Array.isArray(search)) pattern = search.map(s => escapeRegExp(s)).join('|');
            else pattern = escapeRegExp(search);

            orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
            orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
        }
        if (orQueries.length > 0) {
            find.$or = orQueries;
        }

        request.get(config.api.warehouse + '/datatype', { headers, json: true, qs: {
            find: JSON.stringify(find),
            sort: JSON.stringify({ name: 1 }),
            limit, skip
        } }, (err, res, body) => {
            if (err) error(err);
            else if (res.statusCode != 200) error(res.body.message);
            else {
                resolve(body.datatypes);
            }
        });
    });
}

/**
 * Flexibly match datatypes
 * @param {any} headers
 * @param {string} match
 */
function matchDatatypes(headers, match) {
    let options = match;
    if (!Array.isArray(options)) options = (options || '').split(delimiter);
    options = options.map(opt => opt.trim()).filter(opt => opt.length > 0);

    let ids = options.filter(isValidObjectId);
    let queries = options.filter(o => !isValidObjectId(o));

    return queryDatatypes(headers, ids, queries, "0", "0");
}

/**
 * Query the list of resources
 * @param {string|string[]} idSearch
 * @param {string|string[]} search
 * @param {string} status
 * @param {string} service
 * @param {number|string} skip
 * @param {number|string} limit
 * @returns {Promise<resource[]>}
 */
function queryResources(headers, idSearch, search, status, service, skip, limit) {
    return new Promise(async (resolve, reject) => {
        let find = {}, orQueries = [], andQueries = [];
        if (idSearch && idSearch.length > 0) {
            if (Array.isArray(idSearch)) {
                idSearch.forEach(id => { if (!isValidObjectId(id)) error('Not a valid resource id: ' + id); });
                orQueries.push({ _id: { $in: idSearch } });
            } else {
                if (!isValidObjectId(idSearch)) error('Not a valid resource id: ' + idSearch);
                orQueries.push({ _id: idSearch });
            }
        }
        if (search && search.length > 0) {
            let pattern;
            if (Array.isArray(search)) pattern = search.map(s => escapeRegExp(s)).join('|');
            else pattern = escapeRegExp(search);

            orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
            orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
        }
        if (status && status.length > 0) {
            andQueries.push({ status: status });
        }
        if (service && service.length > 0) {
            andQueries.push({ "config.services": { $elemMatch: { "name": service } } });
        }
        
        if (orQueries.length > 0) {
            andQueries.push({ $or: orQueries });
        }
        if (andQueries.length > 0) {
            find.$and = andQueries;
        }

        request.get(config.api.wf + '/resource', { headers, json: true, qs: {
            find: JSON.stringify(find),
            sort: JSON.stringify({ name: 1 }),
            limit, skip
        } }, (err, res, body) => {
            if (err) reject(err);
            else if (res.statusCode != 200) reject(res.statusCode + ": " + res.statusMessage);
            else {
                resolve(body.resources);
            }
        });
    });
}

/**
 * Flexibly match resources
 * @param {any} headers
 * @param {string} match
 * @param {string} status
 * @param {string} service
 * @returns {Promise<resource[]>}
 */
function matchResources(headers, match, status, service) {
    let options = match;
    if (!Array.isArray(options)) options = (options || '').split(delimiter);
    options = options.map(opt => opt.trim()).filter(opt => opt.length > 0);

    let ids = options.filter(isValidObjectId);
    let queries = options.filter(o => !isValidObjectId(o));

    return queryResources(headers, ids, queries, status, service, "0", "0");
}

/**
 * Get an instance for a service
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

        request.get({url: config.api.wf + "/instance?find=" + JSON.stringify(find), headers: headers, json: true}, (err, res, body) => {
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
                    if (err) return reject(err);
                    else if (res.statusCode != 200) {
                        if (res.statusMessage == 'not member of the group you have specified') {
                            reject("There was an error during instance creation. Please log in again.");
                        }
                        else reject(res.body.message);
                    } else {
                        resolve(body);
                    }
                });
            }
        });
    });
}

/**
 * Run a Brain Life application
 * @param {any} headers
 * @param {string} appSearch
 * @param {string[]} userInputs
 * @param {string} projectSearch
 * @param {string} userConfig
 * @param {boolean} raw
 */
function runApp(headers, appSearch, userInputs, projectSearch, resourceSearch, serviceBranch, userConfig, raw) {
    return new Promise(async (resolve, reject) => {
        let datatypeTable = {};
        let app_inputs = [], app_outputs = [], all_dataset_ids = [];
        let output_metadata = {};
        
        userConfig = userConfig || '{}';
        try {
            userConfig = JSON.parse(userConfig);
        } catch (exception) {
            errorMaybeRaw('Error: Could not parse JSON Config Object', raw);
        }
        
        let datatypes = await matchDatatypes(headers);
        let apps = await matchApps(headers, appSearch);
        let projects = await matchProjects(headers, projectSearch);
        
        if (apps.length == 0) errorMaybeRaw("Error: No apps found matching '" + appSearch + "'", raw);
        if (apps.length > 1) errorMaybeRaw("Error: Multiple apps matching '" + appSearch + "'", raw);
        
        if (projects.length == 0) errorMaybeRaw("Error: No projects found matching '" + projectSearch + "'", raw);
        if (projects.length > 1) errorMaybeRaw("Error: Multiple projects matching '" + projectSearch + "'", raw);
        
        let inputs = {};
        let idToAppInputTable = {};
        let app = apps[0];
        let project = projects[0];
        let resource;
        
        // check user-inputted branch
        let branch = app.github_branch;
        if (serviceBranch && serviceBranch.length > 0) {
            try {
                let probe = await queryGithub(app.github, serviceBranch);
                if (probe.statusCode == 200) {
                    if (!raw) console.log("Using user-inputted branch: " + serviceBranch);
                    branch = serviceBranch;
                }
                else {
                    errorMaybeRaw('Error: The given github branch (' + serviceBranch + ') does not exist for ' + app.github, raw);
                }
            } catch (exception) {
                errorMaybeRaw(exception, raw);
            }
        }
        
        // setting user-preferred resource
        let bestResource = await getResource(headers, app.github);
        if (bestResource.resource) resource = bestResource.resource._id;
        
        if (bestResource.considered && resourceSearch && resourceSearch.length > 0) {
            
            let resources = await matchResources(headers, resourceSearch);
            if (resources.length == 0) {
                errorMaybeRaw("Error: No resources found matching '" + resourceSearch + "'", raw);
            }
            if (resources.length > 1) {
                errorMaybeRaw("Error: Multiple resources matching '" + resourceSearch + "'", raw);
            }
            let userResource = resources[0];
            let userResourceIsValid = false;
            bestResource.considered.forEach(resource => {
                if (resource.id == userResource._id) userResourceIsValid = true;
            });
            
            if (userResourceIsValid) {
                if (!raw) console.log("Resource " + userResource.name + " (" + userResource._id + ") is valid and will be preferred.");
                resource = userResource._id;
            } else {
                errorMaybeRaw("Error: The given preferred resource (" + userResource.name + ") is unable to run this application", raw);
            }
        }
        
        // create tables to get from id -> appInput and id -> datatype
        app.inputs.forEach(input => {
            if (!raw) console.log("found app input key '" + input.id + "'");
            idToAppInputTable[input.id] = input;
        });
        datatypes.forEach(d => datatypeTable[d._id] = d);
        
        for (let inputSearch of userInputs) {
            // get dataset for each input
            if (inputSearch.indexOf(':') == -1) errorMaybeRaw('Error: No key given for dataset ' + inputSearch, raw);
            let file_id = inputSearch.substring(0, inputSearch.indexOf(":"));
            let datasetQuery = inputSearch.substring(inputSearch.indexOf(":") + 1);
            let results = await matchDatasets(headers, datasetQuery);
            
            if (results.length == 0) errorMaybeRaw("Error: No datasets matching '" + datasetQuery + "'", raw);
            if (results.length > 1) errorMaybeRaw("Error: Multiple datasets matching '" + datasetQuery + "'", raw);
            if (all_dataset_ids.indexOf(results[0]._id) == -1) all_dataset_ids.push(results[0]._id);
            
            let dataset = results[0];
            let app_input = idToAppInputTable[file_id];
            
            // validate dataset
            if (dataset.status != "stored") errorMaybeRaw("Input dataset " + inputSearch + " has storage status '" + dataset.status + "' and cannot be used until it has been successfully stored.", raw);
            if (dataset.removed == true) errorMaybeRaw("Input dataset " + inputSearch + " has been removed and cannot be used.", raw);
            
            if (!app_input) errorMaybeRaw("Error: This app's config does not include key '" + file_id + "'", raw);
            
            if (app_input.datatype != dataset.datatype) {
                errorMaybeRaw("Given input of datatype " + datatypeTable[dataset.datatype].name + " but expected " + datatypeTable[app_input.datatype].name + " when checking " + inputSearch, raw);
            }
            
            // validate dataset's datatype tags
            let userInputTags = {};
            dataset.datatype_tags.forEach(tag => userInputTags[tag] = 1);
            app_input.datatype_tags.forEach(tag => {
                if (tag.startsWith("!")) {
                    if (userInputTags[tag.substring(1)]) errorMaybeRaw("Error: This app requires that the input dataset for " + file_id + " should NOT have datatype tag '" + tag.substring(1) + "' but found it in " + inputSearch, raw);
                } else {
                    if (!userInputTags[tag]) errorMaybeRaw("Error: This app requires that the input dataset for " + file_id + " have datatype tag '" + tag + "', but it is not set on " + inputSearch, raw);
                }
            });
            
            inputs[file_id] = inputs[file_id] || [];
            inputs[file_id].push(dataset);
        }
        
        // create instance
        let instanceName = (apps[0].tags||'CLI Process') + "." + (Math.random());
        let instance = await getInstance(headers, instanceName, { project, desc: "(CLI) " + app.name });
        
        // prepare config to submit the app
        let flattenedConfig = flattenConfig(app.config, []);
        let flattenedUserConfig = flattenConfig(userConfig, []);
        let values = {};
        
        Object.keys(flattenedConfig).forEach(key => {
            if (flattenedConfig[key].type != 'input') {
                let niceLookingKey = JSON.parse(key).join('.');
                
                // validate each user-given config parameter
                if (!flattenedUserConfig[key]) {
                    if (flattenedConfig[key].default) {
                        if (!raw) console.log("No config entry found for key '" + niceLookingKey +
                                    "'; using the default value in the app's config: " + flattenedConfig[key].default);
                    } else {
                        errorMaybeRaw("Error: no config entry found for key'" + niceLookingKey + "' (type: " + (flattenedConfig[key].type) + "). Please provide one and rerun", raw);
                    }
                }

                if (flattenedUserConfig[key] && /boolean|string|number/.test(flattenedConfig[key].type)) {
                    if (typeof flattenedUserConfig[key] != flattenedConfig[key].type) {
                        errorMaybeRaw("Error: config key '" + niceLookingKey + "': expected type '" + flattenedConfig[key].type + "' but given value of type '" + (typeof flattenedUserConfig[key]) + "'", raw);
                    }
                }

                values[key] = flattenedUserConfig[key] || flattenedConfig[key].default;
            }
        });

        // create token for user-inputted datasets
        request.get({ headers, url: config.api.warehouse + "/dataset/token?ids=" + JSON.stringify(all_dataset_ids), json: true }, async (err, res, body) => {
            if (err) error(err);
            else if (res.statusCode != 200) error(res.body.message);
            
            let jwt = body.jwt;
            let userInputKeys = Object.keys(inputs);
            if (app.inputs.length != userInputKeys.length) error("Error: App expects " + app.inputs.length + " " + pluralize('input', app.inputs) + " but " + userInputKeys.length + " " + pluralize('was', userInputKeys) + " given"); // validate app
            
            let downloads = [], productRawOutputs = [];
            let datatypeToAppInputTable = {};
            let inputTable = {};
            app.inputs.forEach(input => datatypeToAppInputTable[input.datatype] = input);
            Object.keys(inputs).forEach(key => inputTable[inputs[key][0].datatype] = inputs[key]);

            // prepare staging task
            app.inputs.forEach(input => {
                let user_inputs = inputTable[input.datatype];
                user_inputs.forEach(user_input => {
                    downloads.push({
                        url: config.api.warehouse + "/dataset/download/safe/" + user_input._id + "?at=" + jwt,
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
                    
                    // more config preparation
                    let keys = [];
                    for (let key in app.config) {
                        if (app.config[key].input_id == input.id) keys.push(key);
                    }
                    
                    app_inputs.push(Object.assign({ keys }, output));
                    
                    Object.assign(output_metadata, user_input.meta);
                });
            });

            // submit staging task
            request.post({ headers, url: config.api.wf + "/task", json: true, body: {
                instance_id: instance._id,
                name: "Staging Dataset",
                service: "soichih/sca-product-raw",
                desc: "Staging Dataset",
                config: { download: downloads, _outputs: productRawOutputs, _tid: 0 }
            }}, (err, res, body) => {
                if (err) error(err);
                else if (res.statusCode != 200) error(res.body.message);
                if (!raw) console.log("Data Staging Task Created (" + body.task._id + ")");
                
                let task = body.task;
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
                            desc: output.id + " from " + app.name
                        },
                    });
                });
                
                // finalize app config object
                Object.assign(preparedConfig, {
                    _app: app._id,
                    _tid: 1,
                    _inputs: app_inputs,
                    _outputs: app_outputs,
                });
                
                // prepare and run the app task
                let submissionParams = {
                    instance_id: instance._id,
                    name: instanceName,
                    service: app.github,
                    desc: "Running " + app.name,
                    service_branch: app.github_branch,
                    config: preparedConfig,
                    deps: [ task._id ]
                };
                if (resource) submissionParams.preferred_resource_id = resource;
                request.post({ url: config.api.wf + "/task", headers, json: true, body: submissionParams }, (err, res, body) => {
                    if (err) error(err);
                    else if (res.statusCode != 200) error("Error: " + res.body.message);

                    let appTask = body.task;
                    if (!raw) console.log(app.name + " task for app '" + app.name + "' has been created.\n" +
                                "To monitor the app as it runs, please execute \nbl app wait " + appTask._id);
                    
                    resolve(appTask);
                });
            })
        });

        /**
         * Flatten a tree config object into an object with depth 1
         * @param {any} config
         * @param {string[]} path
         */
        function flattenConfig(config, path) {
            let result = {};

            if (/boolean|string|number/.test(typeof config) || Array.isArray(config) || config.type) result[JSON.stringify(path)] = JSON.parse(JSON.stringify(config));
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
            let idToAppInputTable = {};
            let idToDatatype = {};
            let result = {}, flattenedCalculatedConfig = {};

            app.inputs.forEach(input => idToAppInputTable[input.id] = input);
            app.inputs.forEach(input => idToDatatype[input.id] = input.datatype);

            Object.keys(flattened).forEach(path => {
                if (flattened[path].type == 'input') {
                    let userInput = inputs[flattened[path].input_id];
                    let appInput = idToAppInputTable[flattened[path].input_id];
                    
                    if (appInput.multi) {
                        flattenedCalculatedConfig[path] = flattenedCalculatedConfig[path] || [];
                        userInput.forEach(uInput => {
                            let dtype = datatypeTable[uInput.datatype];
                            let idToFile = {};
                            dtype.files.forEach(file => idToFile[file.id] = file);
                            
                            let inputDtypeFile = idToFile[flattened[path].file_id];
                            
                            flattenedCalculatedConfig[path].push("../" + download_task._id + "/" + uInput._id + "/" + (inputDtypeFile.filename||inputDtypeFile.dirname));
                        });
                    } else {
                        let dtype = datatypeTable[userInput[0].datatype];
                        let idToFile = {};
                        dtype.files.forEach(file => idToFile[file.id] = file);
                        
                        let inputDtypeFile = idToFile[flattened[path].file_id];
                        
                        flattenedCalculatedConfig[path] = "../" + download_task._id + "/" + userInput[0]._id + "/" + (inputDtypeFile.filename||inputDtypeFile.dirname);
                    }
                } else {
                    flattenedCalculatedConfig[path] = values[path];
                }
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
        
        /**
         * Get resources that the given service can run on
         * @param {any} headers
         * @param {string} service 
         */
        function getResource(headers, service) {
            return new Promise((resolve, reject) => {
                request.get(config.api.wf + '/resource/best', {
                    headers,
                    qs: { service: service },
                    json: true
                }, (err, res, body) => {
                    if (err) reject(err);
                    else if (res.statusCode != 200) reject("Error: " + res.body.message || res.statusMessage);
                    resolve(body);
                });
            });
        }
        
        /**
         * Query github with the given service and branch
         * @param {string} service 
         * @param {string} branch 
         */
        function queryGithub(service, branch) {
            return new Promise((resolve, reject) => {
                request.get('https://github.com/' + service + '/tree/' + branch, {}, (err, res, body) => {
                    if (err) reject(err);
                    resolve(res);
                });
            });
        }
    });
}

/**
 * Wait for datasets from task to be archived
 * @param {any} headers 
 * @param {task} task 
 * @param {boolean} verbose 
 * @param {(err) => any} cb 
 */
function waitForDatasets(headers, task, verbose, cb) {
    if (!task.config || !task.config._outputs) return success();
    
    let expected_outputs = task.config._outputs.filter(output=>output.archive);
    if(verbose) console.log("Waiting for output datasets: ", expected_outputs.length);
    request.get(config.api.warehouse + '/dataset', { json: true, headers, qs: {
        find: JSON.stringify({'prov.task_id': task._id}),
    } }, (err, res, body) => {
        if (err) return cb(err);
        if (res.statusCode != 200) return cb(res.body.message);
        let stored_datasets = body.datasets.filter(dataset=>dataset.status = "stored");
        if(stored_datasets.length < expected_outputs.length) {
            if(verbose) console.log(expected_outputs.length+" of "+stored_datasets.length+" datasets archived");
            //not all datasets archived yet.. wait
            return setTimeout(()=>{
                waitForDatasets(header, task, verbose, cb); 
            }, 1000 * 5);
        } else {
            return success();
        }
    });
    
    function success() {
        if(verbose) console.log("All output datasets archived!");
        return cb();
    }
}


/**
 * Wait for task to be finished
 * @param {any} headers
 * @param {task} task
 * @param {number} gear
 * @param {(error: string, task: task) => any} cb
 */
let wait_gear = 0;
function waitForFinish(headers, task, verbose, cb) {
    if(wait_gear++ > gearFrames.length) wait_gear = 0;

    var find = {_id: task._id};
    request.get({ url: config.api.wf + "/task?find=" + JSON.stringify({_id: task._id}), headers, json: true}, (err, res, body) => {
        if(err) return cb(err, null);
        if (res.statusCode != 200) error("Error: " + res.body.message);
        
        let task = body.tasks[0];
        if (task.status == "finished") {
            if(verbose) {
                terminalOverwrite.clear();
                terminalOverwrite("SERVICE: " + task.service + gearFrames[wait_gear] + "\n" +
                                    "STATUS: Successfully finished\n(" + timeago.ago(new Date(task.finish_date)) + ")");
                terminalOverwrite.done();
            }
            return waitForDatasets(headers, task, verbose, err=>{
                cb(err, task);
            });
        } else if (task.status == "failed") {
            if(verbose) {
                terminalOverwrite.clear();
                terminalOverwrite("SERVICE: " + task.service + "\n" +
                                    "STATUS: failed");
                terminalOverwrite.done();
            }
            return cb("Error: " + task.status_msg, null);
        } else {
            if(verbose) {
                terminalOverwrite.clear();
                terminalOverwrite("SERVICE: " + task.service + gearFrames[wait_gear] + "\n" +
                                    "STATUS: " + task.status_msg + "\n(running since " + timeago.ago(new Date(task.create_date)) + ")");
        
            }
            return setTimeout(function() {
                waitForFinish(headers, task, verbose, cb);
            }, 1000*10);
        }
    });
}


/**
 * Converts object with maybe null entries to an object with all nonnull values
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
 * Escapes a user input string to make it safe for regex matching
 * @param {string} str
 */
function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\/\^\$\|]/g, "\\$&");
}

/**
 * Returns whether or not a given string is a valid object ID
 * @param {string} str
 */
function isValidObjectId(str) {
    return /^[a-f\d]{24}$/i.test(str);
}

/**
 * Return a pluralized string whether or not there are multiple objects
 * @param {string} string
 * @param {any[]} objects
 */
function pluralize(string, objects) {
    if (objects.length == 1) return string;

    if (string == 'was') return 'were';
    return string + "s";
}

/**
 * Throw an error
 * @param {string} message 
 */
function error(message) {
    console.error(message);
    process.exit(1);
}

/**
 * Throw an error message which might
 * require JSON formatting
 * @param {string} message 
 * @param {any} raw 
 */
function errorMaybeRaw(message, raw) {
    if (raw) error(JSON.stringify({ status: 'error', message: message }));
    else {
        error(message);
    }
}

module.exports = {
    queryDatatypes, queryApps, queryProfiles, queryProjects, queryDatasets, queryResources,
    matchDatatypes, matchApps, matchProfiles, matchProjects, matchDatasets, matchResources,
    getInstance, runApp,
    loadJwt, pluralize, isValidObjectId, waitForFinish, error, errorMaybeRaw
};
