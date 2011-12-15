/*!
* Copyright (c) 2011 VMware, Inc.
*/

var crypto = require('crypto');
var realm = 'vblob restricted area';
var opaque = null;
var nonce_map = {};
var nonce_total = 0;
var validate = function(keyID, secretID, method, digest) {
  var now = new Date().valueOf();
  if (digest.qop !== 'auth' || !digest.nonce || !digest.cnonce || !digest.uri) return false;
  if (!nonce_map[digest.nonce] || nonce_map[digest.nonce].t < now) {
    if (nonce_map[digest.nonce]) { nonce_total--; delete nonce_map[digest.nonce] }
    return false;
  }
  if (!digest.nc|| parseInt(digest.nc,10) < nonce_map[digest.nonce].c) return false;
  nonce_map[digest.nonce].c = parseInt(digest.nc,10);
  var a1 = crypto.createHash('md5'), a2 = crypto.createHash('md5'), response = crypto.createHash('md5');
  a1.update(secretID+':'+realm+':'+keyID);
  a1 = a1.digest('hex');
  a2.update(method+':'+digest.uri);
  a2 = a2.digest('hex');
  response.update(a1+':'+digest.nonce+':'+digest.nc+':'+digest.cnonce+':'+digest.qop+':'+a2);
  response=response.digest('hex');
  return response === digest.response;
}

module.exports.authenticate = function(creds, method, targets, headers, signature, resp) {
  if (opaque === null) {
    var md5_name = crypto.createHash('md5');
    md5_name.update(realm);
    opaque = md5_name.digest('hex');
  }
  var key = null;
  if (!signature) {
    resp.resp_code = 401;
    var da = new Date().valueOf();
    var nonce = ""+da+Math.floor(Math.random()*1000)+Math.floor(Math.random()*1000);
    if (nonce_total > 50000) { //too many nonces registered, purge all of them
      nonce_map = {}; nonce_total = 0;
    }
    nonce_total++;
    nonce_map[nonce] = {t:da+5*1000,c:-1}; //5 secs to expire
    resp.resp_header = {"WWW-Authenticate":'Digest realm="'+realm+'",qop="auth",nonce="'+nonce+'",opaque="'+opaque+'"'}; 
    resp.resp_body = {Error:{Code:"Unauthorized",Message:"Unauthorized"}};
    return false;
  }
  var obj = {};
  var sub_str = signature.substr(7); //Digest ...
  try {
    var params = sub_str.split(',');
    for (var i = 0; i < params.length; i++) {
      var st = params[i];
      var pos = st.indexOf('=');
      if (pos === -1) throw 'error';
      var j = 0;
      while (st.charAt(j) === ' ') j++;
      var k = st.substring(j,pos), v = st.substr(pos+1);
      if (v.charAt(0) === '"' && v.charAt(v.length-1) === '"')
        v = v.substring(1,v.length-1);
      obj[k] = v;
    }
  } catch (err) {
    resp.resp_code = 401; resp.resp_header = {}; resp.resp_body = {Error:{Code:"Unauthorized",Message:"Bad digest"}};
    return false;
  }
  key = obj.username;
  if (!key || !creds[key] || validate(key, creds[key], method, obj) === false) {
    resp.resp_code = 401; resp.resp_header = {}; resp.resp_body = {Error:{Code:"Unauthorized",Message:"Incorrect credentials"}};
    return false;
  }
  return true;
}
