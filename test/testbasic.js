/*
  Basic test for basic vblob features: 
  - get buckets
  - get bucket
  - put bucket
  - put object
  - get object
  - delete object
  - delete bucket
  There are two ways of testing vblob gateway:
  A. Start a vblob gw instance WITHOUT "auth" : "enabled" at the end of the config file. This will allow anonymous access to apis. Then go ahead to test the above features in s3 / fs.
  B. Start a vblob gw instance WITH "auth" : "enabled" at the end of the config file. Then, start another vblob gw instance WITHOUT "auth". IN ADDITION, the second gw will have its s3 driver pointing to the previous vblob gw. To do this, add "endpoint" : "localhost", and "endport" : <port of the first gw> to s3 credentials of the second gw.

  Put it in another way:
  A.    client -> gw 1 without auth -> fs/s3 drivers
  B.    client -> gw 1 without auth -> s3 driver -> gw 2 with auth -> fs / s3 drivers
*/
var util = require('util');
var vows = require('vows');
var assert = require('assert');
var fs = require('fs');

var config = JSON.parse(fs.readFileSync('../config.json')); //must be the config you actually use for the vblob  instance
var http = require('http');
var events = require('events');
var sax = require('../drivers/s3/sax-js/lib/sax');
function parse_xml(parser,resp,promise)
{
  var parse_stack = [];
  var cur_obj = {};
  var char_buf = "";
  var acc = false;
  parser.onerror = function (e) {
    throw e;
  };
  parser.ontext = function (t) {
    if (!acc) { return; }
    char_buf += t;
  };
  parser.onopentag = function (node) {
    acc = true;
    parse_stack.push(cur_obj);
    cur_obj = {};
  };
  parser.onclosetag = function (name) {
    if (char_buf !== "" ) {
      cur_obj = parse_stack.pop();
      if (cur_obj[name]) {
        if (cur_obj[name].push)
        { cur_obj[name].push(char_buf); }
        else { cur_obj[name] = [cur_obj[name],char_buf]; }
      }
      else { cur_obj[name] = char_buf; }
    } else {
      var cur_obj2 = parse_stack.pop();
      if (cur_obj2[name]) {
        if (cur_obj2[name].push)
        { cur_obj2[name].push(cur_obj); }
        else { cur_obj2[name] = [cur_obj2[name],cur_obj]; }
      }
      else { cur_obj2[name] = cur_obj; }
      cur_obj = cur_obj2;
    }
    char_buf = "";
    acc = false;
  };
  parser.onend = function () {
    resp.resp_body = cur_obj;
    promise.emit('success',resp);
  };
}

function assertStatus(code) {
  return function(err,res) {
    assert.isNull(err);
    assert.equal(res.statusCode,code);
  };
}

