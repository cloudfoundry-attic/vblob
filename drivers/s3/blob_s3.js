/*
Copyright (c) 2011-2012 VMware, Inc.

  Need amazon s3 id/key pair
*/
var s3client = require('./s3client/client');
var fs  = require('fs');
var util = require('util');
var sax = require('sax');
var url = require('url');
var dns = require('dns');
var net = require('net');

function parse_xml(parser,resp_code, resp_header, callback)
{
  var parse_stack = [];
  var cur_obj = {};
  var char_buf = "";
  var acc = false;
  var err = null;
  parser.onerror = function (e) {
    if (err) return;
    err = e;
    resp_header = {};
    resp_code = 500;
    resp_body = {Code:500,Message:"Internal error: "+err};
    callback(resp_code, resp_header, resp_body, null);
  };
  parser.ontext = function (t) {
    if (err) return;
    if (!acc) { return; }
    char_buf += t;
  };
  parser.onopentag = function (node) {
    if (err) return;
    acc = true;
    parse_stack.push(cur_obj);
    cur_obj = {};
    char_buf = "";
  };
  parser.onclosetag = function (name) {
    if (err) return;
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
    if (err) return;
    callback(resp_code, resp_header, cur_obj, null);
  };
}

/*
  cl: S3_blob obj
  req: request to s3
  resp: response to client
  head: if it's HEAD verb
*/
function general_handler(cl,req,callback,head)
{
  var resp_header, resp_code, resp_body;
  resp_header = resp_code = resp_body = null;
  if (head === null || head === undefined) { head = false; }
  req.on('response',function(res) {
    res.setEncoding('utf8');
    res.dest_closed = false;
    resp_header = res.headers; resp_code = res.statusCode;
    var parser = null;
    //special handling for redirect
    if (res.statusCode === 307) {
      var redirect = res.headers.location;
      var parsed = url.parse(redirect);
      var sp = parsed.hostname.split('.');
      var span = 60;
      cl.region_cache[sp[0]] = {"name":(sp[1]+'.'+sp[2]+'.'+sp[3]), "expire":(new Date().valueOf() + span * 1000) };
    }
    res.on('data',function(chunk) {
      if (parser === null) {
        parser = sax.parser(true);
        parse_xml(parser,resp_code, resp_header, callback);
      }
      parser.write(chunk);
    });
    res.connection.on('close', function () {
      if (res.dest_closed === true) { return; }
      res.dest_closed = true;
      if (parser !== null) { parser.close(); } else { callback(resp_code,resp_header,resp_body,null);}
    });
    res.on('end',function() {
      if (res.dest_closed === true) { return; }
      res.dest_closed = true;
      if (parser !== null) { parser.close(); }
      else { callback(resp_code,resp_header,resp_body,null);}
    }); //parse.end event will trigger response
  }).on('error',function(err) {
    resp_header = {};
    resp_code = 500;
    resp_body = {Code:500,Message:"Internal error: "+err};
    callback(resp_code, resp_header, resp_body, null);
  });
}

function S3_blob(credentials,callback)
{
  this.region_cache = { };
  var this1 = this;
  this.client = null;
  this.logger = credentials.logger;
  var client = s3client.createClient(credentials);
  dns.resolve(client.endpoint, function(err,addr) {
    if (err) {
      this1.logger.error(('Cannot resolve s3 domain'));
      if (callback) { callback(this1,err); return; }
    } else {
      var sock = new net.Socket();
      sock.connect(client.endport,addr[0]);
      sock.on('connect',function() { sock.end();
        this1.client = client;
        if (callback) { callback(this1); return; }
      });
      sock.on('error',function(err) {
        sock.destroy();
        this1.logger.error(('Cannot connect to s3'));
        if (callback) { callback(this1,err); return; }
      });
    }
  });
}

S3_blob.prototype.container_create = function(bucket_name,data_stream,callback)
{
  var opt = {};
//  if (requ.query.logging !== undefined) { opt.logging = requ.query.logging; }
  var req = this.client.put({bucket:bucket_name,query:opt},{});
  general_handler(this,req,callback);
  data_stream.on('data', function (chunk) { req.write(chunk); } );
  data_stream.on('end', function() { req.end(); } );
};

S3_blob.prototype.container_delete = function(bucket_name,callback)
{
  var req = this.client.del({bucket:bucket_name,endpoint:this.region_cache[bucket_name]},{});
  general_handler(this,req,callback);
  req.end();
};

