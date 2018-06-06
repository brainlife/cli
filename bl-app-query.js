const request = require('request-promise-native');
const config = require('./config');
const commander = require('commander');
const argv = require('minimist')(process.argv.slice(2));
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter apps by id')
    .option('-q, --query <query>', 'filter apps by name or description')
    .option('--input-datatype <type>', 'specify required input type')
    .option('--output-datatype <type>', 'specify required output type')
    .option('-s, --skip <skip>', 'number of results to skip', parseInt)
    .option('-l, --limit <limit>', 'maximum number of results to show', parseInt)
    .option('-r, --raw', 'output data in json format')
    .option('-j, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(async jwt => {
    commander.raw = commander.raw || commander.json;
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    let datatypeTable = {};
    
    let inputs = argv['input-datatype'];
    if(inputs && !Array.isArray(inputs)) inputs = [ inputs ];

    let outputs = argv['output-datatype'];
    if(outputs && !Array.isArray(outputs)) outputs = [ outputs ];
    
    try {
        let apps = await util.queryApps(headers, {
            id: commander.id, 
            search: commander.query,
            inputs, outputs, 
        }, {
            skip: commander.skip, 
            limit: commander.limit
        });
        
        if (commander.raw) console.log(JSON.stringify(apps));
        else formatApps(headers, apps, { all : true }).then(console.log);
    } catch (err) {
        util.errorMaybeRaw(err, commander.raw);
    }
}).catch(err => {
    util.errorMaybeRaw(err, commander.raw);
});

/**
 * Format app information
 * @param {app[]} data
 * @param {any} whatToShow
 * @returns {Promise<string>}
 */
function formatApps(headers, data, whatToShow) {
    return new Promise(async (resolve, reject) => {
        let datatypes = await util.queryAllDatatypes(headers);
        let datatypeTable = {};

        datatypes.forEach(d => datatypeTable[d._id] = d);

        let resultArray = data.map(D => {
            let info = [];
            let formattedInputs = D.inputs.map(input => {
                let dtype = datatypeTable[input.datatype] ? datatypeTable[input.datatype].name : input.datatype;
                let tags = input.datatype_tags.length > 0 ? "<" + input.datatype_tags.join(',') + ">" : '';
                let formattedDatatype = input.id + ": " + dtype + tags;
                if (input.multi) formattedDatatype += '[]';
                if (input.optional) formattedDatatype += '?';
                
                return formattedDatatype;
            }).join(', ');
            
            let formattedOutputs = D.outputs.map(output => {
                let dtype = datatypeTable[output.datatype] ? datatypeTable[output.datatype].name : output.datatype;
                let tags = output.datatype_tags.length > 0 ? "<" + output.datatype_tags.join(',') + ">" : '';
                let formattedDatatype = output.id + ": " + dtype + tags;
                if (output.multi) formattedDatatype += '[]';
                if (output.optional) formattedDatatype += '?';
                
                return formattedDatatype;
            }).join(', ');
            
            let formattedConfig = Object.keys(D.config)
            .filter(key => D.config[key].type != 'input')
            .map(key => {
                let resultString = "    " + key + ":";
                
                if (D.config[key].type) resultString += " (type: " + D.config[key].type + ")";
                if (D.config[key].default) resultString += " (default: " + D.config[key].default + ")";
                return resultString;
            }).join('\n');
            
            if (whatToShow.all || whatToShow.id) info.push("Id: " + D._id);
            if (whatToShow.all || whatToShow.name) info.push("Name: " + D.name);
            if (whatToShow.all || whatToShow.service) info.push("Service: " + D.github);
            if (whatToShow.all || whatToShow.datatypes) info.push("Type: (" + formattedInputs + ") -> (" + formattedOutputs + ")");
            if (whatToShow.all || whatToShow.desc) info.push("Description: " + D.desc);
            if (whatToShow.all || whatToShow.desc) info.push("Config:\n" + formattedConfig);

            return info.join('\n');
        });
        
        resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
        resolve(resultArray.join('\n\n'));
    });
}