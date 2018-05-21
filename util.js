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
]

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
 * Filter profiles by user string
 * (since server side filtering is not supported by the api)
 * @param {profile[]} data
 * @param {string} queries
 */
function filterProfiles(data, queries) {
    let pattern = new RegExp((queries || '').split(delimiter).map(q => escapeRegExp(q.trim())).filter(q => q.length > 0).join('|'), 'ig');
    return data.filter(d => pattern.test(d.username) || pattern.test(d.fullname) || pattern.test(d.email));
}

/**
 * Query the list of profiles
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
            else {
                resolve(data.profiles);
            }
        })
        .catch(console.error);
    });
}

/**
 * Query the list of datasets
 * @param {string} search
 * @param {string} datatypes
 * @returns {Promise<dataset[]>}
 */
function queryDatasets(headers, search, datatypes, projects, subject) {
    return new Promise((resolve, reject) => {
        let searches = (search || '').split(delimiter);
        let dtypeids;
        
        let datas = datatypes.split(',').map(q => parseDatatypeString(q));
        let tags = [], dtypes = [];
        datas.forEach(data => {
            tags = tags.concat(data.tags);
            dtypes.push(data.datatype);
        });
        let tagSearch = tags.map(x => escapeRegExp(x.trim())).join('|');

        queryDatatypes(headers, dtypes.join(','))
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
                    if (tagSearch.length > 0) {
                        andQueries.push({ datatype_tags: { $elemMatch: { $regex: tagSearch } } });
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
                else {
                    resolve(data.datasets);
                }
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
        console.log("Streaming dataset to " + id);

        fs.mkdir(id, err => {
            request.get({ url: config.api.warehouse+"/dataset/download/" + id, headers })
            .on('response', res => {
                if(res.statusCode != 200) throw "Error: " + res.body.message;
            }).pipe(tar.x({ C: id }));
        });
    });
}

/**
 * Query the list of projects
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
            else {
                resolve(data.projects);
            }
        })
        .catch(console.error);
    });
}

/**
 * Query the list of apps
 * @param {string} search
 * @param {string} inputs
 * @param {string} outputs
 * @returns {Promise<app[]>}
 */
function queryApps(headers, search, inputs, outputs) {
    return new Promise((resolve, reject) => {
        let vm = {};
        let searches = (search || '').split(delimiter);
        let datas = (inputs || '').split(',').map(q => parseDatatypeString(q));
        let tags = [], dtypes = [];
        
        datas.forEach(data => {
            tags = tags.concat(data.tags);
            dtypes.push(data.datatype);
        });
        let inputTagSearch = tags.map(x => escapeRegExp(x.trim())).join('|');
        let inputDatatypeSearch = dtypes.map(x => escapeRegExp(x.trim())).join('|');
        
        datas = (outputs || '').split(',').map(q => parseDatatypeString(q));
        tags = []; dtypes = [];
        datas.forEach(data => {
            tags = tags.concat(data.tags);
            dtypes.push(data.datatype);
        });
        let outputTagSearch = tags.map(x => escapeRegExp(x.trim())).join('|');
        let outputDatatypeSearch = dtypes.map(x => escapeRegExp(x.trim())).join('|');
        
        queryDatatypes(headers, inputDatatypeSearch)
        .then(inputDatatypes => {
            vm.inputDatatypes = inputDatatypes.map(x => x._id);
            return queryDatatypes(headers, outputDatatypeSearch);
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
                        if (inputTagSearch.length > 0) {
                            andQueries.push({ inputs: { $elemMatch: 
                                { $and: [
                                    { datatype: { $in: vm.inputDatatypes } },
                                    { datatype_tags: { $elemMatch: { $regex: inputTagSearch } } } ] } } });
                        }
                        else {
                            andQueries.push({ inputs: { $elemMatch: { datatype: { $in: vm.inputDatatypes } } } });
                        }
                    }
                    if (vm.outputDatatypes.length > 0) {
                        if (outputTagSearch.length > 0) {
                            andQueries.push({ outputs: { $elemMatch: 
                                { $and: [
                                    { datatype: { $in: vm.outputDatatypes } },
                                    { datatype_tags: { $elemMatch: { $regex: outputTagSearch } } } ] } } });
                        }
                        else {
                            andQueries.push({ outputs: { $elemMatch: { datatype: { $in: vm.outputDatatypes } } } });
                        }
                    }

                    if (orQueries.length > 0) andQueries.push({ $or: orQueries });
                    if (andQueries.length > 0) find.$and = andQueries;
                    return { find, sort: { name: 1 } };
                }, headers)
            .then((data, err) => {
                if (err) throw err;
                else {
                    // then query the list of apps matching the given datatype tags
                    resolve(data.apps);
                }
            }).catch(console.error);
        }).catch(console.error);
    });
}

