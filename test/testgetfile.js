/*
Copyright (c) 2011 VMware, Inc.

get_hdrs = [ 'if-modified-since','if-unmodified-since', 'if-match', 'if-none-match'];
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');
var events = require('events');
var config = JSON.parse(fs.readFileSync('../config.json')); //must be the config you actually use for the vblob  instance
var test_date = new Date().valueOf();
var container_name = '/sonic-test'+test_date;
var suite = vows.describe('testgetfile: using container '+container_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
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
  'PUT container/testgetfile-1.txt': {
    topic: api.put_data(container_name+'/testgetfile-1.txt','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  }
}).addBatch({
  'GET container/testgetfile-1.txt': {
    topic: api.get_data(container_name+'/testgetfile-1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the content of the file': function (err,res) {
      var str1 = fs.readFileSync('./file1.txt');
      assert.equal(str1,res.resp_body);
    } 
  },
  'GET container/testgetfile-1.txt if-unmodified-since past': {
    topic: api.get_data(container_name+'/testgetfile-1.txt',{'if-unmodified-since': new Date(new Date().valueOf()-500000).toUTCString()}),
    'should respond with 412': assertStatus(412),
    'should have error body': function(err,res) {
      assert.isNotNull(res.resp_body.Error);
    }
  },
  'GET container/testgetfile-1.txt if-unmodified-since future': {
    topic: api.get_data(container_name+'/testgetfile-1.txt',{'if-unmodified-since': new Date(new Date().valueOf()+500000).toUTCString()}),
    'should respond with 200': assertStatus(200),
    'should have body and length': function(err,res) {
      assert.isNotNull(res.resp_body);
      assert.isNotNull(res.headers['Content-Length']);
    }
  },
  'GET container/testgetfile-1.txt if-modified-since past': {
    topic: api.get_data(container_name+'/testgetfile-1.txt',{'if-modified-since': new Date(new Date().valueOf()-500000).toUTCString()}),
    'should respond with 200': assertStatus(200),
    'should have body and length': function(err,res) {
      assert.isNotNull(res.resp_body);
      assert.isNotNull(res.headers['Content-Length']);
    }
  }
}).addBatch({
'GET container/testgetfile-1.txt if-modified-since future': {
    topic: api.get_data(container_name+'/testgetfile-1.txt',{'if-modified-since': new Date(new Date().valueOf()+5000).toUTCString() }),
    'should respond with 200': assertStatus(200),
    'should have body': function(err,res) {
      assert.isNotNull(res.resp_body);
    }
  }
}).addBatch({
  'GET container/testgetfile-1.txt range 0-3': {
    topic: api.get_data(container_name+'/testgetfile-1.txt',{Range:"bytes=0-3"}),
    'should response with 206': assertStatus(206),
    'should have correct content': function(err,res) {
      var str1 = fs.readFileSync('./file1.txt').toString();
      assert.equal(str1.substring(0,4),res.resp_body);
    }
  },
  'GET container/testgetfile-1.txt range 3-': {
    topic: api.get_data(container_name+'/testgetfile-1.txt',{Range:"bytes=3-"}),
    'should response with 206': assertStatus(206),
    'should have correct content': function(err,res) {
      var str1 = fs.readFileSync('./file1.txt').toString();
      assert.equal(str1.substr(3),res.resp_body);
    }
  },
  'GET container/testgetfile-1.txt range -3': {
    topic: api.get_data(container_name+'/testgetfile-1.txt',{Range:"bytes=-3"}),
    'should response with 206': assertStatus(206),
    'should have correct content': function(err,res) {
      var str1 = fs.readFileSync('./file1.txt').toString();
      assert.equal(str1.substr(str1.length-3),res.resp_body);
    }
  },
  'GET container/testgetfile-1.txt range overflow': {
    topic: api.get_data(container_name+'/testgetfile-1.txt',{Range:"bytes=9999-"}),
    'should response with 416': assertStatus(416),
    'should have error message': function(err,res) {
      var parser = sax.parser(true);
      var res1 = {};
      var promise = new(events.EventEmitter);
      promise.on('success',function(resp) {
        assert.isNotNull(resp.resp_body.Error);
      });
      parse_xml(parser,res,promise);
      parser.write(res.resp_body.toString());
      parser.close();
    }
  }
}).addBatch({
  'GET with if-match case 1' : {
    topic: api.get_data(container_name+'/testgetfile-1.txt', {'if-match':'f4cfe1ebcc06dc5629e824fc99457aae'}),
    'should response with 200': assertStatus(200)
  },
  'GET with if-match case 2' : {
    topic: api.get_data(container_name+'/testgetfile-1.txt', {'if-match':'f4cfe1ebcc06dc5629e824fc99457aa'}),
    'should response with 412': assertStatus(412)
  },
  'GET with if-none-match case 1' : {
    topic: api.get_data(container_name+'/testgetfile-1.txt', {'if-none-match':'f4cfe1ebcc06dc5629e824fc99457aae'}),
    'should response with 304': assertStatus(304)
  },
  'GET with if-none-match case 2' : {
    topic: api.get_data(container_name+'/testgetfile-1.txt', {'if-none-match':'f4cfe1ebcc06dc5629e824fc99457aa'}),
    'should response with 200': assertStatus(200)
  }
}).addBatch({
  'DELETE container/testgetfile-1.txt' : {
    topic: api.del(container_name+'/testgetfile-1.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  }
}).addBatch({
  'DELETE container' : {
    topic: api.del(container_name),
    'should respond with a 204 OK':  assertStatus(204)
  }
});
suite.export(module);
