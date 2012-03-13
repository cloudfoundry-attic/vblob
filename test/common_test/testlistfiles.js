/*
Copyright (c) 2012 VMware, Inc.
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');

var config = JSON.parse(require('./utils').execSync("curl http://localhost:9981/~config")); //must be the config you actually use for the vblob  instance

var test_date = new Date().valueOf();
var container_name = '/sonic-test'+test_date;
var suite = vows.describe('testlistfiles: using container '+container_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
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
  'PUT container/A.txt': {
    topic: api.put_data(container_name+'/A.txt','./file1.txt'),
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
}).addBatch({'TOPLEVEL': {
  topic: function() {
    setTimeout(this.callback, 5000); //wait 5 seconds
  },
  'GET container': {
    topic: api.get(container_name),
    'should respond with 200 code':  function (err,res) {
      assert.include([200],res.statusCode);
    },
    'should respond with a valid list': function (err,res) {
      assert.equal(res.resp_body.ListBucketResult.Contents.length, 3);
      var contents = res.resp_body.ListBucketResult.Contents;
      for (var idx=0;idx<contents.length;++idx) {
        assert.isString(contents[idx].Key);
        assert.isString(contents[idx].LastModified);
        assert.isString(contents[idx].ETag);
        assert.isString(contents[idx].Size);
        assert.isObject(contents[idx].Owner);
      }
    } 
  },
  'GET container?prefix=A&delimiter=/': {
    topic: api.get(container_name+'?prefix=A&delimiter=/'),
    'should respond with either 501 or 200 code':  function (err,res) {
      assert.include([200,501],res.statusCode);
    },
    'should respond with a valid list of prefixes or a valid error': function (err,res) {
      if (res.statusCode === 200) {
        var contents = res.resp_body.ListBucketResult.Contents;
        var prefixes = res.resp_body.ListBucketResult.CommonPrefixes;
        assert.isObject(contents);
        assert.isObject(prefixes);
        assert.equal(contents.Key,'A.txt');
        assert.equal(prefixes.Prefix,'A/');
      } else {
        assert.isObject(res.resp_body.Error);
      }
    } 
  }
}}).addBatch({
  'DELETE container/A.txt' : {
    topic: api.del(container_name+'/A.txt'),
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
