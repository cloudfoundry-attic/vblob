/*!		
* knox - client		
* Copyright(c) 2010 LearnBoost <dev@learnboost.com>		
* Portions Copyright (c) 2011-2012 VMware, Inc.
* MIT Licensed		
*/

var utils = require('./utils')
  , auth = require('./auth')
  , http = require('http')
  , https = require('https')
  , url = require('url')
  , join = require('path').join
  , fs = require('fs');

var Client = module.exports = function Client(options) {
  if (!options.key) { this.key = 'dummy'; }
  if (!options.secret) { this.secret = 'dummy'; }
  this.endpoint = options.host || 's3.amazonaws.com';
  this.endport = options.port || 80;
  this.protocol = options.protocol || 'http';
  this.throttle = options.throttle || true;
  utils.merge(this, options);
};

Client.prototype.request = function(method, targets, headers){
  var content_md5 = "";
  var content_type = "";
  var cnt = 1;
  if (headers === undefined || headers === null) { headers = {}; }
  if (method==="PUT" && targets.filename) //only creating file checkes md5
  { cnt+=1; }
  if(true){
    var keys = Object.keys(headers);
    for (var idx=0, cnt2=0; idx<keys.length && cnt2<cnt;idx++) {
      if (cnt === 2 && keys[idx].match(/^content-md5$/i)) { cnt2++; content_md5=headers[keys[idx]]; }
      else if (keys[idx].match(/^content-type$/i)) { cnt2++; content_type=headers[keys[idx]]; }
    }
  }
  var dest = targets.endpoint;
  if (dest === undefined || dest === null) { dest = this.endpoint; }
  else {
    if (dest.expire > new Date().valueOf()) { dest = dest.name; }
    else { dest = this.endpoint; }
  }
  var options = { host: dest, port: this.endport }
    , date = new Date();

  if (headers === null || headers === undefined) { headers = {}; }

  // Default headers
  utils.merge(headers, {
      date: date.toUTCString() 
    , host: dest 
  });

  // Authorization header
  //resource: "/" for listing buckets; otherwise bucket or file level operations
  headers.authorization = auth.authorization({
      key: this.key
    , secret: this.secret
    , verb: method
    , md5 : content_md5
    , date: date.toUTCString()
    , resource: auth.canonicalizeResource((targets.bucket===undefined || targets.bucket === null)?'/':(targets.filename ? '/'+targets.bucket+'/'+targets.filename+utils.to_query_string(targets.query):join('/',targets.bucket)+utils.to_query_string(targets.query)))
    , contentType: content_type
    , amazonHeaders: auth.canonicalizeHeaders(headers)
  });

  // Issue request
  options.method = method;
  options.path = (targets.bucket===undefined || targets.bucket === null)?'/':(targets.filename ? '/'+targets.bucket+'/'+targets.filename+utils.to_query_string(targets.query):join('/',targets.bucket)+utils.to_query_string(targets.query));
  options.headers = headers;
  var req = this.protocol === 'https' ? https.request(options) : http.request(options);
  req.url = this.protocol === 'https' ? this.https(targets.bucket,targets.filename?targets.filename:null, dest) : this.http(targets.bucket,targets.filename?targets.filename:null, dest);
  return req;
};

/**
 * PUT data to `targets` with optional `headers`.
 * If both bucket and filename are not null, create a file, otherwise create a bucket
 */

Client.prototype.put = function(targets, headers){
  headers = utils.merge({
      //expect: '100-continue' 
    }, headers || {});
  return this.request('PUT', targets, headers);
};



Client.prototype.putStream2 = function(stream, targets, headers, fn){
  var self = this;
  if ('function' === typeof headers) {
    fn = headers;
    headers = {};
  }
  var req = self.put(targets, headers);
  req.on('response', function(res){
    fn(null, res,null);
    res.on('data', function(chunk) {
      fn(null,null,chunk);
    });
    res.on('end',function() { fn(null,null,null);});
  });
  req.on('error', function(err) {
    fn(err,null);
  });
  var bytes_written = 0;
  var start_time = new Date().valueOf();
  stream
    .on('error', function(err){fn(err, null); req.end(); })
    .on('data', function(chunk){ 
      req.write(chunk);
      if (self.throttle == true) {
        bytes_written += chunk.length;
        var span = new Date().valueOf() - start_time;
        if (bytes_written * 1000 / span > 1)  {  
          //hack: to avoid socket hang up, activate throttling when client uploads > 1MB/sec
          stream.pause();
          setTimeout(function() { stream.resume(); }, 10); //pause for 0.01 sec
        }
      }
    })
    .on('end', function(){ req.end(); });
};

/**
 * GET `targets` with optional `headers`.
 * If both bucket and file are specified, get the actual file; if only bucket is specified list
 * bucket; otherwise list buckets
 */

Client.prototype.get = function(targets, headers){
  return this.request('GET', targets, headers);
};


/**
 * Issue a HEAD request on `targets` with optional `headers.
 */

Client.prototype.head = function(targets, headers){
  return this.request('HEAD', targets, headers);
};


/**
 * DELETE `targets` with optional `headers.
 *
 * @param {Hash} targets
 * @param {Object} headers
 * @return {ClientRequest}
 * @api public
 */

Client.prototype.del = function(targets, headers){
  return this.request('DELETE', targets, headers);
};


/**
 * Return a url to the given resource.
 *
 */

Client.prototype.url =
Client.prototype.http = function(bucket,filename,ep){
  var dest = ep; if (dest === null || dest === undefined) { dest = this.endpoint; }
  if (this.endport !== 80) { dest += ":"+this.endport; }
  if (bucket !== null) { dest = dest + "/"+bucket; if (filename !== null) { dest += "/"+filename; } }
  return 'http://' + dest
};

/**
 * Return an HTTPS url to the given resource.
 */

Client.prototype.https = function(bucket,filename,ep){
  var dest = ep; if (dest === null || dest === undefined) { dest = this.endpoint; }
  if (this.endport != 443) { dest += ":"+this.endport; }
  if (bucket !== null) { dest = dest + "/"+bucket; if (filename !== null) { dest += "/"+filename; } }
  return 'https://' + dest
};

module.exports.createClient = function(options){
  return new Client(options);
};
