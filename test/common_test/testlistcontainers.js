/*
Copyright (c) 2012 VMware, Inc.
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');
var events = require('events');
var config = JSON.parse(require('./utils').execSync("curl http://localhost:9981/~config")); //must be the config you actually use for the vblob  instance

var test_date = new Date().valueOf();
var container_name = '/sonic-test'+test_date;
var suite = vows.describe('testlistcontainers: using container '+container_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
var parse_xml = require('./utils').parse_xml;
var assertStatus = require('./utils').assertStatus;
var api = require('./utils').api;
var sax = require('sax');
var util = require('util');
var XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";

suite.addBatch({
  'PUT container ' : {
    topic: api.put(container_name),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the location of the container': function (err,res) {
      assert.isString(res.headers['location']);
    } 
  }
}).addBatch({
  'GET /': {
    topic: api.get('/'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with a valid list of containers': function(err,res) {
      assert.isObject(res.resp_body.ListAllMyBucketsResult);
      var obj = res.resp_body.ListAllMyBucketsResult;
      assert.isObject(obj.Owner);
      assert.isString(obj.Owner.ID);
      assert.isString(obj.Owner.DisplayName);
      assert.isObject(obj.Buckets);
      var buckets = obj.Buckets.Bucket;
      if (buckets === undefined) buckets = null;
      assert.isNotNull(buckets);
      if (!buckets.push) buckets = [buckets];
      for (var idx=0;idx<buckets.length;++idx) {
        assert.isObject(buckets[idx]);
        assert.isString(buckets[idx].Name);
        assert.isString(buckets[idx].CreationDate);
      } 
    } 
  }
}).addBatch({
  'DELETE container' : {
    topic: api.del(container_name),
    'should respond with a 204 OK':  assertStatus(204)
  }
});
suite.export(module);
