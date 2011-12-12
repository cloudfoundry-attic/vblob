/*
Copyright (c) 2011 VMware, Inc.

  Basic test for basic vblob features: 
  - get buckets
  - get bucket
  - put bucket
  - put object
  - get object
  - delete object
  - delete bucket
  There are two ways of testing vblob gateway:
  A. Start a vblob gw instance WITHOUT "auth" : "enabled" at the end of the config file. This will allow anonymous access to apis. Then go ahead to test the above features in s3 / fs.
  B. Start a vblob gw instance WITH "auth" : "enabled" at the end of the config file. Then, start another vblob gw instance WITHOUT "auth". IN ADDITION, the second gw will have its s3 driver pointing to the previous vblob gw. To do this, add "endpoint" : "localhost", and "endport" : <port of the first gw> to s3 credentials of the second gw.

  Put it in another way:
  A.    client -> gw 1 without auth -> fs/s3 drivers
  B.    client -> gw 1 without auth -> s3 driver -> gw 2 with auth -> fs / s3 drivers
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');

var config = JSON.parse(fs.readFileSync('../config.json')); //must be the config you actually use for the vblob  instance
var test_date = new Date().valueOf();
var bucket_name = '/sonic-test'+test_date;
var suite = vows.describe('testbasic: using bucket '+bucket_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
var parse_xml = require('./utils').parse_xml;
var assertStatus = require('./utils').assertStatus;
var api = require('./utils').api;

suite.addBatch({
  'PUT bucket ' : {
    topic: api.put(bucket_name),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the location of the bucket': function (err,res) {
      assert.isNotNull(res.headers['location']);
    } 
  }
}).addBatch({
  'PUT bucket/testbasic-1.txt': {
    topic: api.put_data(bucket_name+'/testbasic-1.txt','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  },
  'PUT bucket/A/B.txt': {
    topic: api.put_data(bucket_name+'/A/B.txt','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  },
  'PUT bucket/A/B/C.txt': {
    topic: api.put_data(bucket_name+'/A/B/C.txt','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  }
}).addBatch({
  'GET /': {
    topic: api.get('/'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with a valid list of buckets': function(err,res) {
      assert.isNotNull(res.resp_body);
      assert.isNotNull(res.resp_body.ListAllMyBucketsResult.Buckets.Bucket);
    } 
  },
  'GET bucket': {
    topic: api.get(bucket_name),
    'should respond with either 501 or 200 code':  function (err,res) {
      assert.include([200,501],res.statusCode);
    },
    'should respond with either a valid list or a valid error': function (err,res) {
      assert.isNotNull(res.resp_body);
      if (res.statusCode === 200) {
        assert.isNotNull(res.resp_body.ListBucketResult.Contents);
      } else {
        assert.isNotNull(res.resp_body.Error);
      }
    } 
  },
  'GET bucket?prefix=/&delimiter=/': {
    topic: api.get(bucket_name+'?prefix=/&delimiter=/'),
    'should respond with either 501 or 200 code':  function (err,res) {
      assert.include([200,501],res.statusCode);
    },
    'should respond with a valid list of prefixes or a valid error': function (err,res) {
      assert.isNotNull(res.resp_body);
      if (res.statusCode === 200) {
        assert.isNotNull(res.resp_body.ListBucketResult.CommonPrefixes);
      } else {
        assert.isNotNull(res.resp_body.Error);
      }
    } 
  },
  'GET bucket?max-keys=1': {
    topic: api.get(bucket_name+'?max-keys=1'),
    'should respond with either 501 or 200 code':  function (err,res) {
      assert.include([200,501],res.statusCode);
    },
    'should respond with either a list with only one object or an error': function (err,res) {
      assert.isNotNull(res.resp_body);
      if (res.statusCode === 200) {
        assert.isObject(res.resp_body.ListBucketResult);
      } else {
        assert.isNotNull(res.resp_body.Error);
      }
    } 
  }
}).addBatch({
  'GET bucket/testbasic-1.txt': {
    topic: api.get_data(bucket_name+'/testbasic-1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the content of the file': function (err,res) {
      var str1 = fs.readFileSync('./file1.txt');
      assert.equal(str1,res.resp_body);
    } 
  }
}).addBatch({
  'DELETE bucket/testbasic-1.txt' : {
    topic: api.del(bucket_name+'/testbasic-1.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE bucket/A/B.txt' : {
    topic: api.del(bucket_name+'/A/B.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE bucket/A/B/C.txt' : {
    topic: api.del(bucket_name+'/A/B/C.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  }
}).addBatch({
  'DELETE bucket' : {
    topic: api.del(bucket_name),
    'should respond with a 204 OK':  assertStatus(204)
  }
});
suite.export(module);
