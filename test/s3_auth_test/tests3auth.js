/*
  Tests for using s3-authentication scheme.
  Tests:
  - Basic get.
  - List contents of a bucket with additional filtering parameters.

  Usage:
  Start a vblob gw instance WITH "auth" : "s3" at the end of the config file. This will enable s3 authentication.
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');
var test_date = new Date().valueOf();
var suite = vows.describe('tests3auth: testing s3-authentication functionality');
var assertStatus = require('./utils').assertStatus;
var api = require('./utils').api;

var s3_auth = require('../../common/s3/auth.js')

suite.addBatch({
  'GET /': {
    topic: api.get('/', { 
      Authorization: s3_auth.authorization({
          key: "wrongkey"
        , secret: "wrongpass44444"
        , verb: "GET"
        , date: Date().toString()
        , resource: s3_auth.canonicalizeResource('/')
        , contentType: ''
        , md5: ''
        , amazonHeaders: ''
      }),
      date: Date().toString()
    }),
    'should respond with a 401 (unauthorized) (check that you have "s3" as authentication)': assertStatus(401)
  }
}).addBatch({
  'GET /': {
    topic: api.get('/', { 
      Authorization: s3_auth.authorization({
          key: "dummy"
        , secret: "dummy"
        , verb: "GET"
        , date: Date().toString()
        , resource: s3_auth.canonicalizeResource('/')
        , contentType: ''
        , md5: ''
        , amazonHeaders: ''
      }),
      date: Date().toString()
    }),
    'should not respond with a 401 (unauthorized)': assertStatusNot(401),
    'should respond with a 200 OK':  assertStatus(200),
  }
}).addBatch({
  'GET /bucketname/?delimiter=/&prefix=&max-keys=50': {
    topic: api.get('/bucketname/?delimiter=/&prefix=&max-keys=50', { 
      Authorization: s3_auth.authorization({
          key: "dummy"
        , secret: "dummy"
        , verb: "GET"
        , date: Date().toString()
        , resource: s3_auth.canonicalizeResource('/bucketname/?delimiter=/&prefix=&max-keys=50')
        , contentType: ''
        , md5: ''
        , amazonHeaders: ''
      }),
      date: Date().toString()
    }),
    'should not respond with a 401 (unauthorized)': assertStatusNot(401)
  }
}).addBatch({
  'GET /bucketname?delimiter=/&prefix=&max-keys=50': {
    topic: api.get('/bucketname?delimiter=/&prefix=&max-keys=50', { 
      Authorization: s3_auth.authorization({
          key: "dummy"
        , secret: "dummy"
        , verb: "GET"
        , date: Date().toString()
        , resource: s3_auth.canonicalizeResource('/bucketname?delimiter=/&prefix=&max-keys=50')
        , contentType: ''
        , md5: ''
        , amazonHeaders: ''
      }),
      date: Date().toString()
    }),
    'should respond with a 401 (unauthorized), because slash after bucketname is missing': assertStatus(401)
  }
});
suite.export(module);
