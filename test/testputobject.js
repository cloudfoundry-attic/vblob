/*
 put_hdrs = [ 'cache-control', 'content-disposition', 'content-encoding', 'content-length',
'content-type', 'expires'];
 put_opts = ['content-md5','x-amz-storage-class'];
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
var suite = vows.describe('testputobject: using bucket '+bucket_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
var parse_xml = require('./utils').parse_xml;
var assertStatus = require('./utils').assertStatus;
var api = require('./utils').api;
var sax = require('sax');
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
  'PUT bucket/testputobject-1.txt': {
    topic: api.put_data(bucket_name+'/testputobject-1.txt','./file1.txt',{
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
  'GET bucket/testputobject-1.txt': {
    topic: api.get_data(bucket_name+'/testputobject-1.txt'),
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
  'PUT bucket/testputobject-1.txt': {
    topic: api.put_data(bucket_name+'/testputobject-1.txt','./file1.txt',{'content-md5':'9M/h68wG3FYp6CT8mUV6rg='}),
    'should respond with a 400 code':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isNotNull(res.resp_body.Error);
    } 
  }
}).addBatch({
  'DELETE bucket/testputobject-1.txt' : {
    topic: api.del(bucket_name+'/testputobject-1.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  }
}).addBatch({
  'DELETE bucket' : {
    topic: api.del(bucket_name),
    'should respond with a 204 OK':  assertStatus(204)
  }
});
suite.export(module);
