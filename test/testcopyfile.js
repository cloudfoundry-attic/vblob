/*
Copyright (c) 2011 VMware, Inc.

 put_hdrs = [ 'cache-control', 'content-disposition', 'content-encoding', 'content-length',
'content-type', 'expires'];
 copy_hdrs = [ 'x-blb-metadata-copy-or-replace'];
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');
var events = require('events');
var config = JSON.parse(fs.readFileSync('../config.json')); //must be the config you actually use for the vblob  instance
var test_date = new Date().valueOf();
var container_name = '/sonic-test'+test_date;
var suite = vows.describe('testcopyfile: using container '+container_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
var parse_xml = require('./utils').parse_xml;
var assertStatus = require('./utils').assertStatus;
var api = require('./utils').api;
var sax = require('sax');
var util = require('util');
var XMLNS = "https://github.com/vmware-bdc/vblob/";

suite.addBatch({
  'PUT container ' : {
    topic: api.put(container_name),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the location of the container': function (err,res) {
      assert.isNotNull(res.headers['location']);
    } 
  }
}).addBatch({
  'PUT container/testcopyfile-1.txt': {
    topic: api.put_data(container_name+'/testcopyfile-1.txt','./file1.txt',{
      'cache-control':'No-cache', 'content-disposition':'attachment; filename=testing.txt',
      'content-encoding':'x-gzip', 'content-type':'text/plain',
      'expires':'Thu, 01 Dec 1994 16:00:00 GMT', 'x-blb-meta-hello':'world'
      ,'content-md5':'9M/h68wG3FYp6CT8mUV6rg=='
    }),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  }
}).addBatch({
  'REPLACE container/testcopyfile-2.txt': {
    topic: api.put(container_name+'/testcopyfile-2.txt',{
      'cache-control':'cache', 'content-disposition':'attachment; filename=copying.txt',
      'content-encoding':'none', 'content-type':'text',
      'expires':'Thu, 01 Dec 2011 16:00:00 GMT', 'x-blb-meta-hello':'hello',
      'content-length' : 0,
      'x-blb-copy-from': container_name+'/testcopyfile-1.txt',
      'x-blb-metadata-copy-or-replace':'REPLACE'
      }),
    'should respond with a 200 code':  assertStatus(200),
    'should respond with a copy message': function (err,res) {
      assert.isNotNull(res.resp_body);
    } 
  }
}).addBatch({
  'GET container/testcopyfile-2.txt': {
    topic: api.get_data(container_name+'/testcopyfile-2.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the content of the file': function (err,res) {
      var str1 = fs.readFileSync('./file1.txt');
      assert.equal(str1,res.resp_body);
    },
    'should have correct meta info': function(err,res) {
      assert.equal(res.headers['cache-control'],'cache');
      assert.equal(res.headers['content-disposition'],'attachment; filename=copying.txt');
      assert.equal(res.headers['content-encoding'],'none');
      assert.equal(res.headers['content-type'],'text');
      assert.equal(res.headers['expires'],'Thu, 01 Dec 2011 16:00:00 GMT');
      assert.equal(res.headers['x-blb-meta-hello'],'hello');
    } 
  }
}).addBatch({
  'COPY container/testcopyfile-2.txt': {
    topic: api.put(container_name+'/testcopyfile-2.txt',{
      'cache-control':'cache', 'content-disposition':'attachment; filename=copying.txt',
      'content-encoding':'none', 'content-type':'text',
      'expires':'Thu, 01 Dec 2011 16:00:00 GMT', 'x-blb-meta-hello':'hello',
      'content-length' : 0,
      'x-blb-copy-from': container_name+'/testcopyfile-1.txt',
      'x-blb-metadata-copy-or-replace':'COPY'
      }),
    'should respond with a 200 code':  assertStatus(200),
    'should respond with a copy message': function (err,res) {
      assert.isNotNull(res.resp_body);
    } 
  }
}).addBatch({
  'GET container/testcopyfile-2.txt': {
    topic: api.get_data(container_name+'/testcopyfile-2.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the content of the file': function (err,res) {
      var str1 = fs.readFileSync('./file1.txt');
      assert.equal(str1,res.resp_body);
    },
    'should have correct meta info': function(err,res) {
      assert.equal(res.headers['cache-control'],'No-cache');
      assert.equal(res.headers['content-disposition'],'attachment; filename=testing.txt');
      assert.equal(res.headers['content-encoding'],'x-gzip');
      assert.equal(res.headers['content-type'],'text/plain');
      assert.equal(res.headers['expires'],'Thu, 01 Dec 1994 16:00:00 GMT');
      assert.equal(res.headers['x-blb-meta-hello'],'world');
    } 
  }
}).addBatch({
  'DELETE container/testcopyfile-1.txt' : {
    topic: api.del(container_name+'/testcopyfile-1.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE container/testcopyfile-2.txt' : {
    topic: api.del(container_name+'/testcopyfile-2.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  }
}).addBatch({
  'DELETE container' : {
    topic: api.del(container_name),
    'should respond with a 204 OK':  assertStatus(204)
  }
});
suite.export(module);