/**
 * Query the list of datatypes
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
            else {
                resolve(data.datatypes);
            }
        }).catch(console.error);
    });
}

/**
 * Query a url for information
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
    .map(x => x + "=" + (/find|sort/.test(x) ? JSON.stringify(options[x]) : options[x]))
    .join('&');
    if (params.length > 0) url += '?';
    
    return new Promise((resolve, reject)=>{
        request.get({url: url + params, headers: headers, json: true}, function(err, res, body) {
            if (res.statusCode != 200) {
                throw "Error: " + res.body.message;
            }
            if(err) throw new Error(res);
            return resolve(body);
        });
    });
}

/**
 * Update a project
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
            if (projects.length != 1) throw "Error: invalid project id";

            if (updates.admins && updates.admins.trim().length > 0) {
                updates.admins = updates.admins.split(",").map(username => {
                    username = username.trim();
                    if (profileTable[username]) return profileTable[username].id;
                    else {
                        throw "Error: no user found with username '" + username + "'when checking admins";
                    }
                })
            }
            if (updates.members && updates.members.trim().length > 0) {
                updates.members = updates.members.split(",").map(username => {
                    username = username.trim();
                    if (profileTable[username]) return profileTable[username].id;
                    else {
                        throw "Error: no user found with username '" + username + "'when checking members";
                    }
                })
            }
            if (updates.guests && updates.guests.trim().length > 0) {
                username = username.trim();
                updates.guests = updates.guests.split(",").map(username => {
                    if (profileTable[username]) return profileTable[username].id;
                    else {
                        throw "Error: no user found with username '" + username + "'when checking guests";
                    }
                })
            }

            let updateValues = toNonNullObject(updates);
            if (Object.keys(updateValues) == 0) throw "Error: no values to update project with";

            request.put(config.api.warehouse + "/project/" + projects[0]._id, { json: updateValues, updateValues, headers: headers }, (err, res, body) => resolve(body));
        })
    });
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
                    if(err) return reject(err);
                    resolve(body);
                });
            }
        });
    });
}

/**
 * Get the best resource for a service
 * @param {any} headers
 * @param {string} service
 * @returns {Promise<string>}
 */
function getBestResource(headers, service) {
    return new Promise((resolve, reject)=>{
        request.get({url: config.api.wf + "/resource/best?service=" + service, headers: headers, json: true}, function(err, res, body) {
            if(err) return reject(err);
            if(res.statusCode != 200) return reject(res.statusCode);
            if(!body.resource) return reject("Error: no resource found that runs service " + service);
            resolve(body.resource);
        });
    });
}

/**
 * Run a Brain Life application
 * @param {any} headers
 * @param {string} appSearch
 * @param {string} inputSearch
 * @param {string} projectSearch
 */
