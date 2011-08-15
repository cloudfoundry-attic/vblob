/*!
 * knox - Client
 * Copyright(c) 2010 LearnBoost <dev@learnboost.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var utils = require('./utils')
  , auth = require('./auth')
  , http = require('http')
  , https = require('https')
  , url = require('url')
  , join = require('path').join
  , mime = require('./mime')
  , fs = require('fs');

/**
 * Initialize a `Client` with the given `options`.
 *
 * Required:
 *
 *  - `key`     amazon api key
 *  - `secret`  amazon secret
 *
 * @param {Object} options
 * @api public
 */

var Client = module.exports = function Client(options) {
  if (!options.key) { throw new Error('aws "key" required'); }
  if (!options.secret) { throw new Error('aws "secret" required'); }
  this.endpoint = 's3.amazonaws.com';
  utils.merge(this, options);
};

/**
 * Request with optional `targets.filename` and optional `targets.bucket` with the given `method`, and optional `headers`.
 *
 * @param {String} method
 * @param {Hash} targets
 * @param {Object} headers
 * @return {ClientRequest}
 * @api private
 */

Client.prototype.request = function(method, targets, headers){
  var content_md5 = "";
  if (method==="PUT" && targets.filename) //only creating file checkes md5
  {
    var keys = Object.keys(headers);
    for (var idx =0; idx<keys.length;idx++) {
      if (keys[idx].match(/^content-md5$/i)) { content_md5=headers[keys[idx]]; break; }
    }
  }
  var dest = targets.endpoint;
  if (dest === undefined || dest === null) { dest = this.endpoint; }
  else {
    if (dest.expire > new Date().valueOf()) { dest = dest.name; }
    else { dest = this.endpoint; }
  }
  var options = { host: ( (targets.bucket!==undefined && targets.bucket !== null)?targets.bucket+".":"")+ dest, port: 443 }
    , date = new Date();

  if (headers === null || headers === undefined) { headers = {}; }

  // Default headers
  utils.merge(headers, {
      Date: date.toUTCString()
    , Host: ((targets.bucket!==undefined && targets.bucket !== null)?targets.bucket+".":"")+ dest
  });

  // Authorization header
  //resource: "/" for listing buckets; otherwise bucket or file level operations
  headers.Authorization = auth.authorization({
      key: this.key
    , secret: this.secret
    , verb: method
    , md5 : content_md5
    , date: date
    , resource: auth.canonicalizeResource((targets.bucket===undefined || targets.bucket === null)?'/':(targets.filename ?/* join('/', targets.bucket, targets.filename)*/ '/'+targets.bucket+'/'+targets.filename+utils.to_query_string(targets.query):join('/',targets.bucket)+'/'+utils.to_query_string(targets.query)))
    , contentType: headers['Content-Type']
    , amazonHeaders: auth.canonicalizeHeaders(headers)
  });

  // Issue request
  options.method = method;
  options.path = targets.filename?/*join('/', targets.filename)*/ '/'+targets.filename+utils.to_query_string(targets.query):'/'+ utils.to_query_string(targets.query);
  options.headers = headers;
  var req = https.request(options);
  req.url = this.https(targets.bucket,targets.filename?targets.filename:'', dest);
  return req;
};

/**
 * PUT data to `targets` with optional `headers`.
 * If both bucket and filename are not null, create a file, otherwise create a bucket
 * @param {Hash} targets
 * @param {Object} headers
 * @return {ClientRequest}
 * @api public
 */

Client.prototype.put = function(targets, headers){
  headers = utils.merge({
      Expect: '100-continue'
    }, headers || {});
  return this.request('PUT', targets, headers);
};

/**
 * PUT the file at `src` to `targets`, with callback `fn`
 * receiving a possible exception, and the response object.
 *
 * NOTE: this method reads the _entire_ file into memory using
 * fs.readFile(), and is not recommended or large files.
 *
 * Example:
 *
 *    client
 *     .putFile('package.json', {filename:'test/package.json',bucket:'bucket1'}, function(err, res){
 *       if (err) throw err;
 *       console.log(res.statusCode);
 *       console.log(res.headers);
 *     });
 *
 * @param {String} src
 * @param {Hash} targets
 * @param {Object|Function} headers
 * @param {Function} fn
 * @api public
 */

Client.prototype.putFile = function(src, targets, headers, fn){
  var self = this;
  if ('function' === typeof headers) {
    fn = headers;
    headers = {};
  }
  fs.readFile(src, function(err, buf){
    if (err) { return fn(err); }
    headers = utils.merge({
        'Content-Length': buf.length
      , 'Content-Type': mime.lookup(src)
    }, headers);
    self.put(targets, headers).on('response', function(res){
      fn(null, res);
    }).end(buf);
  });
};

