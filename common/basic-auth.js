/*!
* Copyright (c) 2011 VMware, Inc.
*/

var validate = function(keyID, secretID, signature) {
  var buff = new Buffer(keyID+":"+secretID);
  buff = "Basic " + buff.toString("base64");
  return buff === signature;
}

module.exports.authenticate = function(creds, method, targets, headers, signature, resp) {
  var key = null;
  if (signature) {
    var sub_str = signature.substr(6);
    sub_str = new Buffer(sub_str || '', 'base64').toString();
    if (sub_str) key = sub_str.substring(0,sub_str.indexOf(':'));
  }
  if (!key || !creds[key] || validate(key, creds[key], signature) === false) {
    resp.resp_code = 401; resp.resp_header = {}; resp.resp_body = {Error:{Code:"Unauthorized",Message:"Signature does not match"}}; 
    return false;
  }
  return true;
}
