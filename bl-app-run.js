#!/usr/bin/env node

const config = require('./config');
const commander = require('commander');
const util = require('./util');
const request = require('request-promise-native'); //deprecated..

commander
    .option('--id <app id>', 'id of app to run')
    .option('--input <input id>', 'add an input to the application (by input id)', util.collect, [])
    .option('--project <project id>', 'the project to store the output dataset from an app')
    .option('--preferred-resource <resource id>', 'user-preferred resource to use to run an app')
    .option('--branch <resource id>', 'github branch to use to run this app (default: master)')
    .option('--config <json string>', 'config to use for running the app')
    .option('--tag <tag>', 'add a tag to the archived dataset', util.collect, [])
    .option('-j, --json', 'output resulting app task in json format')
    .parse(process.argv);

try {
    if(!commander.project) throw new Error("Please specify project id (-p) used to run the app.");
    if(!commander.id) throw new Error("Please specify app id (--id)");
} catch(err) {
    console.error(err.toString());
    process.exit(1);
}

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };

    runApp(headers, {
        app: commander.id,
        inputs: commander.input,
        project: commander.project,
        resource: commander.preferredResource,
        branch: commander.branch,
        config: commander.config,
        tags: commander.tag,
        json: commander.json,
    }).then(task=>{
        if (commander.json) console.log(JSON.stringify(task, null, 4));
    }).catch(err=>{
        console.error(err);
    });
});

