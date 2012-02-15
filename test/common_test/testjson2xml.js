/*
Copyright (c) 2011-2012 VMware, Inc.

  test validity of conversion between json and xml
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');
var j2x = require('../../common/json2xml').json2xml;
var events = require('events');
var suite = vows.describe('testjson2xml: testing conversion between json and xml');
var parse_xml = require('./utils').parse_xml;
var sax = require('sax');
var util = require('util');
var XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";
suite.addBatch({
  'simple json' : {
    topic: function() { return {str:'world', integer: 3234, numerical: 5.25, arr: ['13',23,2.23], hash: {str:'hello', integer: 52, numerical:4.24} } ; },
    'should be able to convert between json and xml' : function(topic) {
      var xml = j2x(topic, 0, undefined);
      var parser = sax.parser(true);
      var res = {};
      var promise = new(events.EventEmitter);
      promise.on('success',function(resp) {
        assert.deepEqual(resp.resp_body, topic);
      });
      parse_xml(parser,res,promise);
      parser.write(xml);
      parser.close();
     
    }
  }
}).addBatch({
  'complex json' : {
    topic: function() { return {str:'world', integer: 3234, numerical: 5.25, arr: ['13',23,2.23,
{ str:'aaa', integer: 323, numerical:52.2, arr:['23',2,2.23,{ h:'n'}], hash:{ h:'b'}}
], hash: {str:'hello', integer: 52, numerical:4.24} } ; },
    'should be able to convert between json and xml' : function(topic) {
      var xml = j2x(topic, 0, undefined,true);
      var parser = sax.parser(true);
      var res = {};
      var promise = new(events.EventEmitter);
      promise.on('success',function(resp) {
        assert.deepEqual(resp.resp_body, topic);
      });
      parse_xml(parser,res,promise);
      parser.write(xml);
      parser.close();
     
    }
  }
}).addBatch({
  'list containers xml' : { 
    topic: function() { return '<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Buckets><Bucket><Name>enum2</Name><CreationDate>2011-12-13T00:42:38.000Z</CreationDate></Bucket><Bucket><Name>enum1</Name><CreationDate>2011-12-13T00:40:46.000Z</CreationDate></Bucket></Buckets></ListBucketsResult>';
    },
    'should be able to parse and convert': function(topic) {
      var parser = sax.parser(true);
      var res = {};
      var promise = new(events.EventEmitter);
      promise.on('success',function(resp) {
        var xml = j2x(resp.resp_body,0,XMLNS);
        assert.equal(topic,xml);
      });
      parse_xml(parser,res,promise);
      parser.write(topic);
      parser.close();
    }
  },
  'list container xml' : { 
    topic: function() { 
     return '<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>enum1</Name><Prefix></Prefix><Marker></Marker><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated><Contents><Key>a.txt</Key><LastModified>Thu Dec 15 2011 17:36:00 GMT-0800 (PST)</LastModified><ETag>&quot;0c9d04a4c15fa36e0e47e486109599cd&quot;</ETag><Size>17826</Size></Contents></ListBucketResult>'; 
    },
    'should be able to parse and convert': function(topic) {
      var parser = sax.parser(true);
      var res = {};
      var promise = new(events.EventEmitter);
      promise.on('success',function(resp) {
        var xml = j2x(resp.resp_body,0,XMLNS);
        assert.equal(topic,xml);
      });
      parse_xml(parser,res,promise);
      parser.write(topic);
      parser.close();
    }
  }
}).addBatch({
  'error message xml' : {
    topic : function() { return '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>NoSuchContainer</Code><Message>The specified container does not exist</Message></Error>';},
    'should be able to convert to/from json': function(topic) {
      var parser = sax.parser(true);
      var res = {};
      var promise = new(events.EventEmitter);
      promise.on('success',function(resp) {
        var xml = j2x(resp.resp_body,0);
        assert.equal(topic,xml);
      });
      parse_xml(parser,res,promise);
      parser.write(topic);
      parser.close();
    }
  }
});
suite.export(module);
