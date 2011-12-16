/*
Copyright (c) 2011 VMware, Inc.
*/
var Logger = require('./common/logger').Logger; //logging module
var valid_name = require('./common/container_name_check').is_valid_name; //container name check
var express = require("express"); //express web framework
var j2x = require('./common/json2xml'); //json to xml transformation
var util = require('util');
var fs = require('fs');
var events = require('events');
var drivers = { }; //storing backend driver objects
var driver_order = { }; //give sequential numbering for drivers
var current_driver = null; //current driver in use
var argv = process.argv;
var conf_file = "./config.json";
var XMLNS = "https://github.com/vmware-bdc/vblob/";
var credential_hash = { };
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

if (config.keyID && config.secretID) { credential_hash[config.keyID] = config.secretID; }

var logger = new Logger(config.logtype, config.logfile);

var auth_module = null;
if (config.auth) {
  try {
    auth_module = require('./common/'+config.auth+'-auth'); //front end authentication
  } catch (err) 
  {
    logger.warn("Loading authentication module error: " + err);
    logger.warn("Disable authentication...");
  }
}

var app = express.createServer( );
var server_ready = new events.EventEmitter();
server_ready.pending_dr = 1; //one driver at any time

server_ready.on('start', function() {
  logger.info(('listening to port ' + config.port));
  if (config.port)
  { app.listen(parseInt(config.port,10));}
});

logger.info(('starting server'));
var driver_start_callback = function (key) {
  return  function (obj) {
    obj.driver_key = key;
    console.log('driver initialization done for '+key);
    server_ready.pending_dr--;
    if (server_ready.pending_dr === 0) server_ready.emit('start');
  };
};

(function() {
  var drs = config.drivers;
  for (var i = 0, len = drs.length; i < len; ++i) {
    var dr = drs[i];
    var key = Object.keys(dr)[0];
    var value = dr[key];
    driver_order[key] = i;
    if (config.current_driver === undefined && current_driver === null ||
        config.current_driver && config.current_driver.toLowerCase() === key) {
      value.option.logger = logger;
      current_driver = drivers[key] = require('./drivers/'+value.type).createDriver(value.option, driver_start_callback(key) );
    }
  }
})();

var hdr_case_conv_table = {"last-modified":"Last-Modified", "accept-ranges":"Accept-Ranges", "content-range":"Content-Range",
"content-length":"Content-Length", "content-type":"Content-Type",
"content-encoding":"Content-Encoding", "content-disposition":"Content-Disposition",
"content-language":"Content-Language",
"expires":"Expires", "cache-control":"Cache-Control",
"etag":"ETag", "date":"Date", "server":"Server"};
var normalize_resp_headers = function (headers,method, code, body, stream) {
  headers.Connection = "close";
  if (headers.connection) { headers.Connection = headers.connection; delete headers.connection; }
  var keys = Object.keys(hdr_case_conv_table);
  for (var idx = 0; idx < keys.length; idx++)
    if (headers[keys[idx]]) { headers[hdr_case_conv_table[keys[idx]]] = headers[keys[idx]]; delete headers[keys[idx]]; }
  if (!body && !stream && method !== 'head') {//no response payload, no type
    if (headers["Content-Type"]) delete headers["Content-Type"];
    //check if it's 204, if no add 0
    if (code !== 204) {
      headers["Content-Length"] = 0;
    }
  }
  if (body || code === 204) { //xml response, not content-length
    if (headers["Content-Length"]) delete headers["Content-Length"];
  }
  if (!headers.Date) { headers.Date = new Date().toUTCString(); }
  if (!headers.Server) { headers.Server = "Blob Service"; }
}

var general_resp = function (res,post_proc,verb) {//post_proc is for post-processing response body
  return function (resp_code, resp_header, resp_body, resp_data) {
    if (res.client_closed || res.already_sent) { return; }
    res.already_sent = true;
    var headers = resp_header;
    var xml_body = "";
    if (resp_body) {
      if (resp_code < 300 && post_proc) resp_body = post_proc(resp_body); //make sure not to process error response
      xml_body = j2x.json2xml(resp_body,0,resp_code >= 300?undefined:XMLNS);
      if (headers["content-type"]) delete headers["content-type"];
      headers["Content-Type"] = "application/xml";
    }
    normalize_resp_headers(headers, verb, resp_code, resp_body !== null, resp_data !== null);
    res.writeHeader(resp_code,headers);
    if (resp_body && verb !== 'head') {
      res.write(xml_body);
    }
    if (resp_data && verb !== 'head') {
      //need to stream out
      resp_data.pipe(res);
    } else res.end();
  };
};

var authenticate = function(req,res,next) {
  var Authorization = req.headers.authorization;
  var targets = {};
  if (req.params && req.params.container) { targets.container = req.params.container; }
  if (req.params && req.params[0]) { targets.filename = req.params[0]; }
  targets.query = req.query;
  if (auth_module) {
    //only do authentication if enabled
    var resp = {};
    if (auth_module.authenticate(credential_hash, req.method.toUpperCase(), targets, req.headers, Authorization, resp) === false) {
      general_resp(res, null, req.method.toLowerCase())(resp.resp_code, resp.resp_header, resp.resp_body, null);
      return;
    }
  }
  if (targets.container && !valid_name(targets.container)) {
    logger.error(('Invalid container name: ' + targets.container));
      general_resp(res,null,req.method.toLowerCase())(400,{},{Error:{Code:"InvalidContainerName",Message:"The specified container is not valid"}}, null);
    return;
  }
  next();
};

