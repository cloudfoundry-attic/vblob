/*
  Additional modules: express  winston
*/
var winston = require('winston');
var express = require("express");
var s3auth = require('./common/s3-auth');
var j2x = require('./common/json2xml');
var util = require('util');
var fs = require('fs');
var drivers = { }; //storing backend driver objects
var driver_order = { }; //storing the precedence of drivers for resolving bucket name conflict
var default_driver = null; //the driver object for creating a new bucket
var BucketToDriverMap = { }; //bucket name to driver map
var argv = process.argv;
var conf_file = "./config.json";

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
  winston.add(winston.transports.File, {filename:config.logfile}).remove(winston.transports.Console);
}

var ResponseMock = function (dr) { this.driver = dr;};

var driver_list_buckets = function(obj) {
  var resp = new ResponseMock(obj);
  resp.resp_end = function () {
    //callback handling list_buckets output
    if (resp.resp_code !== 200) { throw resp.resp_body; }
    var buckets = resp.resp_body;
    buckets = buckets.ListAllMyBucketsResult.Buckets.Bucket;
    if (buckets.push === undefined) { buckets = [buckets];}
    for (var idx = 0, leng = buckets.length; idx < leng; ++idx) {
      var dr = BucketToDriverMap[buckets[idx].Name];
      if (dr === undefined || driver_order[dr.driver.driver_key] >= driver_order[resp.driver.driver_key]) {
        BucketToDriverMap[buckets[idx].Name] = {"driver" : resp.driver, "CreationDate" :buckets[idx].CreationDate};
      }
    }
  };
  //handle connection error
  /*
    Due to a bug in node, 'connection refused' exception cannot be caught by http.request
    This will result in terminating the whole process
    This function is here for working around the bug:
      1. explicitly test if the destination is reachable/responding
      2. return error if not; otherwise proceed to connect
    Every driver must implement this function "pingDest"
  */
  obj.pingDest(function(err) {
    if (err) {
      winston.log('error',(new Date())+" - "+obj.driver_key+".pingDest error: " + err);
      //clearInterval(obj["IntervalID"]);
      var keys = Object.keys(BucketToDriverMap);
      for (var i1 = 0; i1 < keys.length; i1++)
      {
        var va = BucketToDriverMap[keys[i1]];
        if (va.driver === obj) {
          BucketToDriverMap[keys[i1]] = null; delete BucketToDriverMap[keys[i1]];
        }
      }
    } else
    { obj.list_buckets(null,resp); }
  });
};

var driver_refresh_BucketToDriverMap = function (key) {
  return  function (obj) {
    obj.driver_key = key;
    obj.IntervalID = setInterval(driver_list_buckets, 30000, obj);
    driver_list_buckets(obj);
  };
};

if (true) {
//  var keys = Object.keys(config["drivers"]);
  var drs = config.drivers;
  for (var i = 0, len = drs.length; i < len; ++i) {
    var dr = drs[i];
    var key = Object.keys(dr)[0];
    var value = dr[key];
    driver_order[key] = i;
    if (value.type === 's3') { drivers[key] = require('./blob_s3/blob_s3.js').createDriver(value.option, driver_refresh_BucketToDriverMap(key) ); }
    else if (value.type === 'fs') { drivers[key] = require('./blob_fs/blob_fs.js').createDriver(value.option, driver_refresh_BucketToDriverMap(key));}
    else if (value.type === 'swift') { drivers[key] = require('./blob_sw/blob_sw.js').createDriver(value.option, driver_refresh_BucketToDriverMap(key));}
    else { throw "unknown type of driver!"; }
    if (default_driver === null) {
      if (config["default"] === undefined) {default_driver = drivers[key];}
      else if (config["default"].toLowerCase() === value.type) {default_driver = drivers[key];}
      else if (!(config["default"].toLowerCase() in {'s3':1,'fs':1,'swift':1})) {default_driver = drivers[key];}
    }
  }
}

var server_resp = function (res,statusCode, res_body)
{
  res.header('Connection','close');
  res.statusCode = statusCode;
  res.header('Content-Length',res_body.length);
  res.header('Content-Type', 'application/xml');
  res.header('Date', new Date().toUTCString());
  res.header('Server', 'blob gw');
  res.end(res_body);
};

