#!/usr/bin/env node

const process = require('process');
const fs = require('fs');
const program = require('commander');
const pkg = require('./package');

program
  .version(pkg.version)
  .command('login', 'login to brainlife and generate a temporary access token')
  .command('profile', 'query the available list of profiles')
  .command('datatype', 'query the available list of datatypes')
  .command('project', 'create and view brainlife projects')
  .command('dataset', 'view and utilize stored datasets')
  .command('app', 'query and run brainlife apps')
  .parse(process.argv);
