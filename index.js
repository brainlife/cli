#!/usr/bin/env node

const request = require('request');
const mkdirp = require('mkdirp');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const config = require('./config');

const bids_walker = require('./bids-walker');

exports.bids_walker = bids_walker.walk;

