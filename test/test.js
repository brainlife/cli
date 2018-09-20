const assert = require('assert');
const jwt = require('jsonwebtoken');
const util = require('../util');
const config = require('../config');

let userJwt;

describe('bl-login', function() {
    it('should successfully login as a test user', function(done) {
        util.login({
            username: process.env.USER,
            password: process.env.PASSWORD
        }).then(rawJwt => {
            let user = jwt.decode(rawJwt);
            userJwt = rawJwt;
            
            assert(user.iss.indexOf(config.host) != -1, "jwt issuer should be the same as BLHOST");
            assert(user.profile.username == 'test', "user should login with username 'test'");
            done();
        });
    });
});

describe('bl-resource', function() {
    it('should be able to query resources by id', function(done) {
        util.queryResources({ 'Authorization': 'Bearer ' + userJwt }, { id: '5a9eb4a6fa2ccb6c34e20ab8' })
        .then(resources => {
            assert(resources.length == 1, "ensure hayashis@carbonate id returns exactly 1 result");
            assert(resources[0]._id == '5a9eb4a6fa2ccb6c34e20ab8', "ensure hayashis@carbonate id is correct");
            done();
        });
    });
    
    it('should be able to query resources by name', function(done) {
        util.queryResources({ 'Authorization': 'Bearer ' + userJwt }, { search: 'hayashis@carbonate' })
        .then(resources => {
            assert(resources.length == 1, "ensure query hayashis@carbonate returns exactly 1 result");
            done();
        });
    });
    
    it('should be able to query resources by service', function(done) {
        util.queryResources({ 'Authorization': 'Bearer ' + userJwt }, { service: 'soichih/sca-service-noop' })
        .then(resources => {
            assert(resources.length > 0, "ensure service query returns more than 0 results");
            done();
        });
    });
});

describe('bl-profile', function() {
    it('should properly query profiles by id', function(done) {
        util.queryProfiles({ 'Authorization': 'Bearer ' + userJwt }, { id: '1' }, {})
        .then(profiles => {
            assert(profiles.length == 1, "ensure id query returns exactly 1 result");
            assert(profiles[0].id == '1', "ensure query returns result with correct id");
            done();
        });
    });
    
    it('should properly query profiles by search', function(done) {
        util.queryProfiles({ 'Authorization': 'Bearer ' + userJwt }, { search: 'hayashis@iu.edu' }, {})
        .then(profiles => {
            assert(profiles.length == 1, "ensure profile query returns exactly one result");
            done();
        });
    });
});

describe('bl-datatype', function() {
    it('should properly query datatypes by id', function(done) {
        util.queryDatatypes({ 'Authorization': 'Bearer ' + userJwt }, { id: '58d15eaee13a50849b258844' }, {})
        .then(datatypes => {
            assert(datatypes.length == 1, "ensure id for neuro/life returns exactly 1 result");
            assert(datatypes[0]._id == '58d15eaee13a50849b258844', "ensure query returns result with correct id");
            done();
        });
    });
    
    it('should properly query datatypes by name', function(done) {
        util.queryDatatypes({ 'Authorization': 'Bearer ' + userJwt }, { search: 'neuro/anat/t1w' }, {})
        .then(datatypes => {
            assert(datatypes.length == 1, "ensure neuro/anat/t1w returns exactly 1 result");
            done();
        });
    });
    
    let secondDatatypeId;
    it('should be able to limit returned results', function(done) {
        util.queryDatatypes({ 'Authorization': 'Bearer ' + userJwt }, {}, { limit: 2 })
        .then(datatypes => {
            assert(datatypes.length == 2, "ensure limiting query returns exactly 2 results");
            secondDatatypeId = datatypes[1]._id;
            done();
        });
    });
    
    it('should be able to skip returned results', function(done) {
        util.queryDatatypes({ 'Authorization': 'Bearer ' + userJwt }, {}, { skip: 1, limit: 2 })
        .then(datatypes => {
            assert(datatypes.length == 2, "ensure limited skipping query returns exactly 2 results");
            assert(datatypes[0]._id == secondDatatypeId, "ensure first datatype in the skipped array is equal to the second value in the unskipped array");
            done();
        });
    });
});

