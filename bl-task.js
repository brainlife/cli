#!/usr/bin/env node

const fs = require('fs');
const request = require('request');
const mkdirp = require('mkdirp');
const path = require('path');
const prompt = require('prompt');
const colors = require('colors/safe');
const jwt = require('jsonwebtoken');
const program = require('commander');

const pkg = require('./package');
const config = require('./config');

console.dir(process.argv);

program
  .version(pkg.version)
  .command('rerun', 'rerun task')
  .command('stop', 'stop a task')
  .command('list', 'list tasks')
  .parse(process.argv);

