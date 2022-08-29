#!/usr/bin/env node
'use strict';

const request = require('request-promise-native'); //deprecated.. use axios
const axios = require('axios');
const config = require('./config');
const fs = require('fs');
const jsonwebtoken = require('jsonwebtoken');
const path = require('path');
const mkdirp = require('mkdirp');

class UserError extends Error {}

class ArgError extends UserError {
    constructor(arg) {
        super();
        this.arg = arg;
    }
}

class ArgFileReadError extends ArgError {
    constructor(arg, path) {
        super(arg);
        this.path = path;
    }
}

exports.UserError = UserError;
exports.ArgError = ArgError;
exports.ArgFileReadError = ArgFileReadError;

/**
 * Validate a path exists and is readable
 * @param {string} path 
 * @returns {string} path
 */
exports.ensureArgFileRead = (path) => {
    try {
        fs.accessSync(path, fs.constants.R_OK);
        return path;
    } catch (error) {
        throw new ArgFileReadError(this.name(), path);
    }
}

/**
 * Validator for JSON file path
 * @param {string} path 
 * @returns {object} JSON content
 */
exports.ensureArgFileJSONRead = (path) => {
    try {
        fs.accessSync(path, fs.constants.R_OK);
        return JSON.parse(fs.readFileSync(path, 'utf-8'));
    } catch (error) {
        throw new ArgFileReadError(this.name(), path);
    }
}

/**
 * Handles general errors like arguments and Axios communitation
 * @param {Error} error 
 * @returns exit code
 */
exports.handleAppError = (program, error) => {
    if (error instanceof ArgFileReadError) {
        console.error(`Error: argument '${error.arg}' path not readable: '${error.path}'`);
    } else if (error instanceof ArgError) {
        console.error(`Error: required argument '${error.arg}' not specified`);
        console.error();
        program.outputHelp();
    } else if (error instanceof UserError) {
        console.error(`Error: ${error.message}`);
    } else if (error instanceof axios.AxiosError) {
        ;;; // handled in interceptor
    } else {
        console.error(`Error: ${error.message ?? error}`);
        console.trace(error);
    }
    return 1;
}

exports.login = async function (opt) {
    let url = config.api.auth;

    if (opt.ldap) url += "/ldap/auth";
    else url += "/local/auth";

    let jwt = null;

    try {
        const res = await axios.post(url, {
            username: opt.username,
            password: opt.password,
            ttl: 1000 * 60 * 60 * 24 * (opt.ttl || 1)
        });
        if (res.status != 200) throw new Error(res.data.message);
        jwt = res.data.jwt;
    } catch (err) {
        throw new Error(err.response.data.message);
    }

    let dirname = path.dirname(config.path.jwt);
    await mkdirp(dirname);

    fs.chmodSync(dirname, '700');
    fs.writeFileSync(config.path.jwt, jwt);
    fs.chmodSync(config.path.jwt, '600');

    return jwt;
}

exports.refresh = async function (opt, headers) {
    let url = config.api.auth + "/refresh";
    let res = await axios.post(url, {
        ttl: 1000 * 60 * 60 * 24 * (opt.ttl || 1)
    }, { headers });
    if (res.status != 200) throw new Error("Error: " + res.data.message);
    let dirname = path.dirname(config.path.jwt);
    await mkdirp(dirname);
    fs.chmodSync(dirname, '700');
    fs.writeFileSync(config.path.jwt, res.data.jwt);
    fs.chmodSync(config.path.jwt, '600');
    return res.data.jwt;
}

/**
 * Load the user's jwt token
 * @returns {string}
 */
