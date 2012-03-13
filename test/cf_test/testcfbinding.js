/*
Copyright (c) 2011 VMware, Inc.

GET /~bind[/]{0,1}$
PUT /~bind[/]{0,1}$
PUT /~unbind[/]{0,1}$
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');

var config = JSON.parse(require('./utils').execSync("curl http://localhost:9981/~config")); //must be the config you actually use for the vblob  instance

var test_date = new Date().valueOf();
var container_name = '/sonic-test'+test_date;
var suite = vows.describe('testcfbinding: test cloundfoundry binding api on localhost:'+config.port);
var parse_xml = require('./utils').parse_xml;
var assertStatus = require('./utils').assertStatus;
var api = require('./utils').api;
var buff = new Buffer(config.keyID+":"+config.secretID);
var encoded = "Basic " + buff.toString("base64");

suite.addBatch({
  'PUT /~bind[/]{0,1}$ with auth': {
    topic: api.put_data('/~bind/','./file2.txt', {"Authorization" : encoded}),
    'should respond with a 200 OK':  assertStatus(200)
  }
}).addBatch({
  'GET /~bind[/]{0,1}$ without auth': {
    topic: api.get_data('/~bind'),
    'should respond with a 401':  assertStatus(401)
  },
  'GET /~bind[/]{0,1}$ with auth': {
    topic: api.get_data('/~bind',{"Authorization" : encoded}),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the binding pars': function (err,res) {
      var str1 = fs.readFileSync('./file2.txt');
      assert.equal(str1,res.resp_body);
    }
  }
}).addBatch({
  'PUT /~unbind[/]{0,1}$ with auth': {
    topic: api.put_data('/~unbind/','./file2.txt', {"Authorization" : encoded}),
    'should respond with a 200 OK':  assertStatus(200)
  }
}).addBatch({
  'GET /~bind[/]{0,1}$ with auth': {
    topic: api.get_data('/~bind',{"Authorization" : encoded}),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the binding pars': function (err,res) {
      assert.equal(res.resp_body,"{}");
    }
  }
});
suite.export(module);