describe('bl-project', function() {
    it('should properly query projects by id', function(done) {
        util.queryProjects({ 'Authorization': 'Bearer ' + userJwt }, { id: '5aabf7b723f8fa0027301edf' }, {})
        .then(projects => {
            assert(projects.length == 1, "ensure id query returns exactly 1 result");
            assert(projects[0]._id == '5aabf7b723f8fa0027301edf', "ensure query returns result with correct id");
            done();
        });
    });
    
    it('should properly query projects by name', function(done) {
        util.queryProjects({ 'Authorization': 'Bearer ' + userJwt }, { search: 'HCP3T' }, {})
        .then(projects => {
            assert(projects.length == 1, "ensure HCP query returns exactly 1 result");
            done();
        });
    });
    
    let secondProjectId;
    it('should be able to limit returned results', function(done) {
        util.queryProjects({ 'Authorization': 'Bearer ' + userJwt }, {}, { limit: 2 })
        .then(projects => {
            assert(projects.length == 2, "ensure limiting query returns exactly 2 results");
            secondProjectId = projects[1]._id;
            done();
        });
    });
    
    it('should be able to skip returned results', function(done) {
        util.queryProjects({ 'Authorization': 'Bearer ' + userJwt }, {}, { skip: 1, limit: 2 })
        .then(projects => {
            assert(projects.length == 2, "ensure limited skipping query returns exactly 2 results");
            assert(projects[0]._id == secondProjectId, "ensure first datatype in the skipped array is equal to the second value in the unskipped array");
            done();
        });
    });
});

describe('bl-dataset', function() {
    it('should properly query datasets by id', function(done) {
        util.queryDatasets({ 'Authorization': 'Bearer ' + userJwt }, { id: '5b04237811bd7700265fa10e' }, {})
        .then(datasets => {
            assert(datasets.length == 1, "ensure id query returns exactly 1 result");
            assert(datasets[0]._id == '5b04237811bd7700265fa10e', "ensure query returns result with correct id");
            done();
        });
    });
    
    it('should properly query datasets by project', function(done) {
        util.queryDatasets({ 'Authorization': 'Bearer ' + userJwt }, { project: '5a9f542da62c11003168a86b' }, {})
        .then(datasets => {
            datasets.forEach(dataset => {
                assert(dataset.project == '5a9f542da62c11003168a86b', "ensure that returned datasets have the correct project id");
            });
            done();
        });
    });
    
    it('should properly query datasets by datatype', function(done) {
        util.queryDatasets({ 'Authorization': 'Bearer ' + userJwt }, { datatype: '58c33bcee13a50849b25879a' }, {})
        .then(datasets => {
            datasets.forEach(dataset => {
                assert(dataset.datatype == '58c33bcee13a50849b25879a', "ensure that returned datasets have the correct datatype id");
            });
            done();
        });
    });
    
    it('should properly query datasets by datatype tag', function(done) {
        util.queryDatasets({ 'Authorization': 'Bearer ' + userJwt }, { datatype: '58c33bcee13a50849b25879a', datatypeTags: ['acpc_aligned'] }, {})
        .then(datasets => {
            datasets.forEach(dataset => {
                assert(dataset.datatype_tags.indexOf('acpc_aligned') != -1, "ensure that returned datasets have the correct datatype id");
            });
            done();
        });
    });
    
    it('should properly query datasets by name', function(done) {
        util.queryDatasets({ 'Authorization': 'Bearer ' + userJwt }, { project: '5a9f542da62c11003168a86b', search: 'test' }, {})
        .then(datasets => {
            assert(datasets.length == 1, "ensure test query returns exactly 1 result");
            done();
        });
    });
    
    let secondDatasetId;
    it('should be able to limit returned results', function(done) {
        util.queryDatasets({ 'Authorization': 'Bearer ' + userJwt }, {}, { limit: 2 })
        .then(datasets => {
            assert(datasets.length == 2, "ensure limiting query returns exactly 2 results");
            secondDatasetId = datasets[1]._id;
            done();
        });
    });
    
    it('should be able to skip returned results', function(done) {
        util.queryDatasets({ 'Authorization': 'Bearer ' + userJwt }, {}, { skip: 1, limit: 2 })
        .then(datasets => {
            assert(datasets.length == 2, "ensure limited skipping query returns exactly 2 results");
            assert(datasets[0]._id == secondDatasetId, "ensure first datatype in the skipped array is equal to the second value in the unskipped array");
            done();
        });
    });
});