function runApp(headers, appSearch, inputSearch, projectSearch, userConfig) {
    let datatypes, inputs, app, instance, project;
    let datatypeTable = {};
    let app_inputs = [], app_outputs = [];
    let output_metadata = {};
    let instanceName;
    
    userConfig = userConfig || '{}';
    try {
        userConfig = JSON.parse(userConfig);
    }
    catch (exception) {
        throw 'Error: Could not parse JSON Config Object';
    }

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
        if (_apps.length == 0) throw "Error: No apps found matching " + appSearch;
        if (_apps.length > 1) throw "Error: Invalid ID '" + appSearch + "'";
        app = _apps[0];
        instanceName = (app.tags||'CLI Process') + "." + (Math.random());
        
        return queryProjects(headers, projectSearch);
    })
    .then(_projects => {
        if (_projects.length == 0) throw "Error: No projects found matching " + projectSearch;
        if (_projects.length > 1) throw "Error: Invalid ID '" + projectSearch + "'";
        project = _projects[0];

        return getInstance(headers, instanceName, { project, desc: "(CLI) " + app.name });
    })
    .then(instance => {
        let all_dataset_ids = inputs.map(x => x._id);
        let flattenedConfig = flattenConfig(app.config, []);
        let flattenedUserConfig = flattenConfig(userConfig, []);
        let values = {};
        
        Object.keys(flattenedConfig).forEach(key => {
            if (flattenedConfig[key].type != 'input') {
                let niceLookingKey = JSON.parse(key).join('.');
                if (!flattenedUserConfig[key]) {
                    if (flattenedConfig[key].default) {
                        console.log("No config entry found for key '" + niceLookingKey +
                                    "'; using the default value in the app's config: " + flattenedConfig[key].default);
                    }
                    else {
                        throw 	"Error: no config entry found for key'" + niceLookingKey + "' (type: " + 
                                (flattenedConfig[key].type) + "). Please provide one and rerun";
                    }
                }
                
                if (flattenedUserConfig[key] && /boolean|string|number/.test(flattenedConfig[key].type)) {
                    if (typeof flattenedUserConfig[key] != flattenedConfig[key].type) {
                        throw 	"Error: config key '" + niceLookingKey + "': expected type '" + flattenedConfig[key].type + 
                                "' but given value of type '" + (typeof flattenedUserConfig[key]) + "'";
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

        request.get({ headers, url: config.api.warehouse + "/dataset/token?ids=" + JSON.stringify(all_dataset_ids), json: true }, (err, res, body) => {
            if (err) throw err;

            let jwt = body.jwt;
            if (app.inputs.length != inputs.length) throw "Error: App expects " + app.inputs.length + " inputs but " + inputs.length + " were given";

            let sorted_app_inputs = app.inputs.sort((a, b) => a._id > b._id);
            let sorted_user_inputs = inputs.sort((a, b) => a._id > b._id);

            // type validation
            sorted_user_inputs.forEach((input, idx) => {
                if (input.datatype != sorted_app_inputs[idx].datatype) {
                    throw "Error: Input " + (idx + 1) + " (dataset id " + input._id + ") has datatype " + datatypeTable[input.datatype].name + " but expected " + datatypeTable[sorted_app_inputs[idx].datatype].name;
                }
                let sorted_app_dtags = sorted_app_inputs[idx].datatype_tags.sort((a,b) => a > b);
                let sorted_user_dtags = input.datatype_tags.sort((a,b) => a > b);
                
                // datatype tag validation, if you want to do that sort of thing
                
                // let invalid_dtags_error = "Error: Input " + (idx+1) + " (dataset id " + input._id + " with datatype " + datatypeTable[input.datatype].name + ") has datatype tags [" + input.datatype_tags.join(', ') + "] but expected [" + sorted_app_inputs[idx].datatype_tags.join(', ') + "]";

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
                app_inputs.push(Object.assign({ keys: [ datatypeToAppInput[input.datatype].id ] }, output));

                for (var k in user_input.meta) {
                    if (!output_metadata[k]) output_metadata[k] = user_input.meta[k];
                }
            });

            request.post({ headers, url: config.api.wf + "/task", json: true, body: {
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
                    if (err) throw err;
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
                        if (err) throw err;
                        if (res.statusCode != 200) throw "Error: " + res.body.message;

                        let appTask = body.task;
                        console.log(app.name + " Task for app '" + app.name + "' has begun.\n" + 
                                    "To monitor the app as it runs, please execute \nbl app monitor --id " + appTask._id);

                        // waitForFinish(headers, appTask, 0, (err, appTask) => {
                        // 	if (err) throw err;
                        // 	console.log("Data will be automatically archived to Project '" + project.name + "'");
                        // });
                    });
                });
            })
        });
    }).catch(console.error);

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
                if (userInput.multi) throw "Error: Arrays not yet supported as input types";
                flattenedCalculatedConfig[path] = "../" + download_task._id + "/" + userInput._id + "/" + (inputDtypeFile.filename||inputDtypeFile.dirname);
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
}

/**
 * Upload a dataset
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
            if (datatypes.length > 1) throw "Error: " + datatypes.length + " possible results found matching datatype '" + datatypeSearch + "'";
            return queryProjects(headers, projectSearch);
        }).then(projects => {
            if (projects.length == 0) throw "Error: Project not found";
            if (projects.length > 1) throw "Error: " + projects.length + " possible results found matching project '" + projectSearch + "'";

            let taropts = ['-czh'];

            let datatype = datatypes[0];
            let project = projects[0];

            async.forEach(datatype.files, (file, next_file)=>{
                console.log("Looking for " + directory + "/" + (file.filename||file.dirname));
                fs.stat(directory + "/" + file.filename, (err,stats)=>{
                    if(err) {
                        if (file.dirname) {
                            fs.stat(directory + "/" + file.dirname, (err, stats) => {
                                if (err) throw "Error: unable to stat " + directory + "/" + file.dirname + " ... Does the directory exist?";
                                taropts.push(file.dirname);
                                next_file();
                            });
                        } else {
                            if(file.required) throw err;
                            else {
                                console.log("Couldn't find " + (file.filename||file.dirname) + " but it's not required for this datatype");
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
                request.post({ url: config.api.wf + "/task", headers, json: true, body: {
                    instance_id: instance._id,
                    name: instanceName,
                    service: noopService,
                }},
                (err, res, body) => {
                    if(err) throw "Error: " + res.body.message;
                    let task = body.task;

                    console.log("Waiting for upload task to be ready...");
                    waitForFinish(headers, task, 0, function(err) {
                        if(err) throw err;

                        console.log("Starting upload");

                        let req = request.post({url: config.api.wf + "/task/upload/" + task._id + "?p=upload.tar.gz&untar=true", headers: headers});
                        let tar = spawn('tar', taropts, { cwd: directory });
                        tar.stdout.pipe(req);

                        req.on('response', res => {
                            if(res.statusCode != "200") throw "Error: " + res.body.message;
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
                                if(res.statusCode != "200") throw "Failed to upload: " + res.body.message;
                                console.log("Finished dataset registration!");
                                resolve(body);
                            });
                        });
                    });
                });
            });
        }).catch(console.error);
    });
}

/**
 *
 * @param {any} headers
 * @param {task} task
 * @param {number} gear
 * @param {(error: string, task: task) => any} cb
 */
function waitForFinish(headers, task, gear, cb) {
    var find = {_id: task._id};
    
    request.get({ url: config.api.wf + "/task?find=" + JSON.stringify({_id: task._id}), headers, json: true}, (err, res, body) => {
        if(err) return cb(err, null);
        if (res.statusCode != 200) throw "Error: " + res.body.message;

        let task = body.tasks[0];

        if (task.status == "finished") {
            terminalOverwrite.clear();
            terminalOverwrite("SERVICE: " + task.service + gearFrames[gear] + "\n" + 
                                "STATUS: Successfully finished\n(" + timeago.ago(new Date(task.finish_date)) + ")");
            terminalOverwrite.done();
            return cb(null, task);
        }
        if (task.status == "failed") {
            terminalOverwrite.clear();
            terminalOverwrite("SERVICE: " + task.service + "\n" + 
                                "STATUS: failed");
            terminalOverwrite.done();
            return cb("Error: " + task.status_msg, null);
        }
        terminalOverwrite.clear();
        terminalOverwrite("SERVICE: " + task.service + gearFrames[gear] + "\n" + 
                            "STATUS: " + task.status_msg + "\n(running since " + timeago.ago(new Date(task.create_date)) + ")");

        setTimeout(function() {
            waitForFinish(headers, task, (gear + 1) % gearFrames.length, cb);
        }, 1000);
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
                throw "Error: Couldn't find your jwt token. You're probably not logged in";
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
 * Converts object with maybe null entries to a Uri with nonnull objects
 * @param {any} o
 * @returns {string}
 */
function toNonNullUri(o) {
    let uri = [];
    Object.keys(o).forEach(k => {
        if (o[k] && o[k].trim().length > 0) uri.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k]));
    });

    let result = uri.join('&');
    return result.length > 0 ? '?' + result : result;
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
    return string + "s";
}

/**
 * Parse a datatype string to a datatype name and tags
 * @param {string} string 
 */
function parseDatatypeString(string) {
    let tags = [], datatype = string;
    
    if (string.endsWith('>')) {
        let lastBeginningAngleBracket = null;
        for (let i = 0; i < string.length - 1; i++) {
            if (string.charAt(i) == '\\') {
                i++;
                continue;
            }
            if (string.charAt(i) == '<') lastBeginningAngleBracket = i;
        }
        if (lastBeginningAngleBracket) {
            tags = datatype.substring(lastBeginningAngleBracket + 1, datatype.length - 1).split(',').map(x => x.trim());
            datatype = datatype.substring(0, lastBeginningAngleBracket);
        }
    }
    return { tags, datatype };
}

module.exports = {
    filterProfiles,
    queryDatatypes, queryApps, queryProfiles, queryProjects, queryDatasets,
    downloadDataset, uploadDataset,
    runApp,
    updateProject,
    loadJwt, pluralize, waitForFinish
};