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
const spawn = require('child_process').spawn;
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
function loadJwt() {
    return new Promise((resolve, reject) => {
        fs.stat(config.path.jwt, (err, stat) => {
            if (err) {
                return reject("Error: Couldn't find your access token. Please try logging in by running 'bl login'");
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
function queryProfiles(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    return new Promise(async (resolve, reject) => {
        let body = await request.get(config.api.auth + '/profile', {
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
function queryAllProfiles(headers) {
    return new Promise(async (resolve, reject) => {
        let body = await request.get(config.api.auth + '/profile', {
            headers,
            json: true,
            qs: {
                limit: -1,
                offset: 0
            }
        });
        return resolve(body.profiles);
    });
}

/**
 * Resolve a set of profiles from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
function resolveProfiles(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    
    if (isValidObjectId(query)) return queryProfiles(headers, { id: query }, opt);
    else {
        return queryProfiles(headers, { search: query }, opt);
    }
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
function queryDatasets(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    return new Promise(async (resolve, reject) => {
        let datatype = null;
        let project = null;
        
        if (query.datatype) {
            let datatypeSearch = {};
            let datatypes = await resolveDatatypes(headers, query.datatype);
            
            if (datatypes.length == 0) return reject("Error: No datatypes found matching '" + query.datatype + "'");
            if (datatypes.length > 1) return reject("Error: Multiple datatypes found matching '" + query.datatype + "'");
            datatype = datatypes[0];
        }
        
        if (query.project) {
            let projectSearch = {};
            let projects = await resolveProjects(headers, query.project);
            
            if (projects.length == 0) return reject("Error: No projects found matching '" + query.project + "'");
            if (projects.length > 1) return reject("Error: Multiple projects found matching '" + query.project + "'");
            project = projects[0];
        }
        
        let find = { removed: false }, andQueries = [], orQueries = [];
        if (query.id) {
            if (!isValidObjectId(query.id)) return reject('Error: Not a valid object id: ' + query.id);
            orQueries.push({ _id: query.id });
        }
        if (query.search) {
            orQueries.push({ name: { $regex: escapeRegExp(query.search), $options: 'ig' } });
            orQueries.push({ desc: { $regex: escapeRegExp(query.search), $options: 'ig' } });
        }
        
        if (query.datatypeTags) {
            query.datatypeTags.forEach(tag => {
                if (tag.startsWith("!")) andQueries.push({ datatype_tags: { $not: { $elemMatch: { $eq: tag.substring(1) } } } });
                else {
                    andQueries.push({ datatype_tags: { $elemMatch: { $eq: tag } } });
                }
            });
        }
        
        if (project) {
            andQueries.push({ project });
        }
        if (datatype) {
            andQueries.push({ datatype });
        }
        if (query.subject) {
            andQueries.push({ "meta.subject": query.subject });
        }
        if (query.taskId) {
            if (!isValidObjectId(query.taskId)) return reject("Error: Not a valid task id: " + query.taskId);
            andQueries.push({ 'prov.task_id': query.taskId });
        }
        
        
        if (orQueries.length > 0) andQueries.push({ $or: orQueries });
        if (andQueries.length > 0) find.$and = andQueries;
        
        request.get(config.api.warehouse + '/dataset', { json: true, headers, qs: {
            find: JSON.stringify(find),
            skip: opt.skip || 0,
            limit: opt.limit || 100
        } }, (err, res, body) => {
            if (err) return reject(err);
            else if (res.statusCode != 200) return reject(res.body.message);
            else {
                body.datasets.count = body.count;
                resolve(body.datasets);
            }
        });
    });
}

/**
 * Get all datasets
 * @param {any} headers 
 */
function queryAllDatasets(headers) {
    return new Promise(async (resolve, reject) => {
        let body = await request.get(config.api.warehouse + '/dataset', {
            headers,
            json: true,
            qs: {
                limit: 0,
                offset: 0
            }
        });
        return resolve(body.datasets);
    });
}

/**
 * Resolve a set of datasets from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
function resolveDatasets(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    
    if (isValidObjectId(query)) return queryDatasets(headers, { id: query }, opt);
    else {
        return queryDatasets(headers, { search: query }, opt);
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
function queryProjects(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    return new Promise(async (resolve, reject) => {
        let projectAdmin = null;
        let projectMember = null;
        let projectGuest = null;
        if (query.admin) projectAdmin = await ensureUniqueProfile(headers, query.admin);
        if (query.member) projectMember = await ensureUniqueProfile(headers, query.member);
        if (query.guest) projectGuest = await ensureUniqueProfile(headers, query.guest);
        
        let find = { removed: false }, andQueries = [], orQueries = [];
        
        if (query.id) {
            if (!isValidObjectId(query.id)) reject('Error: Not a valid object id: ' + query.id);
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

        request.get(config.api.warehouse + '/project', { headers, json: true, qs: {
            find: JSON.stringify(find),
            sort: JSON.stringify({ name: 1 }),
            skip: opt.skip || 0,
            limit: opt.limit || 100
        } }, (err, res, body) => {
            if (err) return reject(err);
            else if (res.statusCode != 200) return reject(res.body.message);
            else resolve(body.projects);
        });
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
            let profiles = await resolveProfiles(headers, profile);
            
            if (profiles.length == 0) {
                reject("Error: No profile matching '" + profile + "'");
            } else if (profiles.length > 1) {
                reject("Error: Multiple profiles matching '" + profile + "'");
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
function queryAllProjects(headers) {
    return new Promise(async (resolve, reject) => {
        let body = await request.get(config.api.warehouse + '/project', {
            headers,
            json: true,
            qs: {
                limit: 0,
                offset: 0
            }
        });
        return resolve(body.projects);
    });
}

/**
 * Resolve a set of projects from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
function resolveProjects(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    
    if (isValidObjectId(query)) return queryProjects(headers, { id: query }, opt);
    else {
        return queryProjects(headers, { search: query }, opt);
    }
}

/**
 * Query the list of apps
 * @param {any} headers
 * @param {Object} query
 * @param {string} query.id
 * @param {string} query.search
 * @param {string[]} query.inputs
 * @param {string[]} query.outputs
 * @param {Object} opt
 * @param {number} opt.skip
 * @param {number} opt.limit
 * @returns {Promise<app[]>}
 */
function queryApps(headers, query, opt) {
    if(query === undefined) query = {};
    if(opt === undefined) opt = {};

    return new Promise(async (resolve, reject) => {
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
            if (!isValidObjectId(query.id)) reject('Error: Not a valid object id: ' + query.id);
            orQueries.push({ _id: query.id });
        }
        if (query.search) {
            orQueries.push({ name: { $regex: escapeRegExp(query.search), $options: 'ig' } });
            orQueries.push({ desc: { $regex: escapeRegExp(query.search), $options: 'ig' } });
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
        
        let body = await request.get(config.api.warehouse + '/app', {
            headers,
            json: true,
            qs: {
                find: JSON.stringify(find),
                sort: "name",
                skip: opt.skip || 0,
                limit: opt.limit || 100
            } });
        resolve(body.apps);
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
            let datatypes = await resolveDatatypes(headers, query);
            let not = query.startsWith('!');
            
            if (not) query = query.substring(1);
            if (datatypes.length == 0) {
                reject("Error: No datatype matching '" + query + "'");
            } else if (datatypes.length > 1) {
                reject("Error: Multiple datatypes matching '" + query + "'");
            } else {
                let datatype = datatypes[0];
                datatype.not = not;
                resolve(datatype);
            }
        });
    }
}

/**
 * Get all apps
 * @param {any} headers 
 */
function queryAllApps(headers) {
    return new Promise(async (resolve, reject) => {
        let body = await request.get(config.api.warehouse + '/app', {
            headers,
            json: true,
            qs: {
                limit: 0,
                offset: 0
            }
        });
        return resolve(body.apps);
    });
}

/**
 * Resolve a set of apps from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
function resolveApps(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    
    if (isValidObjectId(query)) return queryApps(headers, { id: query }, opt);
    else {
        return queryApps(headers, { search: query }, opt);
    }
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
function queryDatatypes(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    return new Promise(async (resolve, reject) => {
        let orQueries = [], find = {};
        if (query.id) {
            if (!isValidObjectId(query.id)) reject('Error: Not a valid object id: ' + query.id);
            orQueries.push({ _id: query.id });
        }
        if (query.search) {
            orQueries.push({ name: { $regex: escapeRegExp(query.search), $options: 'ig' } });
            orQueries.push({ desc: { $regex: escapeRegExp(query.search), $options: 'ig' } });
        }

        if (orQueries.length > 0) find.$or = orQueries;
        
        let body = await request.get(config.api.warehouse + '/datatype', {
            headers,
            json: true,
            qs: {
                find: JSON.stringify(find),
                sort: "name",
                skip: opt.skip || 0,
                limit: opt.limit || 100
            } });
        resolve(body.datatypes);
    });
}

/**
 * Get all datatypes
 * @param {any} headers 
 */
function queryAllDatatypes(headers) {
    return new Promise(async (resolve, reject) => {
        let body = await request.get(config.api.warehouse + '/datatype', {
            headers,
            json: true,
            qs: {
                limit: 0,
                offset: 0
            }
        });
        return resolve(body.datatypes);
    });
}

/**
 * Resolve a set of datatypes from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
function resolveDatatypes(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    
    if (isValidObjectId(query)) return queryDatatypes(headers, { id: query }, opt);
    else {
        return queryDatatypes(headers, { search: query }, opt);
    }
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
function queryResources(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    return new Promise(async (resolve, reject) => {
        let find = {}, orQueries = [], andQueries = [];
        
        if (query.id) {
            if (!isValidObjectId(query.id)) reject('Error: Not a valid object id: ' + query.id);
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

        request.get(config.api.wf + '/resource', { headers, json: true, qs: {
            find: JSON.stringify(find),
            sort: JSON.stringify({ name: 1 }),
            skip: opt.skip || 0,
            limit: opt.limit || 100
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
 * Get all resources
 * @param {any} headers 
 */
function queryAllResources(headers) {
    return new Promise(async (resolve, reject) => {
        let body = await request.get(config.api.wf + '/resource', {
            headers,
            json: true,
            qs: {
                limit: 0,
                offset: 0
            }
        });
        return resolve(body.resources);
    });
}

/**
 * Resolve a set of resources from a given
 * text search or id
 * @param {string} query A text search or an id
 * @param {any} headers 
 */
function resolveResources(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    
    if (isValidObjectId(query)) return queryResources(headers, { id: query }, opt);
    else {
        return queryResources(headers, { search: query }, opt);
    }
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
 * @param {Object} opt
 * @param {string} opt.app
 * @param {string} opt.project
 * @param {string[]} opt.inputs
 * @param {any} opt.config
 * @param {string} opt.resource
 * @param {string} opt.branch
 * @param {boolean} opt.raw
 * @returns {Promise<task>} The resulting app task
 */
function runApp(headers, opt) {//appSearch, userInputs, projectSearch, resourceSearch, serviceBranch, userConfig, raw) {
    return new Promise(async (resolve, reject) => {
        let datatypeTable = {};
        let app_inputs = [], app_outputs = [], all_dataset_ids = [];
        let output_metadata = {};
        
        opt.config = opt.config || '{}';
        try {
            opt.config = JSON.parse(opt.config);
        } catch (exception) {
            return reject('Error: Could not parse JSON Config Object');
        }
        
        let datatypes = await queryAllDatatypes(headers);
        let apps = await resolveApps(headers, opt.app);
        let projects = await resolveProjects(headers, opt.project);
        if (apps.length == 0) return reject("Error: No apps found matching '" + opt.app + "'");
        if (apps.length > 1) return reject("Error: Multiple apps matching '" + opt.app + "'");
        
        if (projects.length == 0) return reject("Error: No projects found matching '" + opt.project + "'");
        if (projects.length > 1) return reject("Error: Multiple projects matching '" + opt.project + "'");
        
        let inputs = {};
        let idToAppInputTable = {};
        let app = apps[0];
        let project = projects[0];
        let resource;
        
        // check user-inputted branch
        let branch = app.github_branch;
        if (opt.branch) {
            try {
                let probe = await queryGithub(app.github, opt.branch);
                if (probe.statusCode == 200) {
                    if (!opt.raw) console.log("Using user-inputted branch: " + opt.branch);
                    branch = opt.branch;
                } else {
                    return reject('Error: The given github branch (' + opt.branch + ') does not exist for ' + app.github);
                }
            } catch (exception) {
                return reject(exception);
            }
        }
        
        // setting user-preferred resource
        let bestResource = await getResource(headers, app.github);
        if (bestResource.resource) resource = bestResource.resource._id;
        
        if (bestResource.considered && opt.resource) {
            
            let resources = await resolveResources(headers, opt.resource);
            
            if (resources.length == 0) {
                return reject("Error: No resources found matching '" + resourceSearch + "'");
            }
            if (resources.length > 1) {
                return reject("Error: Multiple resources matching '" + resourceSearch + "'");
            }
            let userResource = resources[0];
            let userResourceIsValid = false;
            bestResource.considered.forEach(resource => {
                if (resource.id == userResource._id) userResourceIsValid = true;
            });
            
            if (userResourceIsValid) {
                if (!opt.raw) console.log("Resource " + userResource.name + " (" + userResource._id + ") is valid and will be preferred.");
                resource = userResource._id;
            } else {
                return reject("Error: The given preferred resource (" + userResource.name + ") is unable to run this application");
            }
        }
        
        // create tables to get from id -> appInput and id -> datatype
        app.inputs.forEach(input => {
            if (!opt.raw) console.log("found app input key '" + input.id + "'");
            idToAppInputTable[input.id] = input;
        });
        datatypes.forEach(d => datatypeTable[d._id] = d);
        
        for (let input of opt.inputs) {
            // get dataset for each input
            if (input.indexOf(':') == -1) return reject('Error: No key given for dataset ' + input);
            let file_id = input.substring(0, input.indexOf(":"));
            let datasetQuery = input.substring(input.indexOf(":") + 1);
            let datasets = await resolveDatasets(headers, datasetQuery);
            
            if (datasets.length == 0) return reject("Error: No datasets matching '" + datasetQuery + "'");
            if (datasets.length > 1) return reject("Error: Multiple datasets matching '" + datasetQuery + "'");
            if (all_dataset_ids.indexOf(datasets[0]._id) == -1) all_dataset_ids.push(datasets[0]._id);
            
            let dataset = datasets[0];
            let app_input = idToAppInputTable[file_id];
            
            // validate dataset
            if (dataset.status != "stored") return reject("Error: Input dataset " + input + " has storage status '" + dataset.status + "' and cannot be used until it has been successfully stored.");
            if (dataset.removed == true) return reject("Error: Input dataset " + input + " has been removed and cannot be used.");
            
            if (!app_input) return reject("Error: This app's config does not include key '" + file_id + "'");
            
            if (app_input.datatype != dataset.datatype) {
                return reject("Given input of datatype " + datatypeTable[dataset.datatype].name + " but expected " + datatypeTable[app_input.datatype].name + " when checking " + input);
            }
            
            // validate dataset's datatype tags
            let userInputTags = {};
            dataset.datatype_tags.forEach(tag => userInputTags[tag] = 1);
            app_input.datatype_tags.forEach(tag => {
                if (tag.startsWith("!")) {
                    if (userInputTags[tag.substring(1)]) return reject("Error: This app requires that the input dataset for " + file_id + " should NOT have datatype tag '" + tag.substring(1) + "' but found it in " + input);
                } else {
                    if (!userInputTags[tag]) return reject("Error: This app requires that the input dataset for " + file_id + " have datatype tag '" + tag + "', but it is not set on " + input);
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
        let flattenedUserConfig = flattenConfig(opt.config, []);
        let values = {};
        
        Object.keys(flattenedConfig).forEach(key => {
            if (flattenedConfig[key].type != 'input') {
                let niceLookingKey = JSON.parse(key).join('.');
                
                // validate each user-given config parameter
                if (!flattenedUserConfig[key]) {
                    if (flattenedConfig[key].default) {
                        if (!opt.raw) console.log("No config entry found for key '" + niceLookingKey +
                                    "'; using the default value in the app's config: " + flattenedConfig[key].default);
                    } else {
                        return reject("Error: no config entry found for key'" + niceLookingKey + "' (type: " + (flattenedConfig[key].type) + "). Please provide one and rerun");
                    }
                }

                if (flattenedUserConfig[key] && /boolean|string|number/.test(flattenedConfig[key].type)) {
                    if (typeof flattenedUserConfig[key] != flattenedConfig[key].type) {
                        return reject("Error: config key '" + niceLookingKey + "': expected type '" + flattenedConfig[key].type + "' but given value of type '" + (typeof flattenedUserConfig[key]) + "'");
                    }
                }

                values[key] = flattenedUserConfig[key] || flattenedConfig[key].default;
            }
        });

        // create token for user-inputted datasets
        request.get({ headers, url: config.api.warehouse + "/dataset/token?ids=" + JSON.stringify(all_dataset_ids), json: true }, async (err, res, body) => {
            if (err) return reject(err);
            else if (res.statusCode != 200) return reject(res.body.message);
            
            let jwt = body.jwt;
            let userInputKeys = Object.keys(inputs);
            if (app.inputs.length != userInputKeys.length) return reject("Error: App expects " + app.inputs.length + " " + pluralize('input', app.inputs) + " but " + userInputKeys.length + " " + pluralize('was', userInputKeys) + " given"); // validate app
            
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
                if (err) return reject(err);
                else if (res.statusCode != 200) return reject(res.body.message);
                if (!opt.raw) console.log("Data Staging Task Created (" + body.task._id + ")");
                
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
                    if (err) return reject(err);
                    else if (res.statusCode != 200) return reject("Error: " + res.body.message);

                    let appTask = body.task;
                    if (!opt.raw) console.log(app.name + " task for app '" + app.name + "' has been created.\n" +
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
         * @returns {any}
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
         * @returns {Promise<{ resource: string, considered: resource[] }>}
         */
        function getResource(headers, service) {
            return new Promise((resolve, reject) => {
                request.get(config.api.wf + '/resource/best', {
                    headers,
                    qs: { service: service },
                    json: true
                }, (err, res, body) => {
                    if (err) reject(err);
                    else if (res.statusCode != 200) return reject("Error: " + res.body.message || res.statusMessage);
                    resolve(body);
                });
            });
        }
        
        /**
         * Query github with the given service and branch
         * @param {string} service 
         * @param {string} branch 
         * @returns {Promise<Response>}
         */
        function queryGithub(service, branch) {
            return new Promise((resolve, reject) => {
                request.get('https://github.com/' + service + '/tree/' + branch, {}, (err, res, body) => {
                    if (err) return reject(err);
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
 * @param {(error: string) => any} cb 
 */
function waitForArchivedDatasets(headers, task, verbose, cb) {
    if (!task.config || !task.config._outputs) return cb();
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
function waitForFinish(headers, task, verbose, cb) {
    if(wait_gear++ > gearFrames.length) wait_gear = 0;

    var find = {_id: task._id};
    request.get({ url: config.api.wf + "/task?find=" + JSON.stringify({_id: task._id}), headers, json: true}, (err, res, body) => {
        if(err) return cb(err, null);
        if (res.statusCode != 200) return reject(res.body.message);
        
        let task = body.tasks[0];
        if (task.status == "finished") {
            if(verbose) {
                terminalOverwrite.clear();
                terminalOverwrite("SERVICE: " + task.service + gearFrames[wait_gear] + "\n" +
                                    "STATUS: Successfully finished\n(" + timeago.ago(new Date(task.finish_date)) + ")");
                terminalOverwrite.done();
            }
            return waitForArchivedDatasets(headers, task, verbose, err=>{
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
function isValidObjectId(str) {
    return /^[a-f\d]{24}$/i.test(str);
}

/**
 * Return a pluralized string whether or not there are multiple objects
 * @param {string} string
 * @param {any[]} objects
 * @returns {string}
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
    queryAllDatatypes, queryAllApps, queryAllProfiles, queryAllProjects, queryAllDatasets, queryAllResources,
    resolveDatatypes, resolveApps, resolveProfiles, resolveProjects, resolveDatasets, resolveResources,
    getInstance, runApp,
    loadJwt, pluralize, isValidObjectId, waitForFinish, error, errorMaybeRaw
};
