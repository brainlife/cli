const assert = require('assert');
const jwt = require('jsonwebtoken');
const util = require('../util');

let userJwt;

describe('bl-login', function() {
    it('should successfully login as user "test"', function(done) {
        util.login({
            username: 'test',
            password: 'just a test'
        }).then(rawJwt => {
            let user = jwt.decode(rawJwt);
            userJwt = rawJwt;
            
            assert(user.iss == 'https://test.brainlife.io/auth', "jwt issuer should be test.brainlife.io");
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