/**
 * PUT the given `stream` as `targets` with optional `headers`.
 *
 * @param {Stream} stream
 * @param {Hash} targets
 * @param {Object|Function} headers
 * @param {Function} fn
 * @api public
 */

Client.prototype.putStream = function(stream, targets, headers, fn){
  var self = this;
  if ('function' === typeof headers) {
    fn = headers;
    headers = {};
  }
  fs.stat(stream.path, function(err, stat){
    if (err) { return fn(err); }
    // TODO: sys.pump() wtf?
    var req = self.put(targets, utils.merge({
        'Content-Length': stat.size
      , 'Content-Type': mime.lookup(stream.path)
    }, headers));
    req.on('response', function(res){
      fn(null, res);
    });
    stream
      .on('error', function(err){fn(null, err); })
      .on('data', function(chunk){ req.write(chunk); })
      .on('end', function(){ req.end(); });
  });
};


Client.prototype.putStream2 = function(stream, targets, headers, fn){
  var self = this;
  if ('function' === typeof headers) {
    fn = headers;
    headers = {};
  }
  // TODO: sys.pump() wtf?
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
  stream
    .on('error', function(err){fn(err, null); req.end(); })
    .on('data', function(chunk){ req.write(chunk); })
    .on('end', function(){ req.end(); });
};

/**
 * GET `targets` with optional `headers`.
 * If both bucket and file are specified, get the actual file; if only bucket is specified list
 * bucket; otherwise list buckets
 * @param {Hash} targets
 * @param {Object} headers
 * @return {ClientRequest}
 * @api public
 */

Client.prototype.get = function(targets, headers){
  return this.request('GET', targets, headers);
};

/**
 * GET `targets` with optional `headers` and callback `fn`
 * with a possible exception and the response.
 *
 * @param {Hash} targets
 * @param {Object|Function} headers
 * @param {Function} fn
 * @api public
 */

Client.prototype.getFile = function(targets, headers, fn){
  if ('function' === typeof headers) {
    fn = headers;
    headers = {};
  }
  return this.get(targets, headers).on('response', function(res){
    fn(null, res);
  }).end();
};

/**
 * Issue a HEAD request on `targets` with optional `headers.
 *
 * @param {Hash} targets
 * @param {Object} headers
 * @return {ClientRequest}
 * @api public
 */

Client.prototype.head = function(targets, headers){
  return this.request('HEAD', targets, headers);
};

/**
 * Issue a HEAD request on `targets` with optional `headers`
 * and callback `fn` with a possible exception and the response.
 *
 * @param {Hash} targets
 * @param {Object|Function} headers
 * @param {Function} fn
 * @api public
 */

Client.prototype.headFile = function(targets, headers, fn){
  if ('function' === typeof headers) {
    fn = headers;
    headers = {};
  }
  return this.head(targets, headers).on('response', function(res){
    fn(null, res);
  }).end();
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
 * DELETE `targets` with optional `headers`
 * and callback `fn` with a possible exception and the response.
 *
 * @param {Hash} targets
 * @param {Object|Function} headers
 * @param {Function} fn
 * @api public
 */

Client.prototype.deleteFile = function(targets, headers, fn){
  if ('function' === typeof headers) {
    fn = headers;
    headers = {};
  }
  return this.del(targets, headers).on('response', function(res){
    fn(null, res);
  }).end();
};

/**
 * Return a url to the given resource.
 *
 */

Client.prototype.url =
Client.prototype.http = function(bucket,filename,ep){
  var dest = ep; if (dest === null || dest === undefined) { dest = this.endpoint; }
  return 'http://' + join((bucket!==null?bucket+".":"")+dest, filename);
};

/**
 * Return an HTTPS url to the given resource.
 */

Client.prototype.https = function(bucket,filename,ep){
  var dest = ep; if (dest === null || dest === undefined) { dest = this.endpoint; }
  return 'https://' + join(bucket+"."+this.endpoint, filename);
};

/**
 * Return an S3 presigned url
 *
 */

Client.prototype.signedUrl = function(targets, expiration){
  var epoch = Math.floor(expiration.getTime()/1000);
  var signature = auth.signQuery({
    secret: this.secret,
    date: epoch,
    resource: '/' + targets.bucket + url.parse(targets.filename).pathname
  });

  return this.url(targets.filename) +
    '?Expires=' + epoch +
    '&AWSAccessKeyId=' + this.key +
    '&Signature=' + escape(signature);
};

/**
 * Shortcut for `new Client()`.
 *
 * @param {Object} options
 * @see Client()
 * @api public
 */

module.exports.createClient = function(options){
  return new Client(options);
};
