#!/usr/bin/env node
'use strict';

const request = require('request-promise-native'); //deprecated..
const axios = require('axios');
const config = require('./config');
const fs = require('fs');
const jsonwebtoken = require('jsonwebtoken');
const timeago = require('time-ago');
const async = require('async');
const tar = require('tar');
const terminalOverwrite = require('terminal-overwrite');
const path = require('path');
const mkdirp = require('mkdirp');
const prompt = require('prompt');
const colors = require('colors');

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

exports.login = function(opt) {
    return new Promise((resolve, reject) => {
        let url = config.api.auth;

        if(opt.ldap) url += "/ldap/auth";
        else url += "/local/auth";

        axios.post(url, {username: opt.username, password: opt.password, ttl: 1000*60*60*24*(opt.ttl || 1)}).then(res=>{
            if(res.status != 200) throw new Error("Error: " + res.data.message);
            let dirname = path.dirname(config.path.jwt);
            mkdirp(dirname).then(err=>{
                fs.chmodSync(dirname, '700');
                fs.writeFileSync(config.path.jwt, res.data.jwt);
                fs.chmodSync(config.path.jwt, '600');
                return resolve(res.data.jwt);
            });
        });
    });
}

exports.refresh = async function(opt, headers) {
    let url = config.api.auth+"/refresh";
    let res = await axios.post(url, {ttl: 1000*60*60*24*(opt.ttl || 1)}, {headers});
    if(res.status != 200) throw new Error("Error: " + res.data.message);
    let dirname = path.dirname(config.path.jwt);
    await mkdirp(dirname);
    fs.chmodSync(dirname, '700');
    fs.writeFileSync(config.path.jwt, res.data.jwt);
    fs.chmodSync(config.path.jwt, '600');
    return res.data.jwt;
}

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
            let jwt = fs.readFileSync(config.path.jwt, "ascii").trim();
            let dec = jsonwebtoken.decode(jwt);
            if(!dec) return reject("Failed to decode you access token. Please try logging in by running 'bl login'");
            if(dec.exp < Date.now()/1000) return reject("You access token is expired. Please try logging in by running 'bl login'.");
            
            resolve(jwt); 
        });
    });
}

