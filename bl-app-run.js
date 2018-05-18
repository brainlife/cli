const config = require('./config');
const commander = require('commander');
const util = require('./util');

commander
	.option('--id <appid>', 'id of app to run')
	.option('--inputs <inputid1, inputid2, ...>', 'inputs to application')
	.option('--project <projectid>', 'the project to store the output dataset from an app')
	.parse(process.argv);

util.loadJwt().then(jwt => {
	var headers = { "Authorization": "Bearer " + jwt };
	let datatypeTable = {};
	
	if (!commander.project) throw `Error: No project given to store output dataset`;
	if (!commander.id) throw `Error: No app id given`;
	// not validating inputs since the app might not take in inputs
	
	util.runApp(headers, commander.id, commander.inputs, commander.project);
}).catch(console.error);
