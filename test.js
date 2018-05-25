#!/usr/bin/env node

const util = require('./util');

util.loadJwt().then(async jwt => {
	let headers = { 'Authorization': 'Bearer ' + jwt };
	
});