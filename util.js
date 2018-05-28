#!/usr/bin/env node

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

// const gearFrames = ['', '.', '..', '...'];
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
 * Common functions used across CLI scripts
 */

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
function queryDatasets(headers, idSearch, search, admin, datatype, datatype_tags, project, subject, skip, limit) {
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
            else pattern = escapeRegExp(search || '');

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
        if (projects && projects.length > 0) {
            andQueries.push({ project: { $in: projects.map(p => p._id) } });
        }
        if (datatype && datatype.length > 0) {
            andQueries.push({ datatype: { $in: datatypes } })
        }
        
        if (orQueries.length > 0) andQueries.push({ $or: orQueries });
        if (andQueries.length > 0) find.$and = andQueries;
        
        let url = makeQueryUrl(config.api.warehouse + '/dataset', { find, skip: skip || 0, limit: limit || 100 });
        request.get(url, { json: true, headers }, (err, res, body) => {
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
            else pattern = escapeRegExp(search || '');

            orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
            orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
        }
        if (adminSearch && projectAdminIds.length > 0) andQueries.push({ admins: { $elemMatch: { $in: projectAdminIds } } });
        if (memberSearch && projectMemberIds.length > 0) andQueries.push({ members: { $elemMatch: { $in: projectMemberIds } } });
        if (guestSearch && projectGuestIds.length > 0) andQueries.push({ guests: { $elemMatch: { $in: projectGuestIds } } });

        if (orQueries.length > 0) andQueries.push({ $or: orQueries });
        if (andQueries.length > 0) find.$and = andQueries;

        let url = makeQueryUrl(config.api.warehouse + '/project', { find, sort: { name: 1 }, skip: skip || 0, limit: limit || 100 });
        
        request.get(url, { headers, json: true }, (err, res, body) => {
            if (err) error(err);
            else if (res.statusCode != 200) error(res.body.message);
            else {
                resolve(body.projects);
            }
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
            else pattern = escapeRegExp(search || '');

            orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
            orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
        }
        
        if (inputs && inputs.length > 0) inputDatatypes.forEach(datatype => andQueries.push({ inputs: { $elemMatch: { datatype } } }));
        if (outputs && outputs.length > 0) outputDatatypes.forEach(datatype => andQueries.push({ outputs: { $elemMatch: { datatype } } }));

        if (orQueries.length > 0) andQueries.push({ $or: orQueries });
        if (andQueries.length > 0) find.$and = andQueries;

        let url = makeQueryUrl(config.api.warehouse + '/app', { find, sort: { name: 1 }, skip: skip || 0, limit: limit || 100 });
        
        request.get(url, { headers, json: true }, (err, res, body) => {
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
            else pattern = escapeRegExp(search || '');

            orQueries.push({ name: { $regex: pattern, $options: 'ig' } });
            orQueries.push({ desc: { $regex: pattern, $options: 'ig' } });
        }
        if (orQueries.length > 0) find.$or = orQueries;

        let url = makeQueryUrl(config.api.warehouse + '/datatype', { find, sort: { name: 1 }, skip: skip || 0, limit: limit || 100 });
        request.get(url, { headers, json: true }, (err, res, body) => {
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
 * Make a query url out of the given options
 * @param {{find: any, sort: any, select: string, limit: number, skip: number}} options
 */
function makeQueryUrl(url, options) {
    let params = Object.keys(options).map(key => {
        if (/find|sort|where/.test(key)) return key + "=" + JSON.stringify(options[key]);
        else if (/limit|skip/.test(key)) return key + "=" + (+options[key]);
        else {
            return key + "=" + options[key];
        }
    }).join('&');

    if (params.length > 0) params = '?' + params;
    return url + params;
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
            if(err) return error(err);
            if(res.statusCode != 200) return error(res.statusCode);
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
                    if (err) return error(err);
                    else if (res.statusCode != 200) {
                        if (res.statusMessage == 'not member of the group you have specified') {
                            error("There was an error during instance creation. Please log in again.");
                        }
                        else error(res.body.message);
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
function runApp(headers, appSearch, userInputs, projectSearch, userConfig, raw) {
    return new Promise(async (resolve, reject) => {
        let datatypeTable = {};
        let app_inputs = [], app_outputs = [], all_dataset_ids = [];
        let output_metadata = {};
        
        userConfig = userConfig || '{}';
        try {
            userConfig = JSON.parse(userConfig);
        }
        catch (exception) {
            error('Error: Could not parse JSON Config Object');
        }
        
        let datatypes = await matchDatatypes(headers);
        let apps = await matchApps(headers, appSearch);
        let projects = await matchProjects(headers, projectSearch);
        
        if (apps.length == 0) error("Error: No apps found matching '" + appSearch + "'");
        if (apps.length > 1) error("Error: Multiple apps matching '" + appSearch + "'");
        
        if (projects.length == 0) error("Error: No projects found matching '" + projectSearch + "'");
        if (projects.length > 1) error("Error: Multiple projects matching '" + projectSearch + "'");
        
        let inputs = {};
        let idToAppInputTable = {};
        let app = apps[0];
        let project = projects[0];
        
        app.inputs.forEach(input => {
            if (!raw) console.log("found app input key '" + input.id + "'");
            idToAppInputTable[input.id] = input;
        });
        datatypes.forEach(d => datatypeTable[d._id] = d);
        
        for (let inputSearch of userInputs) {
            if (inputSearch.indexOf(':') == -1) error('Error: No key given for dataset ' + inputSearch);
            let file_id = inputSearch.substring(0, inputSearch.indexOf(":"));
            let datasetQuery = inputSearch.substring(inputSearch.indexOf(":") + 1);
            let results = await matchDatasets(headers, datasetQuery);
            
            if (results.length == 0) error("Error: No datasets matching '" + datasetQuery + "'");
            if (results.length > 1) error("Error: Multiple datasets matching '" + datasetQuery + "'");
            if (all_dataset_ids.indexOf(results[0]._id) == -1) all_dataset_ids.push(results[0]._id);
            
            let dataset = results[0];
            let app_input = idToAppInputTable[file_id];
            
            if (dataset.status != "stored") error("Input dataset " + inputSearch + " has storage status '" + dataset.status + "' and cannot be used until it has been successfully stored.");
            if (dataset.removed == true) error("Input dataset " + inputSearch + " has been removed and cannot be used.");
            
            if (!app_input) error("Error: This app's config does not include key '" + file_id + "'");
            
            if (app_input.datatype != dataset.datatype) {
                error("Given input of datatype " + datatypeTable[dataset.datatype].name + " but expected " + datatypeTable[app_input.datatype].name + " when checking " + inputSearch);
            }
            let userInputTags = {};
            dataset.datatype_tags.forEach(tag => userInputTags[tag] = 1);
            app_input.datatype_tags.forEach(tag => {
                if (tag.startsWith("!")) {
                    if (userInputTags[tag.substring(1)]) error("Error: This app requires that the input dataset for " + file_id + " should NOT have datatype tag '" + tag.substring(1) + "' but found it in " + inputSearch);
                } else {
                    if (!userInputTags[tag]) error("Error: This app requires that the input dataset for " + file_id + " have datatype tag '" + tag + "', but it is not set on " + inputSearch);
                }
            });
            
            inputs[file_id] = inputs[file_id] || [];
            inputs[file_id].push(dataset);
        }
        
        let instanceName = (apps[0].tags||'CLI Process') + "." + (Math.random());
        let instance = await getInstance(headers, instanceName, { project, desc: "(CLI) " + app.name });
        
        let flattenedConfig = flattenConfig(app.config, []);
        let flattenedUserConfig = flattenConfig(userConfig, []);
        let values = {};
        
        Object.keys(flattenedConfig).forEach(key => {
            if (flattenedConfig[key].type != 'input') {
                let niceLookingKey = JSON.parse(key).join('.');
                
                if (!flattenedUserConfig[key]) {
                    if (flattenedConfig[key].default) {
                        if (!raw) console.log("No config entry found for key '" + niceLookingKey +
                                    "'; using the default value in the app's config: " + flattenedConfig[key].default);
                    } else {
                        error( 	"Error: no config entry found for key'" + niceLookingKey + "' (type: " +
                                (flattenedConfig[key].type) + "). Please provide one and rerun");
                    }
                }

                if (flattenedUserConfig[key] && /boolean|string|number/.test(flattenedConfig[key].type)) {
                    if (typeof flattenedUserConfig[key] != flattenedConfig[key].type) {
                        error( 	"Error: config key '" + niceLookingKey + "': expected type '" + flattenedConfig[key].type +
                                "' but given value of type '" + (typeof flattenedUserConfig[key]) + "'");
                    }
                }

                values[key] = flattenedUserConfig[key] || flattenedConfig[key].default;

                // flattenedPrompt[key] = {
                // 	type: flattenedConfig[key].type,
                // 	default: flattenedConfig[key].default,
                // 	description: JSON.parse(key).join('->') + " (" + (flattenedConfig[key].description||'null') + ") (type: " + flattenedConfig[key].type
                // };
            }
        });

        request.get({ headers, url: config.api.warehouse + "/dataset/token?ids=" + JSON.stringify(all_dataset_ids), json: true }, async (err, res, body) => {
            if (err) error(err);
            else if (res.statusCode != 200) error(res.body.message);

            let jwt = body.jwt;
            let userInputKeys = Object.keys(inputs);
            if (app.inputs.length != userInputKeys.length) error("Error: App expects " + app.inputs.length + " " + pluralize('input', app.inputs) + " but " + userInputKeys.length + " " + pluralize('was', userInputKeys) + " given");

            // type validation
            // for (let input of app.inputs) {
                
            // }
            
            let downloads = [], productRawOutputs = [];
            let datatypeToAppInputTable = {};
            let inputTable = {};
            app.inputs.forEach(input => datatypeToAppInputTable[input.datatype] = input);
            Object.keys(inputs).forEach(key => inputTable[inputs[key][0].datatype] = inputs[key]);

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
                    
                    let keys = [];
                    for (let key in app.config) {
                        if (app.config[key].input_id == input.id) keys.push(key);
                    }
                    
                    app_inputs.push(Object.assign({ keys }, output));
                    
                    Object.assign(output_metadata, user_input.meta);
                });
            });

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

                Object.assign(preparedConfig, {
                    _app: app._id,
                    _tid: 1,
                    _inputs: app_inputs,
                    _outputs: app_outputs,
                });
                
                // console.log(JSON.stringify(preparedConfig));
                // prepare and run the app task

                request.post({ url: config.api.wf + "/task", headers, json: true, body: {
                    instance_id: instance._id,
                    name: instanceName,
                    service: app.github,
                    desc: "Running " + app.name,
                    service_branch: app.github_branch,
                    config: preparedConfig,
                    deps: [ task._id ]
                }}, (err, res, body) => {
                    if (err) error(err);
                    else if (res.statusCode != 200) error(res.body.message);

                    if (res.statusCode != 200) error("Error: " + res.body.message);

                    let appTask = body.task;
                    if (!raw) console.log(app.name + " task for app '" + app.name + "' has been created.\n" +
                                "To monitor the app as it runs, please execute \nbl app wait --id " + appTask._id);
                    
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
    });
}

/**
 *
 * @param {any} headers
 * @param {task} task
 * @param {number} gear
 * @param {(error: string, task: task) => any} cb
 * @param {boolean} silent
 */
function waitForFinish(headers, task, gear, cb, silent) {
    var find = {_id: task._id};
    request.get({ url: config.api.wf + "/task?find=" + JSON.stringify({_id: task._id}), headers, json: true}, (err, res, body) => {
        if(err) return cb(err, null);
        if (res.statusCode != 200) error("Error: " + res.body.message);
        
        let task = body.tasks[0];
        
        if (!process.stdout.isTTY || silent) {
            if (task.status == "finished") return cb(null, task);
            else if (task.status == "failed") return cb("Error: " + task.status_msg, null);
            else {
                setTimeout(function() {
                    waitForFinish(headers, task, (gear + 1) % gearFrames.length, cb);
                }, 1000);
            }
        } else {
            if (task.status == "finished") {
                terminalOverwrite.clear();
                terminalOverwrite("SERVICE: " + task.service + gearFrames[gear] + "\n" +
                                    "STATUS: Successfully finished\n(" + timeago.ago(new Date(task.finish_date)) + ")");
                terminalOverwrite.done();
                return cb(null, task);
            } else if (task.status == "failed") {
                terminalOverwrite.clear();
                terminalOverwrite("SERVICE: " + task.service + "\n" +
                                    "STATUS: failed");
                terminalOverwrite.done();
                return cb("Error: " + task.status_msg, null);
            } else {
                terminalOverwrite.clear();
                terminalOverwrite("SERVICE: " + task.service + gearFrames[gear] + "\n" +
                                    "STATUS: " + task.status_msg + "\n(running since " + timeago.ago(new Date(task.create_date)) + ")");
        
                setTimeout(function() {
                    waitForFinish(headers, task, (gear + 1) % gearFrames.length, cb);
                }, 1000);
            }
        }
    });
}

/**
 * Load the user's jwt token
 * @returns {Promise<string>}
 */
function loadJwt() {
    return new Promise((resolve, reject) => {
        fs.stat(config.path.jwt, (err, stat) => {
            if (err) {
                error("Error: Couldn't find your jwt token. You're probably not logged in");
                process.exit(1);
            }
            resolve(fs.readFileSync(config.path.jwt));
        });
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
    queryDatatypes, queryApps, queryProfiles, queryProjects, queryDatasets,
    matchDatatypes, matchApps, matchProfiles, matchProjects, matchDatasets,
    getInstance, runApp,
    loadJwt, pluralize, isValidObjectId, waitForFinish, error, errorMaybeRaw
};
