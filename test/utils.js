/*
Copyright (c) 2011-2012 VMware, Inc.
*/
var events = require('events');
var http = require('http');
var assert = require('assert');
var fs = require('fs');
var sax = require('sax');
var config = {port:9981}; //default!

module.exports.execSync = execSync = function(cmd) {
    var exec  = require('child_process').exec;
    var filename = '/tmp/'+Math.floor(10000 * Math.random()) + "-" + new Date().valueOf();
    exec(cmd + " > "+filename +" ; echo 'done' > " + filename+"-done");
    while (true) {
        try {
            var status = fs.readFileSync(filename+"-done", 'utf8');
            if (status.trim() == "done") {
                var res = fs.readFileSync(filename, 'utf8');
                fs.unlinkSync(filename+"-done");
                fs.unlinkSync(filename);
                return res;
            }
        } catch(e) { }
    }
};

module.exports.parse_xml = parse_xml = function(parser,resp,promise)
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
    char_buf = '';
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

module.exports.assertStatus = assertStatus = function(code) {
  return function(err,res) {
    //assert.isNull(err);
    assert.equal(res.statusCode,code);
  };
}

module.exports.api = api = {
  get: function(path2, headers) {
    return function() {
      var promise = new(events.EventEmitter);
      var options = {
        host : 'localhost',
        port : config.port,
        path : path2,
        method : 'GET'
      };
      if (headers) options.headers = headers;
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
  put: function(path2,headers) {
    return function() {
      var promise = new(events.EventEmitter);
      var options = {
        host : 'localhost',
        port : config.port,
        path : path2,
        method : 'PUT'
      };
      if (headers) options.headers = headers;
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
          parser.write(chunk.toString());
        });
        res.on('end', function() { parser !== null ? parser.close() : promise.emit('success',res);} ); 
      });
      req.end();
      return promise;
    };
  },
  del: function(path2,headers) {
    return function() {
      var promise = new(events.EventEmitter);
      var options = {
        host : 'localhost',
        port : config.port,
        path : path2,
        method : 'DELETE'
      };
      if (headers) options.headers = headers;
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
          parser.write(chunk.toString());
        });
        res.on('end', function() { parser !== null ? parser.close() : promise.emit('success',res);} ); 
      });
      req.end();
      return promise;
    };
  },
  get_data: function(path2,headers) {
    return function() {
      var promise = new(events.EventEmitter);
      var options = {
        host : 'localhost',
        port : config.port,
        path : path2,
        method : 'GET'
      };
      if (headers) options.headers = headers;
      var req = http.request(options);
      req.on('error', function(err) { promise.emit('error',err); } );
      req.on('response', function(res) { 
        res.resp_body = null;
        res.on('data',function(chunk) {
          if (res.resp_body === null) res.resp_body = '';
          res.resp_body += chunk;
        });
        res.on('end', function() { promise.emit('success',res);} ); 
      });
      req.end();
      return promise;
    };
  },
  put_data: function(path2,file_path, headers) {
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
          'content-length' : file_size
          //,expect : '100-continue'
        }
      };
      if (headers) {
        var keys = Object.keys(headers);
        for (var i = 0; i < keys.length; i++) options.headers[keys[i]] = headers[keys[i]];
      }
      var req = http.request(options);
      var parser = null;
      req.on('error', function(err) { promise.emit('error',err); } );
      req.on('response', function(res) { 
        req.ended = true;
        res.resp_body = null;
        res.on('data',function(chunk) {
          if (parser === null) {
            parser = sax.parser(true);
            parse_xml(parser,res,promise);
          }
          parser.write(chunk.toString());
        });
        res.on('end', function() { parser !== null ? parser.close() : promise.emit('success',res);} ); 
      });
      var stream = fs.createReadStream(file_path);
      stream.on('data',function(chunk) { if (!req.ended) req.write(chunk); } );
      stream.on('end',function() { if (!req.ended) req.end(); } );
      return promise;
    };
  }
};
