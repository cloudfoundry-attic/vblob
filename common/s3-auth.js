var utils = require('./s3/utils');
var auth = require('./s3/auth');
var join = require('path').join;

module.exports.validate = function(keyID, secretID, method, targets, headers, signature){
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
  //resource: "/" for listing buckets; otherwise bucket or file level operations
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
    , resource: auth.canonicalizeResource((targets.bucket===undefined || targets.bucket === null)?'/':(targets.filename ?/* join('/', targets.bucket, targets.filename)*/ '/'+targets.bucket+'/'+targets.filename+utils.to_query_string(targets.query):join('/',targets.bucket)+utils.to_query_string(targets.query)))
    , contentType: content_type
    , amazonHeaders: auth.canonicalizeHeaders(headers)
  });
  return Authorization === signature;
};
