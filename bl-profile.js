#!/usr/bin/env node

const commander = require('commander');

commander
	.command('query', 'run a query against all profiles')
	.parse(process.argv);
