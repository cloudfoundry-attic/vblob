/*
Copyright (c) 2012 VMware, Inc.

testing quota in fs driver
must set the vblob instance running fs driver
quota should be set to a reasonably small value
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');
var events = require('events');
var config = JSON.parse(require('./utils').execSync("curl http://localhost:9981/~config")); //must be the config you actually use for the vblob  instance

var test_date = new Date().valueOf();
var container_name = '/sonic-test'+test_date;
var suite = vows.describe('testquotas: using container '+container_name+' against driver '+config['current_driver']+' on localhost:'+config.port);
var parse_xml = require('./utils').parse_xml;
var assertStatus = require('./utils').assertStatus;
var api = require('./utils').api;
var sax = require('sax');
var util = require('util');
var XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";
var fs_option = null;
(function() {
  var nIdx;
  for (nIdx=0; nIdx<config.drivers.length; ++nIdx) {
    if (config.drivers[nIdx][config["current_driver"]]) break; 
  }
  fs_option = config.drivers[nIdx][config["current_driver"]].option;
})();
var unit_size = fs.statSync('./filex.dat').size;

suite.addBatch({'TOPLEVEL':{
  topic: function() {setTimeout(this.callback,6000); },
  'PUT container ' : {
    topic: api.put(container_name),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the location of the container': function (err,res) {
      assert.isString(res.headers['location']);
    } 
  }
}}).addBatch({
  'PUT quota files': {
    topic: function() {
      var success_cnt,error_cnt;
      success_cnt=error_cnt=0;
      var provision_evt = new (events.EventEmitter);
      var total_num = Math.floor((fs_option["quota"]+unit_size-1)/unit_size);
      var total_num2 = fs_option["obj_limit"];
      if (total_num2 < total_num) total_num = total_num2;
      var batch_num = 1;
      var batch_processor = new (events.EventEmitter);
      batch_processor.on('next',function(nIdx) {
        var next_nIdx = nIdx + batch_num;
        if (next_nIdx > total_num) next_nIdx=total_num;
        var counter = next_nIdx - nIdx;
        for (; nIdx<next_nIdx; ++nIdx) {
          var evt = api.put_data(container_name+'/testquotas-'+nIdx+'.txt','./filex.dat',{})();
          evt.on('success',function(err,res) {
            success_cnt++; counter--;
            if (success_cnt+error_cnt==total_num)
              if (error_cnt==0) provision_evt.emit('success',null);
            if (counter == 0) setTimeout(function(){batch_processor.emit('next',next_nIdx);},8000);
          });
          evt.on('error',function(err) {
            error_cnt++; counter--;
            if (success_cnt+error_cnt==total_num)
            provision_evt.emit('success',null);
            if (counter == 0) setTimeout(function(){batch_processor.emit('next',next_nIdx);},8000);
          });
        }
      });
      batch_processor.emit('next',0);
      return provision_evt;
    },
    'all PUTs should succeed': function (err) {
      assert.isNull(err);
    } 
  }
}).addBatch({'TOPLEVEL':{
  topic: function() {
    setTimeout(this.callback, 10000);
  },
  'PUT container/testquotas-x.txt': {
    topic: api.put_data(container_name+'/testquotas-x.txt','./filex.dat'),
    'should respond with a 500 code':  function(err,res) {
      if (!err) assert.equal(res.statusCode,500);
    },
    'should respond with error message': function (err,res) {
      if (!err)
      assert.isObject(res.resp_body.Error);
    } 
  }
}}).addBatch({
  'DELETE a file' : {
    topic: api.del(container_name+'/testquotas-0.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  }
}).addBatch({'TOPLEVEL2': {
  topic: function() {
    setTimeout(this.callback,10000);
  },
  'PUT container/testquotas-0.txt': {
    topic: api.put_data(container_name+'/testquotas-0.txt','./filex.dat',{}),
    'should respond with a 200 code':  assertStatus(200)
  }
}}).addBatch({
  'DELETE all files' : {
    topic: function() {
      var success_cnt,error_cnt;
      success_cnt=error_cnt=0;
      var provision_evt = new (events.EventEmitter);
      var total_num = Math.floor((fs_option["quota"]+unit_size-1)/unit_size);
      var total_num2 = fs_option["obj_limit"];
      if (total_num2 < total_num) total_num = total_num2;
      var batch_num = 1;
      var batch_processor = new (events.EventEmitter);
      batch_processor.on('next',function(nIdx) {
        var next_nIdx = nIdx + batch_num;
        if (next_nIdx > total_num) next_nIdx=total_num;
        var counter = next_nIdx - nIdx;
        for (; nIdx<next_nIdx; ++nIdx) {
          var evt = api.del(container_name+'/testquotas-'+nIdx+'.txt')();
          evt.on('success',function(err,res) {
            success_cnt++;  counter--;
            if (success_cnt+error_cnt==total_num)
              if (error_cnt==0) provision_evt.emit('success',null); else provision_evt.emit('error','DeleteFileError');
            if (counter == 0) setTimeout(function(){batch_processor.emit('next',next_nIdx);},6000);
          });
          evt.on('error',function(err) {
            error_cnt++; counter--;
            if (success_cnt+error_cnt==total_num)
              provision_evt.emit('error','DeleteFileError');
            if (counter == 0) setTimeout(function(){batch_processor.emit('next',next_nIdx);},6000);
          });
        }
      });
      batch_processor.emit('next',0);
      return provision_evt;
    },
    'all DELETEs should succeed': function (err) {
      assert.isNull(err);
    } 
  }
}).addBatch({
  'DELETE container' : {
    topic: api.del(container_name),
    'should respond with a 204 OK':  assertStatus(204)
  }
});
suite.export(module);