exports.queryProfiles = function(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    return new Promise(async (resolve, reject) => {
        let body = await request(config.api.auth + '/profile/list', {
            headers,
            json: true,
            qs: {
                limit: opt.limit||0,
                offset: opt.skip||0,
                find: JSON.stringify({active: true}),
            } 
        });
        let profiles = body.profiles;

        //TODO - I should apply search query to the API instad (I can't until I migrate to mongo)
        if (query.id || query.search) {
            profiles = profiles.filter(profile => {
                let showProfile = false;
                if (query.id) {
                    showProfile = showProfile || profile.sub == query.id;
                }
                if (query.search) {
                    let pattern = new RegExp(escapeRegExp(query.search), 'ig');
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

//TODO get rid of this - merged into queryProfiles?
exports.queryAllProfiles = function(headers) {
    return request(config.api.auth + '/profile/list', {
        headers,
        json: true,
        qs: {
            limit: 0,
            offset: 0,
            where: JSON.stringify({active: true}),
        }
    }).then(body=>{
        return body.profiles;
    });
}

//TODO get rid of this
exports.resolveProfiles = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryProfiles(headers, { query }, opt);
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
        let findQuery = {name: query.datatype};
        if (exports.isValidObjectId(query.datatype)) findQuery = {_id: query.datatype};
        let body = await request(config.api.warehouse + '/datatype', { headers, json: true, qs: {
            find: JSON.stringify(findQuery),
            limit: 1,
        }});
        if (body.datatypes.length != 1) throw new Error("No datatypes found matching '" + query.datatype + "'");
        datatype = body.datatypes[0]._id;
    }
    
    if (query.project) {
        let projectSearch = {};
        let projects = await exports.resolveProjects(headers, query.project);
        if (projects.length == 0) throw new Error("No projects found matching '" + query.project + "'");
        if (projects.length > 1) throw new Error("Multiple projects found matching '" + query.project + "'");
        project = projects[0]._id;
    }
    
    let find = {};
    let andQueries = [];
    let orQueries = [];

    if(query.pub) {
        andQueries.push({ publications: query.pub });
    } else {
        //hide removed dataset unless we are querying for publication. this is UGLY.. but I'd like to maintain 
        //common behavior across all queryXX which hides removed records by default.
        find.removed = false; 
    }

    if (query.id) {
        if (!exports.isValidObjectId(query.id)) throw new Error('Not a valid object id: ' + query.id);
        orQueries.push({ _id: query.id });
    }
    if (query.search) {
        orQueries.push({ name: { $regex: escapeRegExp(query.search), $options: 'ig' } });
        orQueries.push({ desc: { $regex: escapeRegExp(query.search), $options: 'ig' } });
    }
    
    if (query.tags) {
        let pos_tags = [];
        let neg_tags = [];
        query.tags.forEach(tag => {
            if (tag[0] != "!") pos_tags.push(tag);
            else neg_tags.push(tag.substring(1));
        });
        if(pos_tags.length > 0) andQueries.push({tags: {$all:pos_tags}});
        if(neg_tags.length > 0) andQueries.push({tags: {$nin:neg_tags}});
    }

    if (query.datatypeTags) {
        let pos_tags = [];
        let neg_tags = [];
        query.datatypeTags.forEach(tag => {
            if (tag[0] != "!") pos_tags.push(tag);
            else neg_tags.push(tag.substring(1));
        });
        if(pos_tags.length > 0) andQueries.push({datatype_tags: {$all:pos_tags}});
        if(neg_tags.length > 0) andQueries.push({datatype_tags: {$nin:neg_tags}});
        /*
        query.datatypeTags.forEach(tag => {
            if (tag.startsWith("!")) andQueries.push({ datatype_tags: { $not: { $elemMatch: { $eq: tag.substring(1) } } } });
            else {
                andQueries.push({ datatype_tags: { $elemMatch: { $eq: tag } } });
            }
        });
        */
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

//TOD GET rid of this
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

//TODO - get rid of this
exports.resolveDatasets = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryDatasets(headers, { id: query }, opt);
    else {
        return exports.queryDatasets(headers, { search: query }, opt);
    }
}

exports.queryProjects = async function(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    let projectAdmin = null;
    let projectMember = null;
    let projectGuest = null;
    if (query.admin) projectAdmin = await exports.resolveProfiles(headers, query.admin);
    if (query.member) projectMember = await exports.resolveProfiles(headers, query.member);
    if (query.guest) projectGuest = await exports.resolvePRofiles(headers, query.guest);
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
        andQueries.push({ admins: { $in: projectAdmin.map(p=>{return p.sub})} });
    }
    if (projectMember) {
        andQueries.push({ members: { $in: projectMember.map(p=>{return p.sub})} });
    }
    if (projectGuest) {
        andQueries.push({ quests: { $in: projectQuest.map(p=>{return p.sub})} });
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
}

exports.queryPubs = async function(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    
    let pubAuthors = null;
    if (query.author) pubAuthors = await exports.resolveProfiles(headers, query.author);
    
    let find = { removed: false }, andQueries = [], orQueries = [];
    
    if (query.id) {
        if (!exports.isValidObjectId(query.id)) throw new Error('Not a valid object id: ' + query.id);
        orQueries.push({ _id: query.id });
    }
    if (query.search) {
        orQueries.push({ name: { $regex: escapeRegExp(query.search), $options: 'ig' } });
        orQueries.push({ desc: { $regex: escapeRegExp(query.search), $options: 'ig' } });
    }
    
    if (pubAuthors) {
        andQueries.push({ authors: { $in: pubAuthors.map(p=>{return p.sub})} });
    }
    if (query.doi) {
        andQueries.push({ doi: { $regex: escapeRegExp(query.doi), $options: 'ig'} });
    }

    if (orQueries.length > 0) andQueries.push({ $or: orQueries });
    if (andQueries.length > 0) find.$and = andQueries;

    return request(config.api.warehouse + '/pub', { headers, json: true, 
        qs: {
            find: JSON.stringify(find),
            sort: JSON.stringify({ name: 1 }),
            skip: opt.skip || 0,
            limit: opt.limit || 100
        }
    }).then(body=>{
        return body.pubs;
    });
}

//TODO get rid off this
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

//TODO get rid off this with > let projects = await util.queryProjects(headers, {id: query.project, search: query.project});
exports.resolveProjects = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryProjects(headers, { id: query }, opt);
    else return exports.queryProjects(headers, { search: query }, opt);
}

/*
//TODO - can we get rid of this and use waitForArchivedDatasets somehow? If 
//wait for the dataset become "stored" state (archive)
exports.waitForDataset = function(headers, dataset_id, cb) {
    request(config.api.warehouse+'/dataset', { json: true, headers, qs: {
        find: JSON.stringify({_id: dataset_id}),
    } }, (err, res, body) => {
        if (err) return cb(err);
        if (res.statusCode != 200) return cb(res.body.message);
        if(body.datasets.length == 0) return cb("no such dataset");
        let dataset = body.datasets[0];
        if(dataset.status == "stored") return cb(); //stored!
        console.error(dataset.status+" .. "+dataset.status_msg);
        setTimeout(()=>{
            exports.waitForDataset(headers, dataset_id, cb);
        }, 3000);
    });
}
*/

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
            input_datatypes.push(await exports.getDatatype(headers, input));
        }
    }
    if (query.outputs) {
        for (let output of query.outputs) {
            output_datatypes.push(await exports.getDatatype(headers, output));
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
    
    //TODO - I should probably use $all and $nin instead of $elemMAtch
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
    
    let find = { removed: false };
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
}

exports.getDatatype = function(headers, query) {
    return new Promise(async (resolve, reject) => {
        request(config.api.warehouse + '/datatype', { headers, json: true,
            qs: {
                find: JSON.stringify({
                    $or: [ {id: query}, {name: query}, ]
                }),
            } 
        }).then(body=>{;
            if(body.datatypes.length == 0) return reject("no matching datatype:"+query);
            return resolve(body.datatypes[0]);
        });
    });
}

//TODO get rid off this
exports.resolveApps = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryApps(headers, { id: query }, opt);
    else return exports.queryApps(headers, { search: query }, opt);
}

/*
exports.queryDatatypes = function(headers, query, opt) {
    if(!query) query = {};
    if(!opt) opt = {};
    let orQueries = [], find = {};
    if (query.id) {
        if (!exports.isValidObjectId(query.id)) throw new Error('Not a valid object id: ' + query.id);
        orQueries.push({ _id: query.id });
    }
    if (query.name) {
        orQueries.push({ name: query.name });
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
*/

//TODO get rid of this
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

/*
exports.resolveDatatypes = function(headers, datatype, opt) {
    if (!datatype) return new Promise(r => r([])); //TODO what is this?
    if (exports.isValidObjectId(datatype)) return exports.queryDatatypes(headers, { id: datatype }, opt);
    else return exports.queryDatatypes(headers, { name: datatype }, opt);
}
*/

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
        //TODO I think I can just do "config.services.name": query.service
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

//TODO get rid of this
exports.resolveResources = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryResources(headers, { id: query }, opt);
    else return exports.queryResources(headers, { search: query }, opt);
}

/**
 * Find or create an instance for a service
 * @param {any} headers
 * @param {string} instanceName
 * @param {Object} options
 * @param {project} options.project
 * @param {string} options.desc
 * @returns {Promise<instance>}
 */
exports.findOrCreateInstance = function(headers, instanceName, options) {
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

exports.runApp = function(headers, opt) {
    return new Promise(async (resolve, reject) => {
        let datatypeTable = {};
        let all_dataset_ids = [];
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
            //if (!opt.json) console.log("found app input key '" + input.id + "'");
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

        //make sure all required inputs are set
        let missing_inputs = app.inputs.filter(input=>{
            return (!input.optional && inputs[input.id] === undefined);
        });
        if(missing_inputs.length > 0) return reject("some required inputs are missing:"+missing_inputs.map(input=>input.id).toString());

        // create instance
        let instanceName = (apps[0].tags||'CLI Process') + "." + (Math.random());
        let instance = await exports.findOrCreateInstance(headers, instanceName, { project, desc: "(CLI) " + app.name });
        
        // prepare config to submit the app
        let values = {};
        for (let key in app.config) {
            let appParam = app.config[key];
            let userParam = opt.config[key];
            
            if (appParam.type != 'input') {
                if(userParam === undefined) userParam = appParam.default;
                values[key] = userParam;
            }
        }
            
        //enumerate all datasets
        let dataset_ids = [];
        app.inputs.forEach(input => {
            inputs[input.id].forEach(user_input=>{
                dataset_ids.push(user_input._id);
            });
        });
        dataset_ids = [...new Set(dataset_ids)]; //TODO - api does this now so I don't have to do it.

        //TODO - similar code exists on UI modals/appsubmit.vue
        request.post({url: config.api.warehouse+'/dataset/stage', json: true, headers,
            body: {
                instance_id: instance._id,
                dataset_ids,
            }
        }, (err, res, body)=>{
            if(err) return reject(err);
            if(res.statusCode != 200) return reject(res.body.message);
            let task = body.task;
            if(!opt.json) console.log("Data Staging Task Created (" + task._id + ")");

            let app_inputs = [];
            app.inputs.forEach(input => {
                //find config.json key mapped to this input
                let keys = [];
                for (let key in app.config) {
                    if(app.config[key].input_id == input.id) {
                        keys.push(key);
                    }
                }

                //for each input, find dataset info from staged job
                inputs[input.id].forEach(user_input=>{
                    let dataset = task.config._outputs.find(output=>output.dataset_id == user_input._id);
                    app_inputs.push(Object.assign({}, dataset, {
                        id: input.id,
                        task_id: task._id,
                        keys,
                    }));
                });
            });
            
            //aggregate meta
            //TODO - this just concatenate *all* meta from all input datasets.. I should probaby do something smarter..
            let meta = app_inputs.reduce((meta, dataset)=>{
                for(var k in dataset.meta) if(!meta[k]) meta[k] = dataset.meta[k]; //use first one
                return meta;
            }, {});

            let app_outputs = [];
            app.outputs.forEach(output=>{
                let output_req = {
                    id: output.id, 
                    datatype: output.datatype,
                    desc: output.desc||app.name, //what is this for?
                    tags: opt.tags,
                    meta,
                    archive: {
                        project: project._id,
                        desc: output.id + " from " + app.name
                    },
                };

                if(output.output_on_root) {
                    output_req.files = output.files; //optional
                } else {
                    output_req.subdir = output.id;
                }
                
                app_outputs.push(output_req);
            });
            
            // finalize app config object
            let preparedConfig = prepareConfig(values, task, inputs, datatypeTable, app);
            Object.assign(preparedConfig, {
                _app: app._id,
                _tid: task.config._tid+1,
                _inputs: app_inputs,
                _outputs: app_outputs,
            });

            //console.log(JSON.stringify(preparedConfig, null, 4));
            
            // prepare and run the app task
            let submissionParams = {
                instance_id: instance._id,
                name: app.name.trim(),
                service: app.github,
                service_branch: branch,
                config: preparedConfig,
                deps_config: [ {task: task._id} ],
            };
            if (resource) submissionParams.preferred_resource_id = resource;
            request.post({ url: config.api.wf + "/task", headers, json: true, body: submissionParams }, (err, res, body) => {
                if (err) return reject(err);
                else if (res.statusCode != 200) return reject(res.body.message);
                if (!opt.json) console.log(app.name + " task for app '" + app.name + "' has been created.\n" +
                            "To monitor the app as it runs, please execute \nbl app wait " + body.task._id);
                
                resolve(body.task);
            });
        });

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
exports.waitForArchivedDatasets = function(headers, task, verbose, cb) {
    if (!task.config || !task.config._outputs) return cb();
    let expected_outputs = task.config._outputs.filter(output=>output.archive);

    console.log("waiting to archive", task);
    console.dir(task);

    if(verbose) console.log("Waiting for output datasets: ", expected_outputs);
    request(config.api.warehouse + '/dataset', { json: true, headers, qs: {
        find: JSON.stringify({'prov.task_id': task._id}),
    } }, (err, res, body) => {
        if (err) return cb(err);
        if (res.statusCode != 200) return cb(res.body.message);
        let stored_datasets = body.datasets.filter(dataset=>{
            if(verbose) console.log(dataset._id+"("+dataset.status+") "+dataset.status_msg);
            return (dataset.status == "stored");
        });
        if(stored_datasets.length < expected_outputs.length) {
            //if(verbose) console.log(expected_outputs.length+" of "+stored_datasets.length+" datasets archived");
            //not all datasets archived yet.. wait
            return setTimeout(()=>{
                exports.waitForArchivedDatasets(headers, task, verbose, cb); 
            }, 1000*5);
        } else {
            //if(verbose) console.log("Done archiving");
            return cb(null, stored_datasets);
        }
    });
}

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
                terminalOverwrite(task.name + "("+task.service + ")"+ gearFrames[wait_gear] + "\n" + "finished\n(" + timeago.ago(new Date(task.finish_date)) + ")");
                terminalOverwrite.done();
            }
            exports.waitForArchivedDatasets(headers, task, verbose, err=>{
                cb(err, task);
            });
        } else if (task.status == "failed") {
            if(verbose) {
                terminalOverwrite.clear();
                terminalOverwrite(task.name + "("+ task.service + ")\n" + " failed");
                terminalOverwrite.done();
            }
            cb(task.status_msg, null);
        } else {
            if(verbose) {
                terminalOverwrite.clear();
                terminalOverwrite(task.name + "("+task.service + ")"+ gearFrames[wait_gear] + "\n" + task.status_msg + "\n(running since " + timeago.ago(new Date(task.create_date)) + ")");
            }
            setTimeout(function() {
                exports.waitForFinish(headers, task, verbose, cb);
            }, 1000);  //too short for wait command?
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
                url: config.api.wf + '/task/download/' + task._id+'/'+taskFile.filename,
                /*
                qs: {
                    p: taskFile.filename
                },
                */
                headers,
            });
            return resolve(result);
        } else {
            return reject(defaultErr);
        }
    });
}