if (config.debug) {
  express.logger.token('headers', function(req, res){ return '\n' + req.method + ' ' + req.url + '\n' + util.inspect(req.headers) + '\n\n' + res._header + '\n'; })
  app.use(express.logger(':headers'));
}

//============= CF specific =========
//account mgt
if (config.account_file)
{
  try {
    var creds = JSON.parse(fs.readFileSync(config.account_file));
    credential_hash = creds;
    if (config.keyID && config.secretID) credential_hash[config.keyID] = config.secretID;
  } catch (err) {
    //do nothing
  }
  //set interval
  setInterval(function() {
    var creds={};
      try {
        creds = JSON.parse(fs.readFileSync(config.account_file));
      } catch(err)
      {
        //do nothing
      }
      credential_hash = creds;
      creds = null;
      if (config.keyID && config.secretID) credential_hash[config.keyID] = config.secretID;
    }, 1000);
  if (config.account_api && config.account_api === true) {
    var encoded_creds = (function(){
      var buff = new Buffer(config.keyID+":"+config.secretID);
      return "Basic " + buff.toString("base64");
      })();
    var basic_auth = function(req,res,next) {
      if (req.headers.authorization !== encoded_creds) {
        logger.error("req.auth: "+req.headers.authorization+" encoded_creds: "+encoded_creds);
        general_resp(res,null,req.method.toLowerCase())(401,{},{Error:{Code:"Unauthorized",Message:"Credentials do not match"}}, null);
        return;
      }
      next();
    };
    app.put('/~bind[/]{0,1}$', basic_auth);
    app.put('/~bind[/]{0,1}$', function(req,res) {
      var obj_str = "";
      req.on('data', function(chunk) { obj_str += chunk.toString();
        if (obj_str.length > 512) {
           req.destroy();
           general_resp(res,null,req.method.toLowerCase())(400,{},{Error:{Code:"MaxMessageLengthExceeded",Message:"Your request was too big."}}, null);
        }
      } );
      req.on('end', function() {
        var obj;
        try {
          obj = JSON.parse(obj_str); obj_str = null;
        } catch (err) {
          general_resp(res)(400,{},{Error:{Code:"BadJSONFormat",Message:"The request has bad JSON format"}},null);
          return;
        }
        //since it's single threaded, at this moment there won't be any concurrent (un)binding
        //sync opening the underlying file is safe
        var acc_obj= {};
        try {
          acc_obj = JSON.parse(fs.readFileSync(config.account_file));
        } catch (err) {
          //do nothing
        }
        var key = Object.keys(obj)[0];
        if (key === config.keyID || acc_obj[key]) {
          //reject this request
          general_resp(res,null,req.method.toLowerCase())(409,{},{Error:{Code:"KeyExists",Message:"The key you want to add already exists"}}, null);
        } else {
          //add to account file and ack
          acc_obj[key] = obj[key];
          fs.writeFileSync(config.account_file, JSON.stringify(acc_obj));
          general_resp(res,null,req.method.toLowerCase())(200,{},null, null);
        }
      });
    });
    app.get('/~bind[/]{0,1}$', basic_auth); 
    app.get('/~bind[/]{0,1}$', function(req,res) { //get all bindings for CF
      var tmp_fn = '/tmp/get-bind-'+new Date().valueOf()+'-'+Math.floor(Math.random()*10000);
      try {
        fs.writeFileSync(tmp_fn,(fs.readFileSync(config.account_file)));
      } catch (err) {
        fs.writeFileSync(tmp_fn,"{}");
      }
      var st = fs.createReadStream(tmp_fn);
      st.on('open', function(fd) {
        fs.unlinkSync(tmp_fn); //fs trick
        general_resp(res,null,req.method.toLowerCase())(200,{},null, st);
      });
    });
    app.put('/~unbind[/]{0,1}$', basic_auth);
    app.put('/~unbind[/]{0,1}$', function(req,res) {
      var obj_str = "";
      req.on('data', function(chunk) { obj_str += chunk.toString();
        if (obj_str.length > 512) {
           req.destroy();
           general_resp(res,null,req.method.toLowerCase())(400,{},{Error:{Code:"MaxMessageLengthExceeded",Message:"Your request was too big."}}, null);
        }
      } );
      req.on('end', function() {
        var obj;
        try {
          obj = JSON.parse(obj_str); obj_str = null;
        } catch (err) {
          general_resp(res)(400,{},{Error:{Code:"BadJSONFormat",Message:"The request has bad JSON format"}},null);
          return;
        }
        //since it's single threaded, at this moment there won't be any concurrent (un)binding
        //sync opening the underlying file is safe
        var acc_obj= {};
        try {
          acc_obj = JSON.parse(fs.readFileSync(config.account_file));
        } catch (err) {
          //do nothing
        }
        var key = Object.keys(obj)[0];
        if (key === config.keyID || !acc_obj[key]) {
          //reject this request
          general_resp(res,null,req.method.toLowerCase())(404,{},{Error:{Code:"NoSuchKey",Message:"The key you want to delete does not exist"}}, null);
        } else {
          //add to account file and ack
          delete acc_obj[key];
          fs.writeFileSync(config.account_file, JSON.stringify(acc_obj));
          general_resp(res,null,req.method.toLowerCase())(200,{},null, null);
        }
      });
    });
  }
}
//======== END OF CF specific ============