var authenticate = function(req,res,next) {
  //console.log('headers: ' + util.inspect(req.headers));
  var Authorization = req.headers.Authorization;
  if (Authorization === undefined)
    { Authorization = req.headers.authorization; }
  //console.log('params: ' + req.params);
  var targets = {};
  if (req.params !== undefined && req.params.contain !== undefined) { targets.bucket = req.params.contain; }
  if (req.params !== undefined && req.params[0] !== undefined) { targets.filename = req.params[0]; }
  targets.query = req.query;
  //console.log('authorization: ' + Authorization);
  if (Authorization === undefined || s3auth.validate(config.keyID,config.secretID, req.method.toUpperCase(), targets, req.headers, Authorization) === false ) {
    var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"Unauthorized","Message":"Signature does not match"}}'),0);
    server_resp(res,401,res_body);
    return;
  }
  next();
};

//TODO: middleware to find proper driver
var app = express.createServer( );
app.get('/',authenticate);
app.get('/',function(req,res) {
  if (req.method === 'HEAD') {
    res.header('Connection','close');
    res.end();
    return;
  }
  //driver.list_buckets(req,res);
  var res_body = {};
  var obj1 = {"Owner": { 
    "ID" : config.keyID,
    "DisplayName" : config.keyID
  } };
  var buckets = {"Bucket" : [] };
  var keys = Object.keys(BucketToDriverMap);
  for (var i = 0, len = keys.length; i < len; ++i) {
    if (BucketToDriverMap[keys[i]].book_keeping === true) { continue; }
    buckets.Bucket.push( { "Name" : keys[i], "CreationDate" : BucketToDriverMap[keys[i]].CreationDate} );
  }
  obj1.Buckets = buckets;
  res_body.ListAllMyBucketsResult = obj1;
  res_body = j2x.json2xml(res_body,0,"http://s3.amazonaws.com/doc/2006-03-01");
  server_resp(res,200,res_body);
});

var exists_bucket = function(req,res,next) {
  var bucket = BucketToDriverMap[req.params.contain];
  if (bucket === undefined) {
    var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"BucketNotFound","Message":"No Such Bucket"}}'),0);
    server_resp(res,404,res_body);
    return;
  }
  req.driver = bucket.driver;
  next();
};

var non_exists_bucket = function(req,res,next) {
  var bucket = BucketToDriverMap[req.params.contain];
  if (bucket && bucket.driver !== default_driver) {
    var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"BucketExists","Message":"Can not create a bucket with existing name"}}'),0);
    server_resp(res,409,res_body);
    return;
  }
  next();
};

var remove_entry = function (container) {
  if (BucketToDriverMap[container] === undefined) {
    winston.log('warn',(new Date())+" - "+container+" already removed");
    return;
  }
  if (BucketToDriverMap[container].book_keeping === true)
  { delete BucketToDriverMap[container]; }
};

var general_resp = function (res) {
  return function () {
    if (res.client_closed) { return; }
    var headers = res.resp_header;
    headers.Connection = "close";
    if (headers.connection) { delete headers.Connection; }
    var res_body = "";
    if (res.resp_body) {
      res_body = j2x.json2xml(res.resp_body,0,res.resp_code >= 300?undefined:"http://s3.amazonaws.com/doc/2006-03-01");
      headers["content-length"] = res_body.length;
      headers["content-type"] = "application/xml";
    }
    res.writeHeader(res.resp_code,headers);
    if (res.resp_body)
    { res.write(res_body/*JSON.stringify(res.resp_body)*/); }
    res.end();
  };
};

app.get('/:contain$', authenticate);
app.get('/:contain$', exists_bucket);
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
  if (BucketToDriverMap[req.params.contain].book_keeping === true) {
    var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"SlowDown","Message":"Bucket temporarily unavailable"}}'),0);
    server_resp(res,503,res_body);
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
  req.driver.list_bucket(req.params.contain,opt,res);
});

