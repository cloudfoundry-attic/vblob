/*
  Based on knox project: https://github.com/LearnBoost/knox.git
  Additional library: sax-js xml parser: https://github.com/isaacs/sax-js.git (subject to change)
  Need amazon s3 id/key pair
  Need winston module for logging
*/
var winston = require('winston');
var knox = require('./index.js');
var fs  = require('fs');
var util = require('util');
var sax = require('./sax-js/lib/sax');
var url = require('url');
var mime = require('./lib/knox/mime');

function parse_xml(parser,resp)
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
    resp.resp_end();
  };
}

/*
  cl: S3_blob obj
  req: request to s3
  resp: response to client
  head: if it's HEAD verb
*/
function general_handler(cl,req,resp,head)
{
  if (head === null || head === undefined) { head = false; }
  req.on('response',function(res) {
    res.setEncoding('utf8');
    resp.resp_header = res.headers; resp.resp_code = res.statusCode;
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
      if (parser === null && resp.client_closed !== true) {
        parser = sax.parser(true);
        parse_xml(parser,resp);
      }
      if (resp.client_closed === true) { winston.log('warn',(new Date())+' - client connection closed!'); res.destroy(); if (parser) { parser=null;  } resp.resp_end();return; }
      parser.write(chunk);
    });
    res.on('end',function() { if (parser !== null) { parser.close(); } else { resp.resp_end();} }); //parse.end event will trigger response
  }).on('error',function(err) {
    resp.resp_header = {'Connection':'close'};
    resp.resp_code = 500;
    resp.resp_body = '{"Code":"500","Message":"Internal error: '+err+'"}';
    resp.resp_end();
  });
}

function S3_blob(credentials)
{
  this.client = knox.createClient({
    key: credentials.key,
    secret: credentials.secret
  });
  this.region_cache = { };
}

//requ: request from client; resp: response to client
S3_blob.prototype.create_container = function(container,requ,resp)
{
  var opt = {};
  if (requ.query.logging !== undefined) { opt.logging = requ.query.logging; }
  var req = this.client.put({bucket:container,query:opt},{});
  general_handler(this,req,resp);
  requ.on('data', function (chunk) { req.write(chunk); } );
  requ.on('end', function() { req.end(); } );
};

S3_blob.prototype.delete_container = function(container,resp)
{
  var req = this.client.del({bucket:container,endpoint:this.region_cache[container]},{});
  general_handler(this,req,resp);
  req.end();
};

S3_blob.prototype.create_file = function(container,filename,header,data,resp)
{
  var self = this;
  var parser = null;
  var keys = Object.keys(header);
  for (var idx = 0; idx < keys.length; idx++) {
    if (keys[idx].match(/^x-amz-acl$/i)) { delete header[keys[idx]]; break; } //remove acl, always create private object
  }
  this.client.putStream2(data,{bucket:container, "filename":filename,endpoint:this.region_cache[container]},header, function(err,res,chunk) {
    if (err) {//err,null,null
      resp.resp_header = {'Connection':'close'};
      resp.resp_code = 500;
      resp.resp_body = '{"Code":"500","Message":"Internal error: '+err+'"}';
      resp.resp_end();
    } else
    if (res!==null) {//null,res,null
      res.setEncoding('utf8');
      resp.resp_header = res.headers;
      resp.resp_code = res.statusCode;
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
        parse_xml(parser,resp);
      }
    } else if (chunk!==null)//null,null,chunk
    {
      if (!parser) {throw "Create_File response error!";} //resp.write(chunk);//shouldn't happen!
      else { parser.write(chunk);}
    }
    else {  if (parser) { parser.close(); }  else { resp.resp_end(); } }//null,null,null
  });
};

S3_blob.prototype.copy_file = function(container,filename,header,resp)
{
  var self = this;
  var keys = Object.keys(header);
  for (var idx = 0; idx < keys.length; idx++) {
    if (keys[idx].match(/^x-amz-acl$/i)) { delete header[keys[idx]]; break; } //remove acl, always create private object
  }
  var req = this.client.put({bucket:container,"filename":filename,endpoint:this.region_cache[container]},header);
  general_handler(this,req,resp);
  req.end();
};

S3_blob.prototype.delete_file = function(container,filename,resp)
{
  var req = this.client.del({bucket:container,"filename":filename,endpoint:this.region_cache[container]},{});
  general_handler(this,req,resp);
  req.end();
};

S3_blob.prototype.list_location = function(container,resp)
{
  var req = this.client.get({bucket:container,endpoint:this.region_cache[container],query:{"location":null}},{});
  general_handler(this,req,resp);
  req.end();
};

S3_blob.prototype.list_logging = function(container,resp)
{
  var req = this.client.get({bucket:container,endpoint:this.region_cache[container],query:{"logging":null}},{});
  general_handler(this,req,resp);
  req.end();
};

