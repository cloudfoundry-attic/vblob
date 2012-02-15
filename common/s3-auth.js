/*!		
* Copyright(c) 2010 LearnBoost <dev@learnboost.com>		
* Portions Copyright (c) 2011-2012 VMware, Inc.
* MIT Licensed		
*/
var utils = require('./s3/utils');
var auth = require('./s3/auth');
var join = require('path').join;

var validate = function(keyID, secretID, method, targets, headers, signature){
  var content_md5 = "";
  var content_type = "";
  var cnt = 1;
  if (method==="PUT" && targets.filename) //only creating file checkes md5
    { cnt+=1; }
  if(true){
    var keys = Object.keys(headers);
    for (var idx=0, cnt2=0; idx<keys.length && cnt2<cnt;idx++) {
      if (cnt === 2 && keys[idx].match(/^content-md5$/i)) { cnt2++; content_md5=headers[keys[idx]]; }
      else if (keys[idx].match(/^content-type$/i)) { cnt2++; content_type=headers[keys[idx]]; }
    }
  }
  // Authorization header
  //resource: "/" for listing containers; otherwise container or file level operations
  var date = headers.Date; //use string form from header, no transformation
  if (date === undefined) { date = headers.date; }
  if (date === undefined) { return false; }
  var Authorization = auth.authorization({
      key: keyID
    , secret: secretID
    , verb: method
    , md5 : content_md5
    , contentType: content_type
    , date: date
    , resource: auth.canonicalizeResource((targets.container===undefined || targets.container === null)?'/':(targets.filename ?/* join('/', targets.container, targets.filename)*/ '/'+targets.container+'/'+targets.filename+utils.to_query_string(targets.query):join('/',targets.container)+utils.to_query_string(targets.query)))
    , contentType: content_type
    , amazonHeaders: auth.canonicalizeHeaders(headers)
  });
  return Authorization === signature;
};

module.exports.authenticate = function(creds, method, targets, headers, signature, resp){
  var key = null;
  if (signature) {
    key = signature.substring(4,signature.indexOf(':'));
  }
  if (!key || !creds[key] || validate(key, creds[key], method, targets, headers, signature) === false) {
    resp.resp_code = 401; resp.resp_header = {}; resp.resp_body = {Error:{Code:"Unauthorized",Message:"Signature does not match"}}; 
    return false;
  }
  return true;
};