//TODO - not very effective - as user can easily go around this check by directly accessing to our REST API. 
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

//remove "." in object keys as it screws up mongo db
exports.escape_dot = function(obj) {
    if(typeof obj == "object") {
        for(let key in obj) {
            exports.escape_dot(obj[key]);
            if(key.includes(".")) {
                let newkey = key.replace(/\./g, '-');
                obj[newkey] = obj[key];
                delete obj[key];
            }
        }
    }
    return obj;
}

exports.parseParticipantTSV = function(tsv) {
    let participants = [];
    tsv = tsv.map(line=>line.trim()); //remove \r
    //console.log("loading participants.tsv (or -data.tsv)", root);
    let tsv_head = exports.escape_dot(tsv.shift().split("\t"));
    
    //look for subject header..
    let subject_col = 0; //first one by default..
    [ "Observations", "participant_id" ].forEach(key=>{
        let col = tsv_head.indexOf(key);
        if(~col) subject_col = col;
    });
    tsv.forEach(row=>{
        let cols = row.trim().split("\t");
        let subject = cols[subject_col];
        if(subject.toLowerCase().startsWith("sub-")) subject = subject.substring(4);
        let participant = {subject};
        cols.forEach((col, idx)=>{
            if(idx == subject_col) return;
            participant[tsv_head[idx]] = col.trim();
        });
        participants.push(exports.escape_dot(participant));
    });

    return participants;
}

exports.handleAxiosError = function(err) {
    if (err.response) {
        console.error(err.response.data);
        console.error(err.response.status);
        console.error(err.response.headers);
    } else if (err.request) {
        // The request was made but no response was received
        // `err.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        console.error(err.request);
    } else {
        // Something happened in setting up the request that triggered an Error
        console.error('Error', err.message);
    }
    console.error(err.config);
}
