const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
    .option('--search <search>', 'filter apps by id, name, or description')
    .option('--input-type <types>', 'specify required input types')
    .option('--output-type <types>', 'specify required output types')
    .option('--skip <skip>', 'number of results to skip')
    .option('--limit <limit>', 'maximum number of results to show')
    .option('--raw', 'output data in raw format (JSON)')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };
    let datatypeTable = {};
    
    util.queryApps(headers, commander.search, commander.inputType, commander.outputType, commander.skip, commander.limit)
    .then(apps => {
        if (commander.raw) console.log(JSON.stringify(apps));
        else formatApps(headers, apps, { all : true }).then(console.log);
    }).catch(console.error);
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
                    let formattedDatatype = dtype + tags;
                    if (input.multi) formattedDatatype += '[]';
                    if (input.optional) formattedDatatype += '?';
                    
                    return formattedDatatype;
                }).join(', ');

                let formattedOutputs = D.outputs.map(output => {
                    let dtype = datatypeTable[output.datatype] ? datatypeTable[output.datatype].name : output.datatype;
                    let tags = output.datatype_tags.length > 0 ? "<" + output.datatype_tags.join(',') + ">" : '';
                    let formattedDatatype = dtype + tags;
                    if (output.multi) formattedDatatype += '[]';
                    if (output.optional) formattedDatatype += '?';
                    
                    return formattedDatatype;
                }).join(', ');

                if (whatToShow.all || whatToShow.id) info.push("Id: " + D._id);
                if (whatToShow.all || whatToShow.name) info.push("Name: " + D.name);
                if (whatToShow.all || whatToShow.datatypes) info.push("Type: (" + formattedInputs + ") -> (" + formattedOutputs + ")");
                if (whatToShow.all || whatToShow.desc) info.push("Description: " + D.desc);

                return info.join('\n');
            });
            
            resultArray.push("(Returned " + data.length + " " + util.pluralize("result", data) + ")");
            resolve(resultArray.join('\n\n'));

        }).catch(console.error);
    });
}