S3_blob.prototype.file_create = function(bucket_name,filename,create_options, create_meta_data, data,callback)
{
  var resp_header, resp_code, resp_body;
  resp_code = resp_header = resp_body = null;
  var self = this;
  var parser = null;
  var header = create_meta_data;
  var keys = Object.keys(create_options);
  for (var idx = 0; idx < keys.length; idx++)  header[keys[idx]] = create_options[keys[idx]];
  this.client.putStream2(data,{bucket:bucket_name, "filename":filename,endpoint:this.region_cache[bucket_name]},header, function(err,res,chunk) {
    if (err) {//err,null,null
      resp_header = {'Connection':'close'};
      resp_code = 500;
      resp_body = {Code:500,Message:"Internal error: "+err};
      callback(resp_code, resp_header, resp_body, null);
    } else
    if (res!==null) {//null,res,null
      res.setEncoding('utf8');
      resp_header = res.headers;
      resp_code = res.statusCode;
      //special handling for redirect
      if (res.statusCode === 307) {
        var redirect = res.headers.location;
        var parsed = url.parse(redirect);
        var sp = parsed.hostname.split('.');
        var span = 60;
        self.region_cache[sp[0]] = {"name":(sp[1]+'.'+sp[2]+'.'+sp[3]), "expire":(new Date().valueOf() + span * 1000) };
      }
      if (res.statusCode >= 300) {
        //need to parse
        parser = sax.parser(true);
        parse_xml(parser,resp_code, resp_header, callback);
      }
    } else if (chunk!==null)//null,null,chunk
    {
      if (!parser) {throw "Create_File response error!";} //shouldn't happen!
      else { parser.write(chunk);}
    }
    else {  if (parser) { parser.close(); }  else { callback(resp_code, resp_header, resp_body, null); } }//null,null,null
  });
};

S3_blob.prototype.file_copy = function(bucket_name,object_key,header,header2, callback)
{
  var self = this;
  var keys = Object.keys(header);
  for (var idx = 0; idx < keys.length; idx++) {
    if (keys[idx].match(/^x-amz-acl$/i)) { delete header[keys[idx]]; break; } //remove acl, always create private object
  }
  header["Content-Length"] = 0;
  keys = Object.keys(header2);
  for (var idx2 = 0; idx2 < keys.length; idx2++)
    header[keys[idx2]] = header2[keys[idx2]];
  var req = this.client.put({bucket:bucket_name,"filename":object_key,endpoint:this.region_cache[bucket_name]},header);
  general_handler(this,req,callback);
  req.end();
};

S3_blob.prototype.file_delete = function(bucket_name,filename,callback)
{
  var req = this.client.del({bucket:bucket_name,"filename":filename,endpoint:this.region_cache[bucket_name]},{});
  general_handler(this,req,callback);
  req.end();
};

S3_blob.prototype.list_location = function(bucket_name,callback)
{
  var req = this.client.get({bucket:bucket_name,endpoint:this.region_cache[bucket_name],query:{"location":null}},{});
  general_handler(this,req,callback);
  req.end();
};

S3_blob.prototype.list_logging = function(bucket_name,callback)
{
  var req = this.client.get({bucket:bucket_name,endpoint:this.region_cache[bucket_name],query:{"logging":null}},{});
  general_handler(this,req,callback);
  req.end();
};

S3_blob.prototype.file_read = function(bucket_name, filename, options, callback)
{
  var range = options.range;
  var verb = options.method;
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  var cl = this;
  var query = {};
  //get query from options
  var key = 'response-content-type';
  if (options[key]) { query[key] = options[key]; delete options[key]; }
  key = 'response-content-language';
  if (options[key]) { query[key] = options[key]; delete options[key]; }
  key = 'response-expires';
  if (options[key]) { query[key] = options[key]; delete options[key]; }
  key = 'response-cache-control';
  if (options[key]) { query[key] = options[key]; delete options[key]; }
  key = 'response-content-disposition';
  if (options[key]) { query[key] = options[key]; delete options[key]; }
  key = 'response-content-encoding';
  if (options[key]) { query[key] = options[key]; delete options[key]; }

  if (verb === 'head') { query = null; }
  var req = this.client[verb]({bucket:bucket_name,"filename":filename,endpoint:this.region_cache[bucket_name],query:query},options);
  var head = (verb === 'head');
  req.on('response',function(res) {
    //res.setEncoding('utf8');
    resp_header = res.headers; resp_code = res.statusCode;
    var parser = null;
    //special handling for redirect
    if (res.statusCode === 307) {
      var redirect = res.headers.location;
      var parsed = url.parse(redirect);
      var sp = parsed.hostname.split('.');
      var span = 60;
      cl.region_cache[sp[0]] = {"name":(sp[1]+'.'+sp[2]+'.'+sp[3]), "expire":(new Date().valueOf() + span * 1000) };
    }
    if (res.statusCode >= 300 && !head && res.statusCode !== 304) { //only parse when error
      res.setEncoding('utf8');
      parser = sax.parser(true);
      parse_xml(parser,resp_code, resp_header,callback);
      res.on('data',function(chunk) {//mean it's a GET
        parser.write(chunk); //parse error message
      });
      res.on('end',function() { parser.close(); } );
    } else {
      res.on('end',function() { res.end_called = true; });
      res.connection.on('close', function() { if (res.end_called === true) return; res.end_called = true; res.emit('end'); });
      callback(resp_code, resp_header, null, res);
    }
  }).on('error',function(err) {
    resp_header = {};
    resp_code = 500;
    resp_body = {Code:500,Message:"Internal error: "+err};
    callback(resp_code, resp_header, resp_body, null);
  });
  req.end();
};