app.get('/:contain/*',authenticate);
app.get('/:contain/*',exists_bucket);
app.get('/:contain/*',function(req,res) {
  res.client_closed = false;
  req.connection.addListener('close', function () {
    res.client_closed = true;
  });
  if (BucketToDriverMap[req.params.contain].book_keeping === true) {
    var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"SlowDown","Message":"Bucket temporarily unavailable"}}'),0);
    server_resp(res,503,res_body);
    return;
  }
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
      res_body = j2x.json2xml(res.resp_body,0,res.resp_code >= 300?undefined:"http://s3.amazonaws.com/doc/2006-03-01");
      headers["content-length"] = res_body.length;
      headers["content-type"] = "application/xml";
    }
    res.writeHeader(res.resp_code,headers);
    if (res.resp_body)
    { res.write(res_body/*JSON.stringify(res.resp_body)*/); }
    res.end();
  };
  req.driver.read_file(req.params.contain, req.params[0], req.headers.range, req.method.toLowerCase(),res,req);
});

app.put('/:contain/*', authenticate);
app.put('/:contain/*', exists_bucket);
app.put('/:contain/*', function(req,res) {
  if (BucketToDriverMap[req.params.contain].book_keeping === true) {
    var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"SlowDown","Message":"Bucket temporarily unavailable"}}'),0);
    server_resp(res,503,res_body);
    return;
  }
  //could put following handling to middle ware
  //here we only need:  copy (src, dest), either intra or inter drivers
  if (req.headers['x-amz-copy-source'] ) {
    var src = req.headers['x-amz-copy-source'];
    var src_buck = src.slice(1,src.indexOf('/',1));
    var src_file = src.substr(src.indexOf('/',1)+1);
    //res.header('Connection','closed'); res.write(src_buck+'\n'+src_file+'\n');res.end(); return;
    if ( !BucketToDriverMap[src_buck] ||
    BucketToDriverMap[src_buck].book_keeping === true )
    {
      var res_body2 = j2x.json2xml(JSON.parse('{"Error":{"Code":"BucketNotFound","Message":"Source bucket not found"}}'),0);
      server_resp(res,404,res_body2);
      return;
    }
    //copy object, for now assume intra backend
    var driver2 = BucketToDriverMap[src_buck].driver;
    if ((driver2 !== req.driver)) {
      var res_body3 = j2x.json2xml(JSON.parse('{"Error":{"Code":"NotImplemented","Message":"Copying across backends is not implemented"}}'),0);
      server_resp(res,501,res_body3);
      return;
    }
    res.resp_end = general_resp(res);
    req.driver.copy_file(req.params.contain, req.params[0], src_buck, src_file, req,res);
    //res.header('Connection','closed'); res.write('copy from bucket '+ src_buck + ' file ' + src_file);res.end(); return;
  } else {
    res.resp_end = general_resp(res);
    req.driver.create_file(req.params.contain,req.params[0],req,res);
  }
});

app.put('/:contain', authenticate);
app.put('/:contain', non_exists_bucket);
app.put('/:contain',function(req,res) {
  BucketToDriverMap[req.params.contain] = { "driver" : default_driver, "book_keeping" : true};
  res.resp_end = general_resp(res);
  default_driver.create_bucket(req.params.contain,res,req); //res then req
  //heuristic
  setTimeout(driver_list_buckets,4000,default_driver);
  setTimeout(remove_entry,6000,req.params.contain); //still have race condition
});

app.delete('/:contain/*',authenticate);
app.delete('/:contain/*',exists_bucket);
app.delete('/:contain/*',function(req,res) {
  if (BucketToDriverMap[req.params.contain].book_keeping === true) {
    var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"SlowDown","Message":"Bucket temporarily unavailable"}}'),0);
    server_resp(res,503,res_body);
    return;
  }
  res.resp_end = general_resp(res);
  req.driver.delete_file(req.params.contain,req.params[0],res);
});

app.delete('/:contain', authenticate);
app.delete('/:contain', exists_bucket);
app.delete('/:contain',function(req,res) {
  if (BucketToDriverMap[req.params.contain].book_keeping === true) {
    var res_body = j2x.json2xml(JSON.parse('{"Error":{"Code":"BucketNotFound","Message":"No Such Bucket"}}'),0);
    server_resp(res,404,res_body);
    return;
  }
  BucketToDriverMap[req.params.contain].book_keeping = true;
  res.resp_end = general_resp(res);
  req.driver.delete_bucket(req.params.contain,res);
  //heuristic
  setTimeout(driver_list_buckets,4000,req.driver);
  setTimeout(remove_entry,6000,req.params.contain); //still have race condition
});

winston.log('info',(new Date())+' - listening to port ' + config.port);
if (config.port)
{ app.listen(parseInt(config.port,10));} //should load from config file
exports.vblob_gateway = app;
