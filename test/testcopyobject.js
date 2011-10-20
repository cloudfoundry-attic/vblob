/*
 put_hdrs = [ 'cache-control', 'content-disposition', 'content-encoding', 'content-length',
'content-type', 'expires'];
 copy_hdrs = [ 'x-amz-copy-source-if-match', 'x-amz-copy-source-if-none-match',
'x-amz-copy-source-if-unmodified-since', 'x-amz-copy-source-if-modified-since',
'x-amz-metadata-directive', 'x-amz-storage-class'];
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');
var events = require('events');
var config = JSON.parse(fs.readFileSync('../config.json')); //must be the config you actually use for the vblob  instance
var test_date = new Date().valueOf();
var bucket_name = '/sonic-test'+test_date;
var suite = vows.describe('testcopyobject: using bucket '+bucket_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
var parse_xml = require('./utils').parse_xml;
var assertStatus = require('./utils').assertStatus;
var api = require('./utils').api;
var sax = require('../drivers/s3/sax-js/lib/sax');
var util = require('util');
var XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";

suite.addBatch({
  'PUT bucket ' : {
    topic: api.put(bucket_name),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the location of the bucket': function (err,res) {
      assert.isNotNull(res.headers['location']);
    } 
  }
}).addBatch({
  'PUT bucket/testcopyobject-1.txt': {
    topic: api.put_data(bucket_name+'/testcopyobject-1.txt','./file1.txt',{
      'cache-control':'No-cache', 'content-disposition':'attachment; filename=testing.txt',
      'content-encoding':'x-gzip', 'content-type':'text/plain',
      'expires':'Thu, 01 Dec 1994 16:00:00 GMT', 'x-amz-meta-hello':'world'
      ,'content-md5':'9M/h68wG3FYp6CT8mUV6rg=='
    }),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  }
}).addBatch({
  'REPLACE bucket/testcopyobject-2.txt': {
    topic: api.put(bucket_name+'/testcopyobject-2.txt',{
      'cache-control':'cache', 'content-disposition':'attachment; filename=copying.txt',
      'content-encoding':'none', 'content-type':'text',
      'expires':'Thu, 01 Dec 2011 16:00:00 GMT', 'x-amz-meta-hello':'hello',
      'content-length' : 0,
      'x-amz-copy-source': bucket_name+'/testcopyobject-1.txt',
      'x-amz-metadata-directive':'REPLACE'
      }),
    'should respond with a 200 code':  assertStatus(200),
    'should respond with a copy message': function (err,res) {
      assert.isNotNull(res.resp_body.CopyObjectResult);
    } 
  }
}).addBatch({
  'GET bucket/testcopyobject-2.txt': {
    topic: api.get_data(bucket_name+'/testcopyobject-2.txt'),
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
      assert.equal(res.headers['x-amz-meta-hello'],'hello');
    } 
  }
}).addBatch({
  'COPY bucket/testcopyobject-2.txt': {
    topic: api.put(bucket_name+'/testcopyobject-2.txt',{
      'cache-control':'cache', 'content-disposition':'attachment; filename=copying.txt',
      'content-encoding':'none', 'content-type':'text',
      'expires':'Thu, 01 Dec 2011 16:00:00 GMT', 'x-amz-meta-hello':'hello',
      'content-length' : 0,
      'x-amz-copy-source': bucket_name+'/testcopyobject-1.txt',
      'x-amz-metadata-directive':'COPY'
      }),
    'should respond with a 200 code':  assertStatus(200),
    'should respond with a copy message': function (err,res) {
      assert.isNotNull(res.resp_body.CopyObjectResult);
    } 
  }
}).addBatch({
  'GET bucket/testcopyobject-2.txt': {
    topic: api.get_data(bucket_name+'/testcopyobject-2.txt'),
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
      assert.equal(res.headers['x-amz-meta-hello'],'world');
    } 
  }
}).addBatch({
  'COPY bucket/testcopyobject-2.txt if-unmodified-since past': {
    topic: api.put(bucket_name+'/testcopyobject-2.txt',{
      'content-length' : 0,
      'x-amz-copy-source': bucket_name+'/testcopyobject-1.txt',
      'x-amz-copy-source-if-unmodified-since': new Date(new Date().valueOf()-500000).toUTCString()
      }),
    'should respond with a 412 code':  assertStatus(412),
    'should respond with an error message': function (err,res) {
      assert.isNotNull(res.resp_body.Error);
    } 
  },
  'COPY bucket/testcopyobject-2.txt if-modified-since future': {
    topic: api.put(bucket_name+'/testcopyobject-2.txt',{
      'content-length' : 0,
      'x-amz-copy-source': bucket_name+'/testcopyobject-1.txt',
      'x-amz-copy-source-if-modified-since': new Date(new Date().valueOf()+50000).toUTCString()
      }),
    'should respond with a 200 code':  assertStatus(200)
  },
  'COPY bucket/testcopyobject-2.txt if-match': {
    topic: api.put(bucket_name+'/testcopyobject-2.txt',{
      'content-length' : 0,
      'x-amz-copy-source': bucket_name+'/testcopyobject-1.txt',
      'x-amz-copy-source-if-match': 'f4cfe1ebcc06dc5629e824fc99457aae'
      }),
    'should respond with a 200 code':  assertStatus(200)
  },
  'COPY bucket/testcopyobject-2.txt if-none-match': {
    topic: api.put(bucket_name+'/testcopyobject-2.txt',{
      'content-length' : 0,
      'x-amz-copy-source': bucket_name+'/testcopyobject-1.txt',
      'x-amz-copy-source-if-none-match': 'f4cfe1ebcc06dc5629e824fc99457aae'
      }),
    'should respond with a 412 code':  assertStatus(412),
    'should respond with an error message': function (err,res) {
      assert.isNotNull(res.resp_body.Error);
    } 
  }
}).addBatch({
  'DELETE bucket/testcopyobject-1.txt' : {
    topic: api.del(bucket_name+'/testcopyobject-1.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE bucket/testcopyobject-2.txt' : {
    topic: api.del(bucket_name+'/testcopyobject-2.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  }
}).addBatch({
  'DELETE bucket' : {
    topic: api.del(bucket_name),
    'should respond with a 204 OK':  assertStatus(204)
  }
});
suite.export(module);