S3_blob.prototype.container_list = function(callback) {
  var req = this.client.get({},{});
  general_handler(this,req,callback);
  req.end();
};

S3_blob.prototype.list_bucket = function (bucket_name,opt,callback)
{
  var self = this;
  var req=this.client.get({bucket:bucket_name,query:opt,endpoint:this.region_cache[bucket_name]});
  general_handler(this,req,callback);
  req.end();
};

function check_client(client,callback)
{
  if (client) return true;
  var resp_header ={};
  var resp_code = 500;
  var resp_body = {Code:500,Message:"No network connection to S3" };
  callback(resp_code, resp_header, resp_body, null);
  return false;
}

var S3_Driver = function S3_Driver(option,callback) {
  var this1 = this;
  var client = new S3_blob(option, function(obj,err) {
    if (err) {this1.s3_err = err; this1.client = null; if (callback) {callback(this1);} return; }
    this1.client = obj;
    if (callback) { callback(this1); }
  });
};

S3_Driver.prototype.container_list = function(callback)
{
  if (check_client(this.client,callback) === false) return;
  this.client.container_list(callback);
};

/*
  queries:  marker / prefix / delimiter / max-keys
*/

S3_Driver.prototype.file_list = function(bucket_name,option,callback)
{
  if (check_client(this.client,callback) === false) return;
    this.client.list_bucket(bucket_name,option,callback);
};

//response body is a bit stream(if succeed), no need to parse XML
S3_Driver.prototype.file_read = function(bucket_name,object_key,options, callback)
{
  if (check_client(this.client,callback) === false) return;
  this.client.file_read(bucket_name,object_key,options,callback);
};

S3_Driver.prototype.file_create = function(bucket_name,object_key,options,metadata,data_stream,callback)
{
  if (check_client(this.client,callback) === false) return;
  this.client.file_create(bucket_name,object_key, options, metadata, data_stream, callback);
};

S3_Driver.prototype.file_copy = function(bucket_name, object_key, source_bucket,source_object_key,options,metadata,callback)
{
  if (check_client(this.client,callback) === false) return;
  options["x-amz-copy-source"] = "/"+source_bucket+"/"+source_object_key;
  this.client.file_copy(bucket_name,object_key,options,metadata,callback);
};

S3_Driver.prototype.file_delete = function(bucket_name,object_key,callback)
{
  if (check_client(this.client,callback) === false) return;
  this.client.file_delete(bucket_name,object_key,callback);
};


S3_Driver.prototype.container_create = function(bucket_name,options,data_stream,callback)
{
  if (check_client(this.client,callback) === false) return;
  this.client.container_create(bucket_name,data_stream,callback);
};

S3_Driver.prototype.container_delete = function(bucket_name,callback)
{
  if (check_client(this.client,callback) === false) return;
  this.client.container_delete(bucket_name,callback);
};

S3_Driver.prototype.get_config = function() {
  var obj = {}; var obj2 = {};
  obj.type = "s3";
  obj2.key = this.client.client.key;
  obj2.secret = this.client.client.secret;
  obj2.endpoint = this.client.client.endpoint;
  obj2.endport = this.client.client.endport;
  obj2.protocol = this.client.client.protocol;
  obj.option = obj2;
  return obj;
};

module.exports.createDriver = function(option,callback) {
  return new S3_Driver(option,callback);
};
