const request = require('request-promise-native');
const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter apps by id')
    .option('-d, --doi <doi>', 'filter apps by doi')
    .option('-q, --query <query>', 'filter apps by name or description')
    .option('--input-datatype <type>', 'specify required input type', util.collect, [])
    .option('--output-datatype <type>', 'specify required output type', util.collect, [])
    .option('-s, --skip <skip>', 'number of results to skip', parseInt)
    .option('-l, --limit <limit>', 'maximum number of results to show', parseInt)
    .option('-j, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    let datatypeTable = {};

    util.queryApps(headers, {
        id: commander.id, 
        search: commander.query,
        doi: commander.doi,
        inputs: commander['input-datatype'], 
        outputs: commander['output-datatype'], 
    }, {
        skip: commander.skip, 
        limit: commander.limit
    }).then(async apps=>{
        if (commander.json) console.log(JSON.stringify(apps));
        else outputApps(headers, apps);
    }).catch(err=>{
        console.error(err);
    });
});

async function outputApps(headers, data) {
    let datatypes = await util.queryAllDatatypes(headers);
    let datatypeTable = {};

    datatypes.forEach(d => datatypeTable[d._id] = d);

    let resultArray = data.map(app => {
        let info = [];
        let formattedInputs = app.inputs.map(input => {
            let dtype = datatypeTable[input.datatype] ? datatypeTable[input.datatype].name : input.datatype;
            let tags = input.datatype_tags.length > 0 ? "<" + input.datatype_tags.join(',') + ">" : '';
            let formattedDatatype = input.id + ": " + dtype + tags;
            if (input.multi) formattedDatatype += '[]';
            if (input.optional) formattedDatatype += '?';
            
            return formattedDatatype;
        }).join(', ');
        
        let formattedOutputs = app.outputs.map(output => {
            let dtype = datatypeTable[output.datatype] ? datatypeTable[output.datatype].name : output.datatype;
            let tags = output.datatype_tags.length > 0 ? "<" + output.datatype_tags.join(',') + ">" : '';
            let formattedDatatype = output.id + ": " + dtype + tags;
            if (output.multi) formattedDatatype += '[]';
            if (output.optional) formattedDatatype += '?';
            
            return formattedDatatype;
        }).join(', ');
        
        let formattedConfig = Object.keys(app.config)
        .filter(key => app.config[key].type != 'input')
        .map(key => {
            let resultString = "    " + key + ":";
            
            if (app.config[key].type) resultString += " (type: " + app.config[key].type + ")";
            if (app.config[key].default) resultString += " (default: " + app.config[key].default + ")";
            return resultString;
        }).join('\n');
        
        info.push("Id: " + app._id);
        info.push("DOI: " + (app.doi || ''));
        info.push("Name: " + app.name);
        info.push("Service: " + app.github);
        info.push("Type: (" + formattedInputs + ") -> (" + formattedOutputs + ")");
        info.push("Description: " + app.desc);
        info.push("Config:\n" + formattedConfig);
        return info.join('\n');
    });
    
    resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
    console.log(resultArray.join('\n\n'));
}