function runApp(headers, opt) {
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
        
        let datatypes = await util.queryAllDatatypes(headers);
        if (datatypes.length == 0) return reject("couldn't load datatypes");

        let apps = await util.resolveApps(headers, opt.app);
        if (apps.length == 0) return reject("No apps found matching '" + opt.app + "'");
        if (apps.length > 1) return reject("Multiple apps matching '" + opt.app + "'");
        
        let projects = await util.resolveProjects(headers, opt.project);
        if (projects.length == 0) return reject("No projects found matching '" + opt.project + "'");
        if (projects.length > 1) return reject("Multiple projects matching '" + opt.project + "'");
        
        let inputs = {};
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

        const gids = [project.group_id];
        if(!project.noPublicResource) gids.push(1);
 
        // setting user-preferred resource
        const bestResource = await request(config.api.amaretti + '/resource/best', {
            headers,
            qs: { 
                service: app.github,
                gids,
             },
            json: true
        });
        if (bestResource.resource) resource = bestResource.resource._id;
        if (bestResource.considered && opt.resource) {
            let resources = await util.resolveResources(headers, opt.resource);
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
        let idToAppInputTable = {};
        app.inputs.forEach(input => idToAppInputTable[input.id] = input);
        datatypes.forEach(d => datatypeTable[d._id] = d);
        
        for (let input of opt.inputs) {
            // get dataset for each input
            if (!~input.indexOf(':')) return reject('No key given for dataset ' + input);
            let file_id = input.substring(0, input.indexOf(":"));
            let datasetQuery = input.substring(input.indexOf(":") + 1);
            let datasets = await util.resolveDatasets(headers, datasetQuery);
            
            if (datasets.length == 0) return reject("No data object matching '" + datasetQuery + "'");
            if (datasets.length > 1) return reject("Multiple data objects matching '" + datasetQuery + "'");
            if (all_dataset_ids.indexOf(datasets[0]._id) == -1) all_dataset_ids.push(datasets[0]._id);
            
            let dataset = datasets[0];
            let app_input = idToAppInputTable[file_id];
            
            // validate dataset
            if (dataset.status != "stored") return reject("Input data object " + input + " has storage status '" + dataset.status + "' and cannot be used until it has been successfully stored.");
            if (dataset.removed == true) return reject("Input data object " + input + " has been removed and cannot be used.");
            if (!app_input) return reject("This app's config does not include key '" + file_id + "'");
            if (app_input.datatype != dataset.datatype) return reject("Given input of datatype " + datatypeTable[dataset.datatype].name + " but expected " + datatypeTable[app_input.datatype].name + " when checking " + input);
            
            // validate dataset's datatype tags
            let userInputTags = {};
            dataset.datatype_tags.forEach(tag => userInputTags[tag] = 1);
            app_input.datatype_tags.forEach(tag => {
                if (tag.startsWith("!")) {
                    if (userInputTags[tag.substring(1)]) return reject("This app requires that the input data object for " + file_id + " should NOT have datatype tag '" + tag.substring(1) + "' but found it in " + input);
                } else {
                    if (!userInputTags[tag]) return reject("This app requires that the input data object for " + file_id + " have datatype tag '" + tag + "', but it is not set on " + input);
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
        let instanceName = (apps[0].tags||'CLI Process') + "." + (Math.random()); //TODO Math.random() is ugly..?
        let instance = await util.findOrCreateInstance(headers, instanceName, { project, desc: "(CLI) " + app.name });
        
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
            if(inputs[input.id]) inputs[input.id].forEach(user_input=>{
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

            const subdirs = [];
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
                if(inputs[input.id]) inputs[input.id].forEach(user_input=>{
                    let dataset = task.config._outputs.find(output=>output.dataset_id == user_input._id);
                    app_inputs.push(Object.assign({}, dataset, {
                        id: input.id,
                        task_id: task._id,
                        keys,
                    }));

                    if(input.includes) {
                        input.includes.split("\n").forEach(include=>{
                            subdirs.push("include:"+dataset.id+"/"+include)
                        });
                    } else {
                        subdirs.push(dataset.id);
                    }
                });
            });

            //similar code alert
            //  ui/modal/newtask
            //  ui/modal/appsubmit
            //  bin/rule_handler
            //  cli
            const meta = {};
            app_inputs.forEach(dataset=>{
                //for(var k in dataset.meta) if(!meta[k]) meta[k] = dataset.meta[k]; //use first one
                ["subject", "session", "run"].forEach(k=>{
                    if(!meta[k]) meta[k] = dataset.meta[k]; //use first one
                });
            });
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

                //handle tag pass through
                let tags = [];
                if(output.datatype_tags_pass) {
                    console.log("input for", output.datatype_tags_pass);
                    inputs[output.datatype_tags_pass].forEach(dataset=>{
                        if(!dataset) return; //could this really happen?
                        if(dataset.datatype_tags) tags = tags.concat(dataset.datatype_tags);
                        Object.assign(output_req.meta, dataset.meta);
                    });
                }
                tags = tags.concat(output.datatype_tags); //add specified output tags at the end
                output_req.datatype_tags = tags 
                console.dir(output_req);

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

            ////////////////////////////////////////////////////////////////////////////////////////
            //
            // run tasks!
            //
            let submissionParams = {
                instance_id: instance._id,
                gids,
                name: app.name.trim(),
                service: app.github,
                service_branch: branch,
                config: preparedConfig,
                deps_config: [ {
                    task: task._id,
                    subdirs,
                } ],
            };
            if (resource) submissionParams.preferred_resource_id = resource;
            request.post({ url: config.api.amaretti + "/task", headers, json: true, body: submissionParams }, (err, res, body) => {
                if (err) return reject(err);
                else if (res.statusCode != 200) return reject(res.body.message);
                if (!opt.json) console.log(app.name + " task for app '" + app.name + "' has been created.\n" +
                            "To monitor the app as it runs, please execute \nbl app wait " + body.task._id);
                resolve(body.task);
            });
        });
    });
}

function prepareConfig(values, download_task, inputs, datatypeTable, app) {
    let idToAppInputTable = {};
    //let idToDatatype = {};
    let result = {};

    app.inputs.forEach(input => idToAppInputTable[input.id] = input);
    //app.inputs.forEach(input => idToDatatype[input.id] = input.datatype);

    Object.keys(app.config).forEach(key => {
        if (app.config[key].type == 'input') {
            const input_id = app.config[key].input_id;
            let userInputs = inputs[input_id];
            if(!userInputs) return;
            let appInput = idToAppInputTable[input_id];
            
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