var api = {
  get: function(path2) {
    return function() {
      var promise = new(events.EventEmitter);
      var options = {
        host : 'localhost',
        port : config.port,
        path : path2,
        method : 'GET'
      };
      var req = http.request(options);
      req.on('error', function(err) { promise.emit('error',err); } );
      req.on('response', function(res) { 
        var parser = sax.parser(true);
        res.resp_body = null;
        parse_xml(parser,res,promise);
        res.on('data',function(chunk) {
          parser.write(chunk.toString());
        });
        res.on('end', function() { parser.close();} ); 
      });
      req.end();
      return promise;
    };
  },
  put: function(path2) {
    return function() {
      var promise = new(events.EventEmitter);
      var options = {
        host : 'localhost',
        port : config.port,
        path : path2,
        method : 'PUT'
      };
      var req = http.request(options);
      var parser = null;
      req.on('error', function(err) { promise.emit('error',err); } );
      req.on('response', function(res) { 
        res.resp_body = null;
        res.on('data',function(chunk) {
          if (parser === null) {
            parser = sax.parser(true);
            parse_xml(parser,res,promise);
          }
          parser.write(chunk);
        });
        res.on('end', function() { parser !== null ? parser.close() : promise.emit('success',res);} ); 
      });
      req.end();
      return promise;
    };
  },
  del: function(path2) {
    return function() {
      var promise = new(events.EventEmitter);
      var options = {
        host : 'localhost',
        port : config.port,
        path : path2,
        method : 'DELETE'
      };
      var req = http.request(options);
      var parser = null;
      req.on('error', function(err) { promise.emit('error',err); } );
      req.on('response', function(res) { 
        res.resp_body = null;
        res.on('data',function(chunk) {
          if (parser === null) {
            parser = sax.parser(true);
            parse_xml(parser,res,promise);
          }
          parser.write(chunk);
        });
        res.on('end', function() { parser !== null ? parser.close() : promise.emit('success',res);} ); 
      });
      req.end();
      return promise;
    };
  },
  get_data: function(path2) {
    return function() {
      var promise = new(events.EventEmitter);
      var options = {
        host : 'localhost',
        port : config.port,
        path : path2,
        method : 'GET'
      };
      var req = http.request(options);
      req.on('error', function(err) { promise.emit('error',err); } );
      req.on('response', function(res) { 
        res.resp_body = '';
        res.on('data',function(chunk) {
          res.resp_body += chunk;
        });
        res.on('end', function() { promise.emit('success',res);} ); 
      });
      req.end();
      return promise;
    };
  },
  put_data: function(path2,file_path) {
    return function() {
      var promise = new(events.EventEmitter);
      var stats = fs.statSync(file_path);
      var file_size = stats.size;
      var options = {
        host : 'localhost',
        port : config.port,
        path : path2,
        method : 'PUT',
        headers : { 
          'content-length' : file_size,
          expect : '100-continue'
        }
      };
      var stream = fs.createReadStream(file_path);
      var req = http.request(options);
      var parser = null;
      req.on('error', function(err) { promise.emit('error',err); } );
      req.on('response', function(res) { 
        res.resp_body = null;
        res.on('data',function(chunk) {
          if (parser === null) {
            parser = sax.parser(true);
            parse_xml(parser,res,promise);
          }
          parser.write(chunk);
        });
        res.on('end', function() { parser !== null ? parser.close() : promise.emit('success',res);} ); 
      });
      stream.on('data',function(chunk) { req.write(chunk); } );
      stream.on('end',function() { req.end(); } );
      return promise;
    };
  }
};
var test_date = new Date().valueOf();
var bucket_name = '/sonic_test'+test_date;
var suite = vows.describe('testbasic: using bucket '+bucket_name+' against driver '+config['default']+' on localhost:'+config.port);
suite.addBatch({
  'PUT bucket ' : {
    topic: api.put(bucket_name),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the location of the bucket': function (err,res) {
      assert.isNotNull(res.headers['location']);
    } 
  }
}).addBatch({
  'PUT bucket/testbasic_1.txt': {
    topic: api.put_data(bucket_name+'/testbasic_1.txt','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  },
  'PUT bucket/A/B.txt': {
    topic: api.put_data(bucket_name+'/A/B.txt','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  },
  'PUT bucket/A/B/C.txt': {
    topic: api.put_data(bucket_name+'/A/B/C.txt','./file1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the md5 hex of the file': function (err,res) {
      assert.isString(res.headers.etag);
    } 
  }
}).addBatch({
  'GET /': {
    topic: api.get('/'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with a valid list of buckets': function(err,res) {
      assert.isNotNull(res.resp_body);
      assert.isNotNull(res.resp_body.ListAllMyBucketsResult.Buckets.Bucket);
    } 
  },
  'GET bucket': {
    topic: api.get(bucket_name),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with a valid list of objects': function (err,res) {
      assert.isNotNull(res.resp_body);
      assert.isNotNull(res.resp_body.ListBucketResult.Contents);
    } 
  },
  'GET bucket?prefix=/&delimiter=/': {
    topic: api.get(bucket_name+'?prefix=/&delimiter=/'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with a valid list of prefixes': function (err,res) {
      assert.isNotNull(res.resp_body);
      assert.isNotNull(res.resp_body.ListBucketResult.CommonPrefixes);
    } 
  },
  'GET bucket?max-keys=1': {
    topic: api.get(bucket_name+'?max-keys=1'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with a list with only one object': function (err,res) {
      assert.isNotNull(res.resp_body);
      assert.isObject(res.resp_body.ListBucketResult.Contents);
    } 
  }
}).addBatch({
  'GET bucket/testbasic_1.txt': {
    topic: api.get_data(bucket_name+'/testbasic_1.txt'),
    'should respond with a 200 OK':  assertStatus(200),
    'should respond with the content of the file': function (err,res) {
      var str1 = fs.readFileSync('./file1.txt');
      assert.equal(str1,res.resp_body);
    } 
  }
}).addBatch({
  'DELETE bucket/testbasic_1.txt' : {
    topic: api.del(bucket_name+'/testbasic_1.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE bucket/A/B.txt' : {
    topic: api.del(bucket_name+'/A/B.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  },
  'DELETE bucket/A/B/C.txt' : {
    topic: api.del(bucket_name+'/A/B/C.txt'),
    'should respond with a 204 OK':  assertStatus(204)
  }
}).addBatch({
  'DELETE bucket' : {
    topic: api.del(bucket_name),
    'should respond with a 204 OK':  assertStatus(204)
  }
});
suite.export(module);