S3_blob.prototype.read_file = function(container, filename, range,verb,resp,requ)
{
  var cl = this;
  if (verb === 'head') { requ.query = null; }
  var req = this.client[verb]({bucket:container,"filename":filename,endpoint:this.region_cache[container],query:requ.query},requ.headers);
  var head = (verb === 'head');
  req.on('response',function(res) {
    //res.setEncoding('utf8');
    resp.resp_header = res.headers; resp.resp_code = res.statusCode;
    var parser = null;
    //special handling for redirect
    if (res.statusCode === 307) {
      var redirect = res.headers.location;
      var parsed = url.parse(redirect);
      var sp = parsed.hostname.split('.');
      var span = 60;
      cl.region_cache[sp[0]] = {"name":(sp[1]+'.'+sp[2]+'.'+sp[3]), "expire":(new Date().valueOf() + span * 1000) };
    }
    if (res.statusCode >= 300) { //only parse when error
      res.setEncoding('utf8');
      parser = sax.parser(true);
      parse_xml(parser,resp);
    }
    res.on('data',function(chunk) {//mean it's a GET
      if (resp.client_closed === true) { winston.log('warn',(new Date())+' - client connection closed!'); if (parser) { parser=null;}  res.destroy(); resp.resp_end();return; }
      if (parser) { parser.write(chunk); } //parse error message
      else {//streaming out data
        resp.resp_handler(chunk); //callback to stream out chunk data
      }
    });
    res.on('end',function() { if (parser) {parser.close(); } else { resp.resp_end();}}); //time to finish and response back to client
  }).on('error',function(err) {
    resp.resp_header = {'Connection':'close'};
    resp.resp_code = 500;
    resp.resp_body = '{"Code":"500","Message":"Internal error: '+err+'"}';
    resp.resp_end();
  });
  req.end();
};

S3_blob.prototype.list_containers = function(resp) {
  var req = this.client.get({},{});
  general_handler(this,req,resp);
  req.end();
};

S3_blob.prototype.list_container = function (container,opt,resp)
{
  var self = this;
  var req=this.client.get({bucket:container,query:opt,endpoint:this.region_cache[container]});
  general_handler(this,req,resp);
  req.end();
};

var S3_Driver = module.exports = function S3_Driver(client) {
  this.client = client;
};

S3_Driver.prototype.list_buckets = function(requ,resp)
{
  this.client.list_containers(resp);
};

/*
  queries:  marker / prefix / delimiter / max-keys / location / logging
*/

S3_Driver.prototype.list_bucket = function(container,option,resp)
{
  var keys = Object.keys(option);
  if (keys.length === 1 && keys.indexOf('location') !== -1) {
    this.client.list_location(container,resp);
  } else if (keys.length === 1 && keys.indexOf('logging') !== -1) {
    this.client.list_logging(container,resp);
  }
  else {
    delete option.location;
    delete option.logging;
    this.client.list_container(container,option,resp);
  }
};

//response body is a bit stream(if succeed), no need to parse XML
S3_Driver.prototype.read_file = function(container,filename,range,verb,resp,requ)
{
  this.client.read_file(container,filename,range,verb,resp,requ);
};

S3_Driver.prototype.create_file = function(container,filename,requ,resp)
{
  this.client.create_file(container,filename,requ.headers,requ,resp);
};

S3_Driver.prototype.copy_file = function(dest_c, dest_f, src_c,src_f,requ,resp)
{
  this.client.copy_file(dest_c,dest_f,requ.headers,resp);
};

S3_Driver.prototype.delete_file = function(container,filename,resp)
{
  this.client.delete_file(container,filename,resp);
};


S3_Driver.prototype.create_bucket = function(container,resp,requ)
{
  this.client.create_container(container,requ,resp);
};

S3_Driver.prototype.delete_bucket = function(container,resp)
{
  this.client.delete_container(container,resp);
};

S3_Driver.prototype.pingDest = function(callback) {
  var dns = require('dns');
  dns.resolve(this.client.client.endpoint, function(err,addr) {
    if (err) {
      winston.log('error',(new Date())+' - Cannot resolve s3 domain');
      callback(err);
    } else {
      var net = require('net');
      var sock = new net.Socket();
      sock.connect(80,addr[0]);
      sock.on('connect',function() { callback(); } );
      sock.on('error',function(err) {
        winston.log('error',(new Date())+' - Cannot connect to s3');
        callback(err);
      });
    }
  });
};

module.exports.createDriver = function(option,callback) {
  var S3_client = new S3_blob({
    key: option.key,
    secret: option.secret}
  );
  var dr = new S3_Driver(S3_client);
  if (callback) { callback(dr); }
  return dr;
};
