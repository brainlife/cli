#!/usr/bin/env node

const commander = require('commander');

commander
	.command('query', 'run a query against all projects')
	.command('update', '(experimental) update a project with the given projectid')
	.parse(process.argv);
