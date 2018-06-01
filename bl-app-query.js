const config = require('./config');
const commander = require('commander');
const argv = require('minimist')(process.argv.slice(2));
const util = require('./util');

commander
    .option('-i, --id <id>', 'filter apps by id')
    .option('-s, --search <search>', 'filter apps by name or description')
    .option('-di, --input-datatype <type>', 'specify required input type')
    .option('-do, --output-datatype <type>', 'specify required output type')
    .option('-sk, --skip <skip>', 'number of results to skip')
    .option('-l, --limit <limit>', 'maximum number of results to show')
    .option('-r, --raw', 'output data in json format')
    .option('-r, --json', 'output data in json format')
    .option('-h, --h')
    .parse(process.argv);

util.loadJwt().then(async jwt => {
    commander.raw = commander.raw || commander.json;
    if (commander.h) commander.help();
    let headers = { "Authorization": "Bearer " + jwt };
    let datatypeTable = {};
    
    if (!argv['input-datatype']) argv['input-datatype'] = [];
    if (!Array.isArray(argv['input-datatype'])) argv['input-datatype'] = [ argv['input-datatype'] ];
    
    if (!argv['output-datatype']) argv['output-datatype'] = [];
    if (!Array.isArray(argv['output-datatype'])) argv['output-datatype'] = [ argv['output-datatype'] ];
    
    argv['input-datatype'].forEach(checkSingleDatatypeQuery);
    argv['output-datatype'].forEach(checkSingleDatatypeQuery);
    
    let apps = await util.queryApps(headers, commander.id, commander.search, argv['input-datatype'], argv['output-datatype'], commander.skip, commander.limit);
    
    if (commander.raw) console.log(JSON.stringify(apps));
    else formatApps(headers, apps, { all : true }).then(console.log);
    
    async function checkSingleDatatypeQuery(query) {
        let datatypes = await util.matchDatatypes(headers, query);
        if (datatypes.length == 0) util.error("Error: No datatype matching '" + query + "'");
        if (datatypes.length > 1) util.error("Error: Multiple datatypes matching '" + query + "'");
    }
}).catch(console.error);

/**
 * Format app information
 * @param {app[]} data
 * @param {any} whatToShow
 * @returns {Promise<string>}
 */
function formatApps(headers, data, whatToShow) {
    return new Promise((resolve, reject) => {
        util.queryDatatypes(headers)
        .then(datatypes => {
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

        }).catch(console.error);
    });
}