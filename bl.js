#!/usr/bin/env node

const process = require('process');
const fs = require('fs');
const program = require('commander');
const pkg = require('./package');

program
  .version(pkg.version)
  .command('login', 'login to brainlife and generate a temporary access token')
  .command('import', 'import dataset to brainlife project')
  .command('export', 'export dataset from brainlife project')
  .command('task', 'manipulate brainlife task')
  .parse(process.argv);

