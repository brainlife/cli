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
  .command('profile', 'query the available list of profiles')
  .command('datatype', 'query the available list of datatypes')
  .command('app', 'query and run brainlife apps')
  .command('project', 'create and view brainlife projects')
  .command('dataset', 'view and utilize stored datasets')
  .command('task', 'manipulate brainlife tasks')
  .parse(process.argv);