var container_list_post_proc = function(resp_body) {
  return resp_body;
};

var file_list_post_proc = function(resp_body) {
  return resp_body;
};

app.get('/',authenticate);
app.get('/',function(req,res) {
  if (req.method === 'HEAD') { //not allowed
    general_resp(res,null,'head')(405,{'Allow':'GET'},null, null);
    return;
  }
  current_driver.container_list(general_resp(res,container_list_post_proc));
});


app.get('/:container[/]{0,1}$', authenticate);
app.get('/:container[/]{0,1}$',function(req,res) {
  res.client_closed = false;
  req.connection.addListener('close', function () {
    res.client_closed = true;
  });
  var opt = {};
  if (req.query.marker) { opt.marker = req.query.marker; }
  if (req.query.prefix) { opt.prefix = req.query.prefix; }
  if (req.query.delimiter) { opt.delimiter = req.query.delimiter; }
  if (req.query["max-keys"]) { opt["max-keys"] = req.query["max-keys"]; }
  current_driver.file_list(req.params.container,opt,general_resp(res,file_list_post_proc,req.method.toLowerCase()));
});

var get_hdrs = [ 'if-modified-since','if-unmodified-since', 'if-match', 'if-none-match'];
var get_qrys = [];
app.get('/:container/*',authenticate);
app.get('/:container/*',function(req,res) {
  res.client_closed = false;
  req.connection.addListener('close', function () {
    res.client_closed = true;
  });
  var options = {}, idx;
  for (idx = 0; idx < get_qrys.length; idx++)
    if (req.query[get_qrys[idx]]) options[get_qrys[idx]] = req.query[get_qrys[idx]];
  for (idx = 0; idx < get_hdrs.length; idx++)
    if (req.headers[get_hdrs[idx]]) options[get_hdrs[idx]] = req.headers[get_hdrs[idx]];
  if (req.headers.range) options.range = req.headers.range;
  options.method = req.method.toLowerCase();
  current_driver.file_read(req.params.container, req.params[0], options,general_resp(res,null,options.method));
});

app.put('/:container[/]{0,1}$', authenticate);
app.put('/:container[/]{0,1}$',function(req,res) {
  //always empty option for now
  current_driver.container_create(req.params.container,{},req,general_resp(res));
});

var put_hdrs = [ 'cache-control', 'content-disposition', 'content-encoding', 'content-length',
'content-type', 'expires'];
var put_opts = ['content-md5'];
var copy_hdrs = [ 'x-blb-metadata-copy-or-replace' ];
app.put('/:container/*', authenticate);
app.put('/:container/*', function(req,res) {
  var metadata = {}, options = {}, idx;
  for (idx = 0; idx < put_hdrs.length; idx++)
    if (req.headers[put_hdrs[idx]]) metadata[put_hdrs[idx]] = req.headers[put_hdrs[idx]];
  var keys = Object.keys(req.headers);
  for (idx = 0; idx < keys.length; idx++) {
    if (keys[idx].match(/^x-blb-meta-/)) metadata[keys[idx]] = req.headers[keys[idx]];
  }
  keys = null;
  if (req.headers['x-blb-copy-from'] ) {
    var src = req.headers['x-blb-copy-from'];
    var src_buck = src.slice(1,src.indexOf('/',1));
    var src_obj = src.substr(src.indexOf('/',1)+1);
    for (idx = 0; idx < copy_hdrs.length; idx++)
      if (req.headers[copy_hdrs[idx]]) options[copy_hdrs[idx]] = req.headers[copy_hdrs[idx]];
    current_driver.file_copy(req.params.container, req.params[0], src_buck, src_obj, options, metadata, general_resp(res));
  } else {
    for (idx = 0; idx < put_opts.length; idx++)
      if (req.headers[put_opts[idx]]) options[put_opts[idx]] = req.headers[put_opts[idx]];
    current_driver.file_create(req.params.container,req.params[0],options,metadata,req,general_resp(res));
  }
});

app.delete('/:container[/]{0,1}$', authenticate);
app.delete('/:container[/]{0,1}$',function(req,res) {
  current_driver.container_delete(req.params.container,general_resp(res));
});

app.delete('/:container/*',authenticate);
app.delete('/:container/*',function(req,res) {
  current_driver.file_delete(req.params.container,req.params[0],general_resp(res));
});

exports.vblob_gateway = app;
