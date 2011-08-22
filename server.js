/*
  Additional modules: express  logger
*/
var logger = module.exports.logger = require('winston');
var valid_name = require('./common/bucket_name_check').is_valid_name;
var express = require("express");
var s3auth = require('./common/s3-auth');
var j2x = require('./common/json2xml');
var util = require('util');
var fs = require('fs');
var drivers = { }; //storing backend driver objects
var driver_order = { }; //storing the precedence of drivers for resolving bucket name conflict
var default_driver = null; //the driver object for creating a new bucket
var argv = process.argv;
var conf_file = "./config.json";
var XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";
for (var idx = 0; idx < argv.length; idx++)
{
  if (argv[idx] === "-f" && idx+1 < argv.length)
    { conf_file = argv[idx+1]; }
}

var config;
try
{
  config  = JSON.parse(fs.readFileSync(conf_file));
} catch (err)
{
  console.error("error:"+(new Date())+" - Reading configuration error: " + err);
  return;
}

if (config.logfile !== undefined && config.logfile !== null) {
  logger.add(logger.transports.File, {filename:config.logfile}).remove(logger.transports.Console);
}

var driver_start_callback = function (key) {
  return  function (obj) {
    obj.driver_key = key;
  };
};

if (true) {
  var drs = config.drivers;
  for (var i = 0, len = drs.length; i < len; ++i) {
    var dr = drs[i];
    var key = Object.keys(dr)[0];
    var value = dr[key];
    driver_order[key] = i;
    if (value.type === 's3') { drivers[key] = require('./blob_s3/blob_s3.js').createDriver(value.option, driver_start_callback(key) ); }
    else if (value.type === 'fs') { drivers[key] = require('./blob_fs/blob_fs.js').createDriver(value.option, driver_start_callback(key));}
    else { throw "unknown type of driver!"; }
    if (default_driver === null) {
      default_driver = drivers[key];
    }
    if (config["default"] !== undefined) {
      if (config["default"].toLowerCase() === key) {default_driver = drivers[key];}
    }
  }
}

var server_resp = function (res,statusCode, res_body)
{
  res.header('Connection','close');
  res.statusCode = statusCode;
  //res.header('Content-Length',res_body.length);
  res.header('Content-Type', 'application/xml');
  res.header('Date', new Date().toUTCString());
  res.header('Server', 'blob gw');
  res.end(res_body);
};

var general_resp = function (res) {
  return function () {
    if (res.client_closed) { return; }
    var headers = res.resp_header;
    headers.Connection = "close";
    if (headers.connection) { delete headers.Connection; }
    var res_body = "";
    if (res.resp_body) {
      res_body = j2x.json2xml(res.resp_body,0,res.resp_code >= 300?undefined:XMLNS);
      //headers["content-length"] = res_body.length;
      headers["content-type"] = "application/xml";
    }
    res.writeHeader(res.resp_code,headers);
    if (res.resp_body)
    { res.write(res_body); }
    res.end();
  };
};

var authenticate = function(req,res,next) {
  var Authorization = req.headers.Authorization;
  if (Authorization === undefined)
    { Authorization = req.headers.authorization; }
  var targets = {};
  if (req.params !== undefined && req.params.contain !== undefined) { targets.bucket = req.params.contain; }
  if (req.params !== undefined && req.params[0] !== undefined) { targets.filename = req.params[0]; }
  targets.query = req.query;
  var res_body;
  if (Authorization === undefined || s3auth.validate(config.keyID,config.secretID, req.method.toUpperCase(), targets, req.headers, Authorization) === false ) {
    res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"Unauthorized","Message":"Signature does not match"}}'),0);
    server_resp(res,401,res_body);
    return;
  }
  if (targets.bucket !== undefined && !valid_name(targets.bucket)) {
    logger.log('error',(new Date()) + ' - Invalid bucket name: ' + targets.bucket);
    res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"InvalidBucketName","Message":"The specified bucket is not valid"}}'),0);
    server_resp(res,400,res_body);
    return;
  }
  next();
};

var app = express.createServer( );
app.get('/',authenticate);
app.get('/',function(req,res) {
  if (req.method === 'HEAD') {
    res.header('Connection','close');
    res.end();
    return;
  }
  default_driver.pingDest(function(err) {
    if (err) {
      logger.log('error',(new Date())+" - "+default_driver.driver_key+".pingDest error: " + err);
      var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"InternalError","Message":"'+err.toString()+'"}}'),0);
      server_resp(res,500,res_body);
    } else
    { 
      res.resp_end = general_resp(res);
      default_driver.list_buckets(null,res); 
    }
  });
});


