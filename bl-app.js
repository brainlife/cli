#!/usr/bin/env node

const request = require('request');
const argv = require('minimist')(process.argv.slice(2));
const config = require('./config');
const fs = require('fs');
const async = require('async');
const spawn = require('child_process').spawn;
//const WebSocketClient = require('websocket').client;
const jsonwebtoken = require('jsonwebtoken');
const commander = require('commander');
const chalk = require('chalk');

commander
    .option('-i --id <id>', 'Get app by exact id')
    .option('-s --search <query>', 'Search for app by query')
    .option('--input <datatypeQuery>', 'Search for app by input datatype(s)')
    .option('--output <datatypeQuery>', 'Search for app by output datatype(s)')
    .parse(process.argv);

fs.stat(config.path.jwt, (err, stat)=>{
    if(err) {
        console.log("not logged in?");
        process.exit(1);
    }
    let jwt = fs.readFileSync(config.path.jwt);
    let user = jsonwebtoken.decode(jwt);
    let headers = { "Authorization": "Bearer "+jwt };
    let apps, inputids, outputids;

    if (!commander.search && !commander.id && !commander.input && !commander.output) {
        commander.outputHelp();
    }
    else {
        getDatatypeIdsFromSearch((commander.input || "").split(","), headers)
        .then(_inputids => {
            inputids = _inputids;
            
            return getDatatypeIdsFromSearch((commander.output || "").split(","), headers);
        }).then(_outputids => {
            outputids = _outputids;
            
            return getApps((commander.search || "").split(","), (commander.id || "").split(","), inputids, outputids, headers);
        }).then(_apps => {
            apps = _apps;
            
            let datatype_list = [];
            apps.forEach(A => {
                for (k in A.inputs) {
                    if (datatype_list.indexOf(A.inputs[k].datatype) == -1) {
                        datatype_list.push(A.inputs[k].datatype);
                    }
                }
                for (k in A.outputs) {
                    if (datatype_list.indexOf(A.outputs[k].datatype) == -1) {
                        datatype_list.push(A.outputs[k].datatype);
                    }
                }
            });

            return getDatatypesFromIds(datatype_list, headers);
        })
        .then(datatypes => {
            console.log(apps.map(A => {
                return chalk.rgb(255, 128, 255)(`${A.github} :: ${parseAppInputToOutput(A.inputs, A.outputs, datatypes)}`) +
                        `\n` + chalk.rgb(128, 255, 128)(`${chalk.bold(A.name)} [${A._id}]: `) + `${A.desc}`;
            }).join('\n\n'));
        }).catch(err=>{
            console.error(err);
        });
    }
});

function getApps(searches, ids, inputs, outputs, headers) {
    var valid_searches = [];
    searches.forEach(q => {
        q = q.trim();
        if (q.length > 0) valid_searches.push(escapeRegExp(q));
    });
    var pattern = valid_searches.join('|');
    
    return new Promise((resolve, reject)=>{
        var orExp = [];
        var find = { removed: false };
        
        if (pattern) {
            orExp.push({ name: { $regex: pattern, $options: 'ig' } });
            orExp.push({ desc: { $regex: pattern, $options: 'ig' } });
        }
        if (inputs.length > 0) orExp.push({ inputs: { $elemMatch: { datatype: { $in: inputs } } } });
        if (outputs.length > 0) orExp.push({ outputs: { $elemMatch: { datatype: { $in: outputs } } } });
        
        if (orExp.length > 0) find.$or = orExp;
        
        if (ids) {
            var valid_ids = [];
            ids.forEach(id => {
                id = id.trim();
                if (id.length == 24) valid_ids.push(id);
            });
            if (valid_ids.length > 0) find._id = { $in: valid_ids };
        }
        var sort = { name: 1 };
        
        request.get({url: `${config.api.warehouse}/app?find=${JSON.stringify(find)}&sort=${JSON.stringify(sort)}`, headers: headers, json: true}, function(err, res, body) {
            if(err || res.statusCode != 200) return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            resolve(body.apps);
        });
    });
}

function getDatatypeIdsFromSearch(searches, headers) {
    var valid_searches = [];
    searches.forEach(q => {
        q = q.trim();
        if (q.length > 0) valid_searches.push(escapeRegExp(q));
    });
    var pattern = valid_searches.join('|');

    return new Promise((resolve, reject)=>{
        if (valid_searches.length == 0) return resolve([]);
        
        var find = { $or: [
                    { name: { $regex: pattern, $options: 'ig' } },
                    { desc: { $regex: pattern, $options: 'ig' } } ] };
        
        var valid_ids = [];
        // also treat searches as list of ids
        searches.forEach(id => {
            id = id.trim();
            if (id.length == 24) valid_ids.push(id);
        });
        if (valid_ids.length > 0) find._id = { $in: valid_ids };
        
        request.get({url: `${config.api.warehouse}/datatype?find=${JSON.stringify(find)}`, headers: headers, json: true}, function(err, res, body) {
            if(err || res.statusCode != 200) return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            resolve(body.datatypes.map(d => d._id));
        });
    });
}

function getDatatypesFromIds(ids, headers) {
    return new Promise((resolve, reject)=>{
        var find = { _id: { $in: ids } };
        
        request.get({url: `${config.api.warehouse}/datatype?find=${JSON.stringify(find)}`, headers: headers, json: true}, function(err, res, body) {
            if(err || res.statusCode != 200) return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            resolve(body.datatypes);
        });
    });
}


function parseAppInputToOutput(inputs, outputs, datatypes) {
    let res_inputs = "", res_outputs = "";
    inputs.forEach(input => {
        let datatype = lookupDatatype(input.datatype, datatypes);
        res_inputs += (res_inputs.length == 0 ? "" : ", ") + datatype.name;
    });
    outputs.forEach(output => {
        let datatype = lookupDatatype(output.datatype, datatypes);
        res_outputs += (res_outputs.length == 0 ? "" : ", ") + datatype.name;
    });
    
    return `(${res_inputs}) -> (${res_outputs})`;
}

function lookupDatatype(id, datatypes) {
    for (var k in datatypes) {
        if (datatypes[k]._id == id) return datatypes[k];
    }
    return null;
}

function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}