exports.loadJwtSync = () => {
    try {
        const jwtFile = config.path.jwt;
        if (!fs.existsSync(jwtFile))
            throw Error("Please log-in first using 'bl login'.");
        const jwt = fs.readFileSync(jwtFile, "ascii").trim();
        const payload = jsonwebtoken.decode(jwt);
        if (!payload)
            throw Error("Failed to read your credentials. Please log-in using 'bl login'.");
        if (payload.exp < Date.now() / 1000)
            throw Error("Your credentials have expired. Please log-in using 'bl login'.");
        return jwt;
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
exports.loadJwt = async () => exports.loadJwtSync();

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
    }
    
    if (project) andQueries.push({ project });
    if (datatype) andQueries.push({ datatype });
    if (query.subject) andQueries.push({ "meta.subject": query.subject });
    if (query.session) andQueries.push({ "meta.session": query.session});
    if (query.run) andQueries.push({ "meta.run": query.run});
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

//TODO GET rid of this
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

exports.queryProjects = async (headers, query, opt) => {
    if(!query) query = {};
    if(!opt) opt = {};

    let projectAdmin = null;
    let projectMember = null;
    let projectGuest = null;
    if (query.admin) projectAdmin = await exports.resolveProfiles(headers, query.admin);
    if (query.member) projectMember = await exports.resolveProfiles(headers, query.member);
    if (query.guest) projectGuest = await exports.resolveProfiles(headers, query.guest);
    let find = { removed: false }, andQueries = [], orQueries = [];

    if (query.id) {
        if (!exports.isValidObjectId(query.id))
            throw new Error('Not a valid object id: ' + query.id);
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

    const res = await http.get(
        `${config.api.warehouse}/project`,
        {
            ...(headers || {}),
            params: {
                find: JSON.stringify(find),
                sort: JSON.stringify({ name: 1 }),
                skip: opt.skip || 0,
                limit: opt.limit || 100
            }
        }
    );

    return res.data.projects;
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

exports.getDatatype = async function (headers, query) {
    const find = {};
    if (exports.isValidObjectId(query)) find._id = query;
    else find.name = query;

    const res = await http.get(config.api.warehouse + '/datatype', {
        ...(headers || {}),
        params: {
            find: JSON.stringify(find),
        }
    });

    if (res.data.datatypes.length == 0)
        throw Error(`The datatype ${query} was not found.`);
    return res.data.datatypes[0];
}

//TODO get rid off this
exports.resolveApps = function(headers, query, opt) {
    if (!query) return new Promise(r => r([]));
    if (exports.isValidObjectId(query)) return exports.queryApps(headers, { id: query }, opt);
    else return exports.queryApps(headers, { search: query }, opt);
}

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

    return request(config.api.amaretti + '/resource', { headers, json: true, 
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
exports.findOrCreateInstance = async (headers, instanceName, options) => {
    const find = { name: instanceName };
    const res = await http.get(
        `${config.api.amaretti}/instance`,
        {
            params: { find: JSON.stringify(find) },
            ...(headers || {})
        }
    )

    if (res.data?.instances[0])
        return res.data.instances[0];

    else {
        // need to create new instance
        const body = { name: instanceName, desc: options.desc };
        if (options.project) {
            body.config = { brainlife: true };
            body.group_id = options.project.group_id;
        }
        const res = await http.get(
            `${config.api.amaretti}/instance`,
            {
                params: { find: JSON.stringify(find) },
                ...(headers || {})
            }
        );
        return res.data?.instances[0];
    }
}

//Wait for datasets from task to be archived
exports.waitForArchivedDatasets = async (headers, datasetCount, task, verbose) => {
    while (true) {
        const res = await http.get(`${config.api.warehouse}/dataset`, {
            headers,
            params: {
                find: JSON.stringify({ 'prov.task_id': task._id })
            }
        });

        let failed = false;
        const storedDatasets = res.data.datasets.filter((dataset) => {
            if (verbose) console.error(`Object: ${dataset._id} ${dataset.status} ${dataset.status_msg}`);
            if (dataset.status === 'failed') failed = true;
            return dataset.status === 'stored';
        });

        if (failed) throw Error('Failed to archive the dataset.');
        if (storedDatasets.length == datasetCount) {
            return { task, datasets: storedDatasets };
        }

        await exports.sleep(5);
    }
}

exports.waitForFinish = async (headers, task, verbose) => {
    console.error();
    while (true) {
        const res = await http.get(
            `${config.api.amaretti}/task`,
            {
                headers,
                params: { find: JSON.stringify({ _id: task._id }) }
            }
        );

        if (res.data.tasks.length == 1) {
            const task = res.data.tasks[0];
            if (task.status === 'finished') {
                if (verbose)
                    console.error();

                const datasetCount = task.config?._outputs?.reduce(
                    (acc, output) => output.archive ? acc + 1 : acc, 0
                ) ?? 0;

                if (datasetCount == 0)
                    return { task, datasets: [] };
                if (verbose)
                    console.error('Waiting for output to be archived...');

                // If there is a validator, check for validation result
                if (task.name == "__dtv") {
                    if (verbose)
                        console.error(`Loading product for __dtv: ${task._id}...`);

                    const productRes = await http.get(
                        `${config.api.amaretti}/task/product`,
                        {
                            headers,
                            params: { ids: [task._id] }
                        }
                    );

                    if (productRes.data.length == 0)
                        throw Error('No validation result was found.');

                    const product = productRes.data[0].product;
                    if (verbose && product.warnings?.length > 0) {
                        console.error(`Warnings:`);
                        product.warnings.forEach(
                            warning => console.error(`- ${warning}`)
                        );
                        console.error();
                    }
                    if (product.errors?.length > 0)
                        throw Error(product.errors);
                }

                // Wait for datasets to be archived
                const { datasets } = await exports.waitForArchivedDatasets(
                    headers, datasetCount, task, verbose
                );

                console.error();
                return { task, datasets };

            } else if (task.status == "failed") {
                throw Error(task.status_msg);
            }
        }

        await exports.sleep(5);
    }
}

/**
 * Get a specific file from a task's output
 * @param {any} headers 
 * @param {string} filename 
 * @param {task} task 
 */
/*
exports.getFileFromTask = function(headers, filename, task) {
    return new Promise(async (resolve, reject) => {
        let fileBody = await request({
            url: config.api.amaretti + '/task/ls/' + task._id,
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
                url: config.api.amaretti + '/task/download/' + task._id+'/'+taskFile.filename,
                headers,
            });
            return resolve(result);
        } else {
            return reject("failed to load "+filename);
        }
    });
}
*/

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
exports.isValidObjectId = function(id) {
    return id.match(/^[0-9a-fA-F]{24}$/);
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
        if(err.response.data) {
            if(err.response.data.message) console.error(err.response.data.message);
            else console.error(err.response.data);
        } else console.error(err.response);
    } else if (err.request) {
        // The request was made but no response was received
        // `err.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        console.error(err.request);
    } else {
        // Something happened in setting up the request that triggered an Error
        console.error(err);
    }
    //console.error(err.config);
}

/**
 * 😴
 * @param {Number} seconds sleeping
 */
exports.sleep = async (secs) =>
    new Promise(resolve => setTimeout(resolve, secs * 1000));


/**
 * Spawn http client, handling common errors and authenticating when requested
 */
const http = axios.create();
http.authenticate = () => {
    http.defaults.headers.common.Authorization = `Bearer ${exports.loadJwtSync()}`;
}
http.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response) {
            if (error.response.status == 401) {
                console.error(`You do not have permission to this project. Please check your credentials.`);
            }
        } else {
            console.error(`There was an error communicating with Brainlife. Please try again later.`);
        }
        throw error;
    }
);
exports.http = http;
