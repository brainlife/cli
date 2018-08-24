#!/usr/bin/env node

/**
 * Common functions used across CLI scripts
 */

'use strict';

const request = require('request-promise-native');
const config = require('./config');
const fs = require('fs');
const jsonwebtoken = require('jsonwebtoken');
const timeago = require('time-ago');
const async = require('async');
const tar = require('tar');
const terminalOverwrite = require('terminal-overwrite');
const prompt = require('prompt');

/**
 * @constant {string} delimiter
 */
const delimiter = ',';

/**
 * @constant {string[]} gearFrames
 */
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
exports.loadJwt = function() {
    return new Promise((resolve, reject) => {
        fs.stat(config.path.jwt, (err, stat) => {
            if (err) {
                return reject("Couldn't find your access token. Please try logging in by running 'bl login'");
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
 * @param {Object} query
 * @param {string} query.id
 * @param {string} query.search
 * @param {Object} opt
 * @param {number} opt.skip
 * @param {number} opt.limit
 * @returns {Promise<datatype[]>}
 */
exports.queryProfiles = function(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    return new Promise(async (resolve, reject) => {
        let body = await request(config.api.auth + '/profile', {
            headers,
            json: true,
            qs: {
                limit: opt.limit || -1,
                offset: opt.skip || 0
            } });
        let profiles = body.profiles;
        
        if (query.id || query.search) {
            profiles = profiles.filter(profile => {
                let showProfile = false;
                
                if (query.id) {
                    showProfile = showProfile || profile.id == query.id;
                }
                if (query.search) {
                    let pattern = new RegExp(escapeRegExp(query.search), 'g');
                    showProfile = showProfile               ||
                            pattern.test(profile.fullname)  ||
                            pattern.test(profile.email)     ||
                            pattern.test(profile.username);
                }
                return showProfile;
            });
        }

        resolve(profiles);
    });
}

/**
 * Get all profiles
 * @param {any} headers 
 */
exports.queryAllProfiles = function(headers) {
    return request(config.api.auth + '/profile', {
        headers,
        json: true,
        qs: {
            limit: -1,
            offset: 0
        }
    }).then(body=>{
        return body.profiles;
    });
}

/**
 * Resolve a set of profiles from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
exports.resolveProfiles = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryProfiles(headers, { id: query }, opt);
    else return exports.queryProfiles(headers, { search: query }, opt);
}

/**
 * Query the list of datasets
 * @param {any} headers
 * @param {Object} query
 * @param {string} query.id
 * @param {string} query.search
 * @param {string} query.datatype
 * @param {string[]} query.datatypeTags
 * @param {string} query.project
 * @param {string} query.subject
 * @param {Object} opt
 * @param {number} opt.skip
 * @param {number} opt.limit
 * @returns {Promise<dataset[]>}
 */
exports.queryDatasets = async function(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    let datatype = null;
    let project = null;
    
    if (query.datatype) {
        let datatypeSearch = {};
        let body = await request(config.api.warehouse + '/datatype', { headers, json: true, qs: {
            find: JSON.stringify({name: query.datatype}),
            limit: 1,
        }});
        if (body.datatypes.length != 1) throw new Error("No datatypes found matching '" + query.datatype + "'");
        datatype = body.datatypes[0];
    }
    
    if (query.project) {
        let projectSearch = {};
        let projects = await exports.resolveProjects(headers, query.project);
        if (projects.length == 0) throw new Error("No projects found matching '" + query.project + "'");
        if (projects.length > 1) throw new Error("Multiple projects found matching '" + query.project + "'");
        project = projects[0]._id;
    }
    
    let find = { removed: false }, andQueries = [], orQueries = [];
    if (query.id) {
        if (!exports.isValidObjectId(query.id)) throw new Error('Not a valid object id: ' + query.id);
        orQueries.push({ _id: query.id });
    }
    if (query.search) {
        orQueries.push({ name: { $regex: escapeRegExp(query.search), $options: 'ig' } });
        orQueries.push({ desc: { $regex: escapeRegExp(query.search), $options: 'ig' } });
    }
    
    if (query.tags) {
        query.tags.forEach(tag => {
            if (tag.startsWith("!")) andQueries.push({ tags: { $not: { $elemMatch: { $eq: tag.substring(1) } } } });
            else {
                andQueries.push({ tags: { $elemMatch: { $eq: tag } } });
            }
        });
    }
    if (query.datatypeTags) {
        query.datatypeTags.forEach(tag => {
            if (tag.startsWith("!")) andQueries.push({ datatype_tags: { $not: { $elemMatch: { $eq: tag.substring(1) } } } });
            else {
                andQueries.push({ datatype_tags: { $elemMatch: { $eq: tag } } });
            }
        });
    }
    
    if (project) andQueries.push({ project });
    if (datatype) andQueries.push({ datatype });
    if (query.subject) andQueries.push({ "meta.subject": query.subject });
    if (query.taskId) {
        if (!exports.isValidObjectId(query.taskId)) throw new Error("Not a valid task id: " + query.taskId);
        andQueries.push({ 'prov.task_id': query.taskId });
    }
    
    if (orQueries.length > 0) andQueries.push({ $or: orQueries });
    if (andQueries.length > 0) find.$and = andQueries;
    
    return request(config.api.warehouse + '/dataset', { json: true, headers, qs: {
        find: JSON.stringify(find),
        skip: opt.skip || 0,
        limit: opt.limit || 100
    } }).then(body=>{
        body.datasets.count = body.count;
        return (body.datasets);
    });
}

/**
 * Get all datasets
 * @param {any} headers 
 */
exports.queryAllDatasets = function(headers) {
    return request(config.api.warehouse + '/dataset', {
        headers,
        json: true,
        qs: {
            limit: 0,
            offset: 0
        }
    });
}

/**
 * Resolve a set of datasets from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
exports.resolveDatasets = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryDatasets(headers, { id: query }, opt);
    else {
        return exports.queryDatasets(headers, { search: query }, opt);
    }
}

/**
 * Query the list of projects
 * @param {any} headers
 * @param {Object} query
 * @param {string} query.id
 * @param {string} query.search
 * @param {string} query.admin
 * @param {string} query.member
 * @param {string} query.guest
 * @param {Object} opt
 * @param {number} opt.skip
 * @param {number} opt.limit
 * @returns {Promise<project[]>}
 */
exports.queryProjects = async function(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    let projectAdmin = null;
    let projectMember = null;
    let projectGuest = null;
    if (query.admin) projectAdmin = await ensureUniqueProfile(headers, query.admin);
    if (query.member) projectMember = await ensureUniqueProfile(headers, query.member);
    if (query.guest) projectGuest = await ensureUniqueProfile(headers, query.guest);
    
    let find = { removed: false }, andQueries = [], orQueries = [];
    
    if (query.id) {
        if (!exports.isValidObjectId(query.id)) throw new Error('Not a valid object id: ' + query.id);
        orQueries.push({ _id: query.id });
    }
    if (query.search) {
        orQueries.push({ name: { $regex: escapeRegExp(query.search), $options: 'ig' } });
        orQueries.push({ desc: { $regex: escapeRegExp(query.search), $options: 'ig' } });
    }
    
    if (projectAdmin) {
        andQueries.push({ admins: { $elemMatch: { $eq: projectAdmin.id } } });
    }
    if (projectMember) {
        andQueries.push({ members: { $elemMatch: { $eq: projectMember.id } } });
    }
    if (projectGuest) {
        andQueries.push({ guests: { $elemMatch: { $eq: projectGuest.id } } });
    }

    if (orQueries.length > 0) andQueries.push({ $or: orQueries });
    if (andQueries.length > 0) find.$and = andQueries;

    return request(config.api.warehouse + '/project', { headers, json: true, 
        qs: {
            find: JSON.stringify(find),
            sort: JSON.stringify({ name: 1 }),
            skip: opt.skip || 0,
            limit: opt.limit || 100
        } 
    }).then(body=>{
        //else if (res.statusCode != 200) return throw new Error(res.body.message);
        return body.projects;
    });
    
    /**
     * Ensure that the given user string corresponds
     * to exactly one profile
     * @param {any} headers 
     * @param {string} profile 
     * @returns {Promise<profile>}
     */
    function ensureUniqueProfile(headers, profile) {
        return new Promise(async (resolve, reject) => {
            let profiles = await exports.resolveProfiles(headers, profile);
            
            if (profiles.length == 0) {
                reject("No profile matching '" + profile + "'");
            } else if (profiles.length > 1) {
                reject("Multiple profiles matching '" + profile + "'");
            } else {
                resolve(profiles[0]);
            }
        });
    }
}

/**
 * Get all projects
 * @param {any} headers 
 */
exports.queryAllProjects = function(headers) {
    return request(config.api.warehouse + '/project', {
        headers,
        json: true,
        qs: {
            limit: 0,
            offset: 0
        }
    }).then(body=>{
        return body.projects;
    });
}

/**
 * Resolve a set of projects from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
exports.resolveProjects = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryProjects(headers, { id: query }, opt);
    else return exports.queryProjects(headers, { search: query }, opt);
}

/**
 * Query the list of apps
 * @param {any} headers
 * @param {Object} query
 * @param {string} query.id
 * @param {string} query.search
 * @param {string} query.doi
 * @param {string[]} query.inputs
 * @param {string[]} query.outputs
 * @param {Object} opt
 * @param {number} opt.skip
 * @param {number} opt.limit
 * @returns {Promise<app[]>}
 */
exports.queryApps = async function(headers, query, opt) {
    if(query === undefined) query = {};
    if(opt === undefined) opt = {};

    let input_datatypes = [];
    let output_datatypes = [];
    
    if (query.inputs) {
        for (let input of query.inputs) {
            let datatype = await ensureUniqueDatatype(headers, input);
            input_datatypes.push(datatype);
        }
    }
    if (query.outputs) {
        for (let output of query.outputs) {
            let datatype = await ensureUniqueDatatype(headers, output);
            output_datatypes.push(datatype);
        }
    }
    let andQueries = [];
    let orQueries = [];

    if (query.id) {
        if (!exports.isValidObjectId(query.id)) throw new Error('Not a valid object id: ' + query.id);
        orQueries.push({ _id: query.id });
    }
    if (query.search) {
        orQueries.push({ name: { $regex: escapeRegExp(query.search), $options: 'ig' } });
        orQueries.push({ desc: { $regex: escapeRegExp(query.search), $options: 'ig' } });
    }
    if (query.doi) {
        andQueries.push({ doi: query.doi });
    }
    if (input_datatypes.length > 0) {
        andQueries = andQueries.concat(input_datatypes.map(datatype => { 
            if (datatype.not) {
                return { inputs: { $not: { $elemMatch: { datatype: datatype._id } } } };
            } else {
                return { inputs: { $elemMatch: { datatype: datatype._id } } };
            }
        }));
    }
    if (output_datatypes.length > 0) {
        andQueries = andQueries.concat(output_datatypes.map(datatype => { 
            return { outputs: { $elemMatch: { datatype: datatype._id } } }; 
        }));
    }
    
    let find = {
        removed: false,
    }
    if (orQueries.length > 0) andQueries.push({ $or: orQueries });
    if (andQueries.length > 0) find.$and = andQueries;
    
    return request(config.api.warehouse + '/app', {
        headers,
        json: true,
        qs: {
            find: JSON.stringify(find),
            sort: "name",
            skip: opt.skip || 0,
            limit: opt.limit || 100
        } 
    }).then(res=>{
        return res.apps;
    });
    
    /**
     * Ensure that the given user string corresponds
     * to exactly one datatype
     * @param {any} headers 
     * @param {string} query 
     * @returns {Promise<datatype>}
     */
    function ensureUniqueDatatype(headers, query) {
        return new Promise(async (resolve, reject) => {
            let datatypes = await exports.resolveDatatypes(headers, query);
            let not = query.startsWith('!');
            
            if (not) query = query.substring(1);
            if (datatypes.length == 0) {
                reject("No datatype matching '" + query + "'");
            } else if (datatypes.length > 1) {
                reject("Multiple datatypes matching '" + query + "'");
            } else {
                let datatype = datatypes[0];
                datatype.not = not;
                resolve(datatype);
            }
        });
    }
}

/**
 * Resolve a set of apps from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
exports.resolveApps = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryApps(headers, { id: query }, opt);
    else return exports.queryApps(headers, { search: query }, opt);
}

/**
 * Query the list of datatypes
 * @param {any} headers
 * @param {Object} query
 * @param {string} query.id
 * @param {string} query.search
 * @param {Object} opt
 * @param {number} opt.skip
 * @param {number} opt.limit
 * @returns {Promise<datatype[]>}
 */
exports.queryDatatypes = function(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    let orQueries = [], find = {};
    if (query.id) {
        if (!exports.isValidObjectId(query.id)) throw new Error('Not a valid object id: ' + query.id);
        orQueries.push({ _id: query.id });
    }
    if (query.search) {
        orQueries.push({ name: { $regex: escapeRegExp(query.search), $options: 'ig' } });
        orQueries.push({ desc: { $regex: escapeRegExp(query.search), $options: 'ig' } });
    }

    if (orQueries.length > 0) find.$or = orQueries;
    return request(config.api.warehouse + '/datatype', {
        headers,
        json: true,
        qs: {
            find: JSON.stringify(find),
            sort: "name",
            skip: opt.skip || 0,
            limit: opt.limit || 100
        } 
    }).then(body=>{;
        return body.datatypes;
    });
}

/**
 * Get all datatypes
 * @param {any} headers 
 */
//TODO why can't we use queryDatatypes?
exports.queryAllDatatypes = function(headers) {
    return request(config.api.warehouse + '/datatype', {
        headers,
        json: true,
        qs: {
            limit: 0,
            offset: 0
        }
    }).then(body=>{
        return body.datatypes;
    });
}

/**
 * Resolve a set of datatypes from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
exports.resolveDatatypes = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryDatatypes(headers, { id: query }, opt);
    else return exports.queryDatatypes(headers, { search: query }, opt);
}

/**
 * Query the list of resources
 * @param {any} headers
 * @param {Object} query
 * @param {string} query.id
 * @param {string} query.search
 * @param {string[]} query.status
 * @param {string[]} query.service
 * @param {Object} opt
 * @param {number} opt.skip
 * @param {number} opt.limit
 * @returns {Promise<resource[]>}
 */
exports.queryResources = function(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    let find = {}, orQueries = [], andQueries = [];
    if (query.id) {
        if (!exports.isValidObjectId(query.id)) throw new Error('Not a valid object id: ' + query.id);
        orQueries.push({ _id: query.id });
    }
    if (query.search) {
        orQueries.push({ name: { $regex: escapeRegExp(query.search), $options: 'ig' } });
        orQueries.push({ desc: { $regex: escapeRegExp(query.search), $options: 'ig' } });
    }
    if (query.status) {
        andQueries.push({ status: query.status });
    }
    if (query.service) {
        andQueries.push({ "config.services": { $elemMatch: { "name": query.service } } });
    }
    if (orQueries.length > 0) andQueries.push({ $or: orQueries });
    if (andQueries.length > 0) find.$and = andQueries;

    return request(config.api.wf + '/resource', { headers, json: true, 
        qs: {
            find: JSON.stringify(find),
            sort: JSON.stringify({ name: 1 }),
            skip: opt.skip || 0,
            limit: opt.limit || 100
        } 
    }).then(body=>{
        return body.resources;
    });
}

/**
 * Resolve a set of resources from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
exports.resolveResources = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryResources(headers, { id: query }, opt);
    else return exports.queryResources(headers, { search: query }, opt);
}

/**
 * Get an instance for a service
 * @param {any} headers
 * @param {string} instanceName
 * @param {Object} options
 * @param {project} options.project
 * @param {string} options.desc
 * @returns {Promise<instance>}
 */
exports.getInstance = function(headers, instanceName, options) {
    return new Promise((resolve, reject)=>{
        // get instance that might already exist
        var find = { name: instanceName };
        options = options || {};

        request({url: config.api.wf + "/instance?find=" + JSON.stringify(find), headers: headers, json: true}, (err, res, body) => {
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
                            return reject("There was an error during instance creation. Please log in again.");
                        }
                        else return reject(res.body.message);
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
 * @param {Object} opt
 * @param {string} opt.app
 * @param {string} opt.project
 * @param {string[]} opt.inputs
 * @param {any} opt.config
 * @param {string} opt.resource
 * @param {string} opt.branch
 * @param {boolean} opt.json
 * @returns {Promise<task>} The resulting app task
 */
exports.runApp = function(headers, opt) {
    return new Promise(async (resolve, reject) => {
        let datatypeTable = {};
        let app_inputs = [], app_outputs = [], all_dataset_ids = [];
        let output_metadata = {};
        
        opt.config = opt.config || '{}';
        try {
            opt.config = JSON.parse(opt.config);
        } catch (exception) {
            return reject('Could not parse JSON Config Object');
        }
        
        let datatypes = await exports.queryAllDatatypes(headers);
        if (datatypes.length == 0) return reject("couldn't load datatypes");

        let apps = await exports.resolveApps(headers, opt.app);
        if (apps.length == 0) return reject("No apps found matching '" + opt.app + "'");
        if (apps.length > 1) return reject("Multiple apps matching '" + opt.app + "'");
        
        let projects = await exports.resolveProjects(headers, opt.project);
        if (projects.length == 0) return reject("No projects found matching '" + opt.project + "'");
        if (projects.length > 1) return reject("Multiple projects matching '" + opt.project + "'");
        
        let inputs = {};
        let idToAppInputTable = {};
        let app = apps[0];
        let project = projects[0];
        let resource;
        
        // check user-inputted branch
        let branch = app.github_branch;
        if (opt.branch) {
            try {
                let branches = await request('https://api.github.com/repos/' + app.github + '/branches', { json: true, headers: { "User-Agent": "brainlife CLI" } });
                let validUserBranch = false;
                branches.forEach(validBranch => {
                    if (opt.branch == validBranch.name) validUserBranch = true;
                });
                
                if (validUserBranch) {
                    branch = opt.branch;
                    if (!opt.json) console.log("Using user-inputted branch: " + branch);
                } else return reject('The given github branch (' + opt.branch + ') does not exist for ' + app.github);
            } catch (err) {
                return reject(err);
            }
        }
        
        // setting user-preferred resource
        let bestResource = await getResource(headers, app.github);
        if (bestResource.resource) resource = bestResource.resource._id;
        if (bestResource.considered && opt.resource) {
            let resources = await exports.resolveResources(headers, opt.resource);
            if (resources.length == 0) {
                return reject("No resources found matching '" + resourceSearch + "'");
            }
            if (resources.length > 1) {
                return reject("Multiple resources matching '" + resourceSearch + "'");
            }
            let userResource = resources[0];
            let userResourceIsValid = false;
            bestResource.considered.forEach(resource => {
                if (resource.id == userResource._id) userResourceIsValid = true;
            });
            
            if (userResourceIsValid) {
                if (!opt.json) console.log("Resource " + userResource.name + " (" + userResource._id + ") is valid and will be preferred.");
                resource = userResource._id;
            } else return reject("The given preferred resource (" + userResource.name + ") is unable to run this application");
        }
        
        // create tables to get from id -> appInput and id -> datatype
        app.inputs.forEach(input => {
            if (!opt.json) console.log("found app input key '" + input.id + "'");
            idToAppInputTable[input.id] = input;
        });
        datatypes.forEach(d => datatypeTable[d._id] = d);
        
        for (let input of opt.inputs) {
            // get dataset for each input
            if (!~input.indexOf(':')) return reject('No key given for dataset ' + input);
            let file_id = input.substring(0, input.indexOf(":"));
            let datasetQuery = input.substring(input.indexOf(":") + 1);
            let datasets = await exports.resolveDatasets(headers, datasetQuery);
            
            if (datasets.length == 0) return reject("No datasets matching '" + datasetQuery + "'");
            if (datasets.length > 1) return reject("Multiple datasets matching '" + datasetQuery + "'");
            if (all_dataset_ids.indexOf(datasets[0]._id) == -1) all_dataset_ids.push(datasets[0]._id);
            
            let dataset = datasets[0];
            let app_input = idToAppInputTable[file_id];
            
            // validate dataset
            if (dataset.status != "stored") return reject("Input dataset " + input + " has storage status '" + dataset.status + "' and cannot be used until it has been successfully stored.");
            if (dataset.removed == true) return reject("Input dataset " + input + " has been removed and cannot be used.");
            if (!app_input) return reject("This app's config does not include key '" + file_id + "'");
            if (app_input.datatype != dataset.datatype) return reject("Given input of datatype " + datatypeTable[dataset.datatype].name + " but expected " + datatypeTable[app_input.datatype].name + " when checking " + input);
            
            // validate dataset's datatype tags
            let userInputTags = {};
            dataset.datatype_tags.forEach(tag => userInputTags[tag] = 1);
            app_input.datatype_tags.forEach(tag => {
                if (tag.startsWith("!")) {
                    if (userInputTags[tag.substring(1)]) return reject("This app requires that the input dataset for " + file_id + " should NOT have datatype tag '" + tag.substring(1) + "' but found it in " + input);
                } else {
                    if (!userInputTags[tag]) return reject("This app requires that the input dataset for " + file_id + " have datatype tag '" + tag + "', but it is not set on " + input);
                }
            });
            
            inputs[file_id] = inputs[file_id] || [];
            inputs[file_id].push(dataset);
        }

        // create instance
        let instanceName = (apps[0].tags||'CLI Process') + "." + (Math.random());
        let instance = await exports.getInstance(headers, instanceName, { project, desc: "(CLI) " + app.name });
        
        // prepare config to submit the app
        let values = {};
        for (let key in app.config) {
            let appParam = app.config[key];
            let userParam = opt.config[key];
            
            if (appParam.type != 'input') {
                // validate each user-given config parameter
                /*
                if (typeof userParam == 'undefined') {
                    if (appParam.default) {
                        if (!opt.json) console.log("No config entry found for key '" + key + "'; " + "using the default value in the app's config: " + appParam.default);
                        userParam = appParam.default;
                    } else {
                        return reject("no config entry found for key'" + key + "' (type: " + (appParam.type) + "). " + "Please provide one and rerun");
                    }
                }
                */
                if(userParam === undefined) userParam = appParam.default;
                /* this doesn't handle value set to null by default
                switch (appParam.type) {
                case "boolean":
                case "string":
                case "number":
                    if (typeof userParam != appParam.type) {
                        return reject("config key '" + key + "': " + "expected type '" + appParam.type + "' but given value of type '" + (typeof userParam) + "'");
                    }
                    break;
                case "enum":
                    let validOptions = appParam.options.map(o => o.value);
                    if (validOptions.indexOf(userParam) == -1) {
                        return reject("config key '" + key + "': expected one of [" + validOptions.join('|') + "] " + "but given value " + userParam);
                    }
                    break;
                }
                */
                values[key] = userParam;
            }
        }

        // create token for user-inputted datasets
        request.post({ headers, json: true , url: config.api.warehouse + "/dataset/token", body: {
            ids: all_dataset_ids,
        }}, async (err, res, body) => {
            if (err) return reject(err);
            else if (res.statusCode != 200) return reject(res.body.message);

            let userInputKeys = Object.keys(inputs);
            if (app.inputs.length != userInputKeys.length) {
                return reject("App expects " + app.inputs.length + " " + exports.pluralize('input', app.inputs) + 
                    " but " + userInputKeys.length + " " + exports.pluralize('was', userInputKeys) + " given"); 
            }
            
            // prepare staging task
            let downloads = [], productRawOutputs = [];
            app.inputs.forEach(input => {
                inputs[input.id].forEach(user_input=>{
                    //console.log("prep", inputs[input.id]);
                    downloads.push({
                        url: config.api.warehouse + "/dataset/download/safe/" + user_input._id + "?at=" + body.jwt,
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
                    
                    //TODO merging meta from all datasets.. probably not good enough
                    //Object.assign(output_metadata, user_input.meta);
                    for(var k in user_input.meta) {
                        if(!output_metadata[k]) output_metadata[k] = user_input.meta[k]; //use first one
                    }
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
                if (err) return reject(err);
                else if (res.statusCode != 200) return reject(res.body.message);
                if (!opt.json) console.log("Data Staging Task Created (" + body.task._id + ")");
                
                let task = body.task;
                let preparedConfig = prepareConfig(values, task, inputs, datatypeTable, app);

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
                    name: app.name.trim(),
                    service: app.github,
                    service_branch: branch,
                    config: preparedConfig,
                    deps: [ task._id ]
                };
                if (resource) submissionParams.preferred_resource_id = resource;
                request.post({ url: config.api.wf + "/task", headers, json: true, body: submissionParams }, (err, res, body) => {
                    if (err) return reject(err);
                    else if (res.statusCode != 200) return reject(res.body.message);
                    if (!opt.json) console.log(app.name + " task for app '" + app.name + "' has been created.\n" +
                                "To monitor the app as it runs, please execute \nbl app wait " + body.task._id);
                    
                    resolve(body.task);
                });
            })
        });

        /**
         *
         * @param {any} values
         * @param {task} download_task
         * @param {input[]} inputs
         * @param {datatype[]} datatypeTable
         * @param {app} app
         * @returns {any}
         */
        function prepareConfig(values, download_task, inputs, datatypeTable, app) {
            let idToAppInputTable = {};
            let idToDatatype = {};
            let result = {};

            app.inputs.forEach(input => idToAppInputTable[input.id] = input);
            app.inputs.forEach(input => idToDatatype[input.id] = input.datatype);

            Object.keys(app.config).forEach(key => {
                if (app.config[key].type == 'input') {
                    let userInputs = inputs[app.config[key].input_id];
                    let appInput = idToAppInputTable[app.config[key].input_id];
                    
                    if (appInput.multi) {
                        result[key] = result[key] || [];
                        userInputs.forEach(uInput => {
                            let dtype = datatypeTable[uInput.datatype];
                            let idToFile = {};
                            dtype.files.forEach(file => idToFile[file.id] = file);
                            let inputDtypeFile = idToFile[app.config[key].file_id];
                            result[key].push("../" + download_task._id + "/" + uInput._id + "/" + (inputDtypeFile.filename||inputDtypeFile.dirname));
                        });
                    } else {
                        let dtype = datatypeTable[userInputs[0].datatype];
                        let idToFile = {};
                        dtype.files.forEach(file => idToFile[file.id] = file);
                        let inputDtypeFile = idToFile[app.config[key].file_id];
                        result[key] = "../" + download_task._id + "/" + userInputs[0]._id + "/" + (inputDtypeFile.filename||inputDtypeFile.dirname);
                    }
                } else {
                    result[key] = values[key];
                }
            });
            
            return result;
        }
        
        /**
         * Get resources that the given service can run on
         * @param {any} headers
         * @param {string} service 
         * @returns {Promise<{ resource: string, considered: resource[] }>}
         */
        function getResource(headers, service) {
            return request(config.api.wf + '/resource/best', {
                headers,
                qs: { service: service },
                json: true
            });
        }
    });
}

/**
 * Wait for datasets from task to be archived
 * @param {any} headers 
 * @param {task} task 
 * @param {boolean} verbose 
 * @param {(error: string) => any} cb 
 */
function waitForArchivedDatasets(headers, task, verbose, cb) {
    if (!task.config || !task.config._outputs) return cb();
    let expected_outputs = task.config._outputs.filter(output=>output.archive);
    if(verbose) console.log("Waiting for output datasets: ", expected_outputs.length);
    request(config.api.warehouse + '/dataset', { json: true, headers, qs: {
        find: JSON.stringify({'prov.task_id': task._id}),
    } }, (err, res, body) => {
        if (err) return cb(err);
        if (res.statusCode != 200) return cb(res.body.message);
        let stored_datasets = body.datasets.filter(dataset=>dataset.status = "stored");
        if(stored_datasets.length < expected_outputs.length) {
            if(verbose) console.log(expected_outputs.length+" of "+stored_datasets.length+" datasets archived");
            //not all datasets archived yet.. wait
            return setTimeout(()=>{
                waitForArchivedDatasets(header, task, verbose, cb); 
            }, 1000 * 5);
        } else {
            if(verbose) console.log("Done archiving");
            return cb();
        }
    });
}


/**
 * Wait for task to be finished
 * @param {any} headers
 * @param {task} task
 * @param {number} gear
 * @param {(error: string, task: task) => any} cb
 */
let wait_gear = 0;
exports.waitForFinish = function(headers, task, verbose, cb) {
    if(wait_gear++ >= gearFrames.length) wait_gear = 0;

    var find = {_id: task._id};
    request({ url: config.api.wf + "/task?find=" + JSON.stringify({_id: task._id}), headers, json: true}, (err, res, body) => {
        if(err) return cb(err, null);
        if(res.statusCode != 200) return cb(err);
        if(body.tasks.length != 1) return cb("Couldn't find exactly oone task id");
        let task = body.tasks[0];
        if (task.status == "finished") {
            if(verbose) {
                terminalOverwrite.clear();
                terminalOverwrite(task.name + "("+task.service + ")"+ gearFrames[wait_gear] + "\n" +
                                    "STATUS: Successfully finished\n(" + timeago.ago(new Date(task.finish_date)) + ")");
                terminalOverwrite.done();
            }
            return waitForArchivedDatasets(headers, task, verbose, err=>{
                cb(err, task);
            });
        } else if (task.status == "failed") {
            if(verbose) {
                terminalOverwrite.clear();
                terminalOverwrite(task.name + "("+ task.service + ")\n" +
                                    "STATUS: failed");
                terminalOverwrite.done();
            }
            return cb(task.status_msg, null);
        } else {
            if(verbose) {
                terminalOverwrite.clear();
                terminalOverwrite(task.name + "("+task.service + ")"+ gearFrames[wait_gear] + "\n" +
                                    "STATUS: " + task.status_msg + "\n(running since " + timeago.ago(new Date(task.create_date)) + ")");
        
            }
            return setTimeout(function() {
                exports.waitForFinish(headers, task, verbose, cb);
            }, 1000*10);
        }
    });
}

/**
 * Get a specific file from a task's output
 * @param {any} headers 
 * @param {string} filename 
 * @param {task} task 
 * @param {string} defaultErr 
 */
exports.getFileFromTask = function(headers, filename, task, defaultErr) {
    return new Promise(async (resolve, reject) => {
        let fileBody = await request({
            url: config.api.wf + '/task/ls/' + task._id,
            headers,
            json: true });
        
        let files = fileBody.files;
        let taskFile = null;
        files.forEach(file => {
            if (file.filename == filename) {
                taskFile = file;
            }
        });
        
        if (taskFile) {
            let result = await request({
                url: config.api.wf + '/task/download/' + task._id,
                qs: {
                    p: taskFile.filename
                },
                headers,
                json: true
            });
            return resolve(result);
        } else {
            return reject(defaultErr);
        }
    });
}

/**
 * Escapes a user input string to make it safe for regex matching
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\/\^\$\|]/g, "\\$&");
}

/**
 * Returns whether or not a given string is a valid object ID
 * @param {string} str
 * @returns {boolean}
 */
exports.isValidObjectId = function(str) {
    return /^[a-f\d]{24}$/i.test(str);
}

/**
 * Return a pluralized string whether or not there are multiple objects
 * @param {string} string
 * @param {any[]} objects
 * @returns {string}
 */
exports.pluralize = function(string, objects) {
    if (objects.length == 1) return string;
    if (string == 'was') return 'were';
    return string + "s";
}

exports.collect = function(val, all) {
    all.push(val);
    return all;
}
