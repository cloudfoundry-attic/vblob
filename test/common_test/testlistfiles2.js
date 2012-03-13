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
var suite = vows.describe('testlistfiles2: using container '+container_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
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
/*
sample.jpg

photos/2006/January/sample.jpg

photos/2006/February/sample2.jpg

photos/2006/February/sample3.jpg

photos/2006/February/sample4.jpg
*/
  'PUT container/sample.jpg': {
    topic: api.put_data(container_name+'/sample.jpg','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  },
  'PUT container/photos/2006/January/sample.jpg': {
    topic: api.put_data(container_name+'/photos/2006/January/sample.jpg','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  },
  'PUT container/photos/2006/February/sample2.jpg': {
    topic: api.put_data(container_name+'/photos/2006/February/sample2.jpg','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  },
  'PUT container/photos/2006/February/sample3.jpg': {
    topic: api.put_data(container_name+'/photos/2006/February/sample3.jpg','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  },
  'PUT container/photos/2006/February/sample4.jpg': {
    topic: api.put_data(container_name+'/photos/2006/February/sample4.jpg','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  }
}).addBatch({'TOPLEVEL': {
  topic: function() {
    setTimeout(this.callback, 5000); //wait 5 seconds
  },
  'GET container?prefix=p&marker=photos/2005&max-keys=3': {
    topic: api.get(container_name+'?prefix=p&marker=photos/2005&max-keys=3'),
    'should respond with 200 code':  function (err,res) {
      assert.include([200],res.statusCode);
    },
    'should respond with a valid list': function (err,res) {
      assert.equal(res.resp_body.ListBucketResult.Contents.length, 3);
      assert.equal(res.resp_body.ListBucketResult.IsTruncated, 'true');
      assert.equal(res.resp_body.ListBucketResult.Prefix, 'p');
      assert.equal(res.resp_body.ListBucketResult.Marker, 'photos/2005');
      assert.equal(res.resp_body.ListBucketResult.MaxKeys, '3');
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
  'GET container?delimiter=/': {
    topic: api.get(container_name+'?delimiter=/'),
    'should respond with either 501 or 200 code':  function (err,res) {
      assert.include([200,501],res.statusCode);
    },
    'should respond with a valid list of prefixes or a valid error': function (err,res) {
      if (res.statusCode === 200) {
        assert.equal(res.resp_body.ListBucketResult.Delimiter,'/');
        assert.equal(res.resp_body.ListBucketResult.IsTruncated, 'false');
        var contents = res.resp_body.ListBucketResult.Contents;
        var prefixes = res.resp_body.ListBucketResult.CommonPrefixes;
        assert.isObject(contents);
        assert.isObject(prefixes);
        assert.equal(contents.Key,'sample.jpg');
        assert.equal(prefixes.Prefix,'photos/');
      } else {
        assert.isObject(res.resp_body.Error);
      }
    } 
  },
  'GET container?prefix=photos/2006/&delimiter=/': {
    topic: api.get(container_name+'?prefix=photos/2006/&delimiter=/'),
    'should respond with either 501 or 200 code':  function (err,res) {
      assert.include([200,501],res.statusCode);
    },
    'should respond with a valid list of prefixes or a valid error': function (err,res) {
      if (res.statusCode === 200) {
        assert.equal(res.resp_body.ListBucketResult.Delimiter,'/');
        assert.equal(res.resp_body.ListBucketResult.IsTruncated, 'false');
        var contents = res.resp_body.ListBucketResult.Contents;
        var prefixes = res.resp_body.ListBucketResult.CommonPrefixes;
        assert.isUndefined(contents);
        assert.equal(prefixes.length, 2);
      } else {
        assert.isObject(res.resp_body.Error);
      }
    } 
  }
}}).addBatch({
  'DELETE container/sample.jpg' : {
    topic: api.del(container_name+'/sample.jpg'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE container/photos/2006/January/sample.jpg' : {
    topic: api.del(container_name+'/photos/2006/January/sample.jpg'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE container/photos/2006/February/sample2.jpg' : {
    topic: api.del(container_name+'/photos/2006/February/sample2.jpg'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE container/photos/2006/February/sample3.jpg' : {
    topic: api.del(container_name+'/photos/2006/February/sample3.jpg'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE container/photos/2006/February/sample4.jpg' : {
    topic: api.del(container_name+'/photos/2006/February/sample4.jpg'),
    'should respond with a 204 OK':  assertStatus(204)
  }
}).addBatch({
  'DELETE container' : {
    topic: api.del(container_name),
    'should respond with a 204 OK':  assertStatus(204)
  }
});
suite.export(module);
