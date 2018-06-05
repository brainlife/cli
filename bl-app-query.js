const request = require('request-promise-native');
const config = require('./config');
const commander = require('commander');
const argv = require('minimist')(process.argv.slice(2));
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter apps by id')
    .option('-q, --search <search>', 'filter apps by name or description')
    .option('--input-datatype <type>', 'specify required input type')
    .option('--output-datatype <type>', 'specify required output type')
    .option('-k, --skip <skip>', 'number of results to skip', parseInt)
    .option('-l, --limit <limit>', 'maximum number of results to show', parseInt)
    .option('-r, --raw', 'output data in json format')
    .option('-r, --json', 'output data in json format')
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
    
    let apps = await util.queryApps(headers, {
        id: commander.id, 
        search: commander.search, 
        inputs, outputs, 
    }, {
        skip: commander.skip, 
        limit: commander.limit
    });
    
    if (commander.raw) console.log(JSON.stringify(apps));
    else formatApps(headers, apps, { all : true }).then(console.log);
}).catch(console.error);

/**
 * Format app information
 * @param {app[]} data
 * @param {any} whatToShow
 * @returns {Promise<string>}
 */
function formatApps(headers, data, whatToShow) {
    return new Promise(async (resolve, reject) => {
        let datatypeBody = await request.get(config.api.warehouse + '/datatype', { headers, json: true });
        let datatypes = datatypeBody.datatypes;
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

            if (whatToShow.all || whatToShow.id) info.push("Id: " + D._id);
            if (whatToShow.all || whatToShow.name) info.push("Name: " + D.name);
            if (whatToShow.all || whatToShow.service) info.push("Service: " + D.github);
            if (whatToShow.all || whatToShow.datatypes) info.push("Type: (" + formattedInputs + ") -> (" + formattedOutputs + ")");
            if (whatToShow.all || whatToShow.desc) info.push("Description: " + D.desc);

            return info.join('\n');
        });
        
        resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
        resolve(resultArray.join('\n\n'));
    });
}
