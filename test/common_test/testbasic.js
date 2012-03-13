/*
Copyright (c) 2011-2012 VMware, Inc.

  Basic test for basic vblob features: 
  - get containers
  - get container
  - put container
  - put file
  - get file
  - delete file
  - delete container
  Start a vblob gw instance WITHOUT "auth" : "enabled" at the end of the config file. This will allow anonymous access to apis. Then go ahead to test the above features in fs.

  Put it in another way:
  client -> gw 1 without auth -> fs driver
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');
var config = JSON.parse(require('./utils').execSync("curl http://localhost:9981/~config")); //must be the config you actually use for the vblob  instance
var test_date = new Date().valueOf();
var container_name = '/sonic-test'+test_date;
var suite = vows.describe('testbasic: using container '+container_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
var parse_xml = require('./utils').parse_xml;
var assertStatus = require('./utils').assertStatus;
var api = require('./utils').api;

suite.addBatch({
  'PUT container ' : {
    topic: api.put(container_name),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the location of the container': function (err,res) {
      assert.isString(res.headers['location']);
    } 
  }
}).addBatch({
  'PUT container/testbasic-1.txt': {
    topic: api.put_data(container_name+'/testbasic-1.txt','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  },
  'PUT container/A/B.txt': {
    topic: api.put_data(container_name+'/A/B.txt','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  },
  'PUT container/A/B/C.txt': {
    topic: api.put_data(container_name+'/A/B/C.txt','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  }
}).addBatch({
  'GET /': {
    topic: api.get('/'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with a valid list of containers': function(err,res) {
      assert.isNotNull(res.resp_body);
    } 
  },
  'GET container': {
    topic: api.get(container_name),
    'should respond with either 501 or 200 code':  function (err,res) {
      assert.include([200,501],res.statusCode);
    },
    'should respond with either a valid list or a valid error': function (err,res) {
      assert.isNotNull(res.resp_body);
      if (res.statusCode === 200) {
        assert.isNotNull(res.resp_body);
      } else {
        assert.isObject(res.resp_body.Error);
      }
    } 
  },
  'GET container?prefix=/&delimiter=/': {
    topic: api.get(container_name+'?prefix=/&delimiter=/'),
    'should respond with either 501 or 200 code':  function (err,res) {
      assert.include([200,501],res.statusCode);
    },
    'should respond with a valid list of prefixes or a valid error': function (err,res) {
      assert.isNotNull(res.resp_body);
      if (res.statusCode === 200) {
        assert.isNotNull(res.resp_body);
      } else {
        assert.isNotObject(res.resp_body.Error);
      }
    } 
  }
}).addBatch({
  'GET container/testbasic-1.txt': {
    topic: api.get_data(container_name+'/testbasic-1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the content of the file': function (err,res) {
      var str1 = fs.readFileSync('./file1.txt');
      assert.equal(str1,res.resp_body);
    } 
  }
}).addBatch({
  'DELETE container/testbasic-1.txt' : {
    topic: api.del(container_name+'/testbasic-1.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE container/A/B.txt' : {
    topic: api.del(container_name+'/A/B.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE container/A/B/C.txt' : {
    topic: api.del(container_name+'/A/B/C.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  }
}).addBatch({
  'DELETE container' : {
    topic: api.del(container_name),
    'should respond with a 204 OK':  assertStatus(204)
  }
});
suite.export(module);
