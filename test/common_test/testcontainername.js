/*
Copyright (c) 2011-2012 VMware, Inc.

  test validity of container names
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');

var config = JSON.parse(require('./utils').execSync("curl http://localhost:9981/~config")); //must be the config you actually use for the vblob  instance

var test_date = new Date().valueOf();
var container_name = '/sonic-test'+test_date;
var suite = vows.describe('testcontainername: using container prefix'+container_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
var parse_xml = require('./utils').parse_xml;
var assertStatus = require('./utils').assertStatus;
var api = require('./utils').api;

suite.addBatch({
  'no capital letters ' : {
    topic: api.put(container_name+'-CAPITAL'),
    'should respond with a 400 ':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  }
}).addBatch({
  'starting with lower case letters or numbers case 1' : {
    topic: api.put('/('+container_name),
    'should respond with a 400 ':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  },
  'starting with lower case letters or numbers case 2' : {
    topic: api.put('/A'+container_name),
    'should respond with a 400 ':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  }
}).addBatch({
  '< 3 chars ' : {
    topic: api.put('/ab'),
    'should respond with a 400 ':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  }
}).addBatch({
  '> 63 chars ' : {
    topic: api.put('/1234567812345678123456781234567812345678123456781234567812345678'),
    'should respond with a 400 ':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  }
}).addBatch({
  'no _ ' : {
    topic: api.put(container_name+'_'),
    'should respond with a 400 ':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  }
}).addBatch({
  'no ..' : {
    topic: api.put(container_name+'..'),
    'should respond with a 400 ':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  }
}).addBatch({
  'no -. ' : {
    topic: api.put(container_name+'-.'),
    'should respond with a 400 ':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  }
}).addBatch({
  'no .- ' : {
    topic: api.put(container_name+'.-'),
    'should respond with a 400 ':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  }
}).addBatch({
  'no IP address' : {
    topic: api.put('/1.2.3.4'),
    'should respond with a 400 ':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  }
}).addBatch({
  'no tailing -' : {
    topic: api.put(container_name+'-'),
    'should respond with a 400 OK':  assertStatus(400),
    'should respond with error message': function (err,res) {
      assert.isObject(res.resp_body.Error);
    } 
  }
});
suite.export(module);