app.get('/:contain$', authenticate);
app.get('/:contain$',function(req,res) {
  res.client_closed = false;
  req.connection.addListener('close', function () {
    res.client_closed = true;
  });
  if (req.method === 'HEAD') {
    res.header('Connection','close');
    res.end();
    return;
  }
  var opt = {};
  if (req.query.marker) { opt.marker = req.query.marker; }
  if (req.query.prefix) { opt.prefix = req.query.prefix; }
  if (req.query.delimiter) { opt.delimiter = req.query.delimiter; }
  if (req.query["max-keys"]) { opt["max-keys"] = req.query["max-keys"]; }
  if (req.query.location !== undefined) { opt.location = req.query.location; }
  if (req.query.logging !== undefined) { opt.logging = req.query.logging; }
  res.resp_end = general_resp(res);
  default_driver.pingDest(function(err) {
    if (err) {
      logger.log('error',(new Date())+" - "+default_driver.driver_key+".pingDest error: " + err);
      var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"InternalError","Message":"'+err.toString()+'"}}'),0);
      server_resp(res,500,res_body);
    } else
    { default_driver.list_bucket(req.params.contain,opt,res); }
  });
});

app.get('/:contain/*',authenticate);
app.get('/:contain/*',function(req,res) {
  res.client_closed = false;
  req.connection.addListener('close', function () {
    res.client_closed = true;
  });
  res.resp_send = false;
  res.resp_handler = function (chunk) {
    if (res.resp_send === true) { res.write(chunk); return; }
    res.resp_send = true;
    var headers = res.resp_header;
    headers.Connection = "close";
    if (headers.connection) { delete headers.Connection; }
    res.writeHeader(res.resp_code,headers);
    res.write(chunk);
  };
  res.resp_end = function () {
    if (res.client_closed) { return; }
    if (res.resp_send === true) { res.end(); return; }
    var headers = res.resp_header;
    headers.Connection = "close";
    if (headers.connection) { delete headers.Connection; }
    var res_body = "";
    if (res.resp_body) {
      res_body = j2x.json2xml(res.resp_body,0,res.resp_code >= 300?undefined:XMLNS);
      //headers["content-length"] = res_body.length;
      headers["content-type"] = "application/xml";
    }
    res.writeHeader(res.resp_code,headers);
    if (res.resp_body)
    { res.write(res_body/*JSON.stringify(res.resp_body)*/); }
    res.end();
  };
  default_driver.pingDest(function(err) {
    if (err) {
      logger.log('error',(new Date())+" - "+default_driver.driver_key+".pingDest error: " + err);
      var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"InternalError","Message":"'+err.toString()+'"}}'),0);
      server_resp(res,500,res_body);
    } else
    { default_driver.read_file(req.params.contain, req.params[0], req.headers.range, req.method.toLowerCase(),res,req); }
  });
});

app.put('/:contain/*', authenticate);
app.put('/:contain/*', function(req,res) {
  //could put following handling to middle ware
  //here we only need:  copy (src, dest), either intra or inter drivers
  default_driver.pingDest(function(err) {
    if (err) {
      logger.log('error',(new Date())+" - "+default_driver.driver_key+".pingDest error: " + err);
      var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"InternalError","Message":"'+err.toString()+'"}}'),0);
      server_resp(res,500,res_body);
    } else {
      if (req.headers['x-amz-copy-source'] ) {
        var src = req.headers['x-amz-copy-source'];
        var src_buck = src.slice(1,src.indexOf('/',1));
        var src_file = src.substr(src.indexOf('/',1)+1);
        res.resp_end = general_resp(res);
        default_driver.copy_file(req.params.contain, req.params[0], src_buck, src_file, req,res);
      } else {
        res.resp_end = general_resp(res);
        default_driver.create_file(req.params.contain,req.params[0],req,res);
      }
    }
  });
});

app.put('/:contain', authenticate);
app.put('/:contain',function(req,res) {
  res.resp_end = general_resp(res);
  default_driver.pingDest(function(err) {
    if (err) {
      logger.log('error',(new Date())+" - "+default_driver.driver_key+".pingDest error: " + err);
      var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"InternalError","Message":"'+err.toString()+'"}}'),0);
      server_resp(res,500,res_body);
    } else
    { default_driver.create_bucket(req.params.contain,res,req); }  //res then req 
  });
});

app.delete('/:contain/*',authenticate);
app.delete('/:contain/*',function(req,res) {
  res.resp_end = general_resp(res);
  default_driver.pingDest(function(err) {
    if (err) {
      logger.log('error',(new Date())+" - "+default_driver.driver_key+".pingDest error: " + err);
      var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"InternalError","Message":"'+err.toString()+'"}}'),0);
      server_resp(res,500,res_body);
    } else
    { default_driver.delete_file(req.params.contain,req.params[0],res); }
  });
});

app.delete('/:contain', authenticate);
app.delete('/:contain',function(req,res) {
  res.resp_end = general_resp(res);
  default_driver.pingDest(function(err) {
    if (err) {
      logger.log('error',(new Date())+" - "+default_driver.driver_key+".pingDest error: " + err);
      var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"InternalError","Message":"'+err.toString()+'"}}'),0);
      server_resp(res,500,res_body);
    } else
    { default_driver.delete_bucket(req.params.contain,res); }
  });
});

logger.log('info',(new Date())+' - listening to port ' + config.port);
if (config.port)
{ app.listen(parseInt(config.port,10));} //should load from config file
exports.vblob_gateway = app;
