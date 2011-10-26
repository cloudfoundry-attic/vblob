/*
Copyright (c) 2011 VMware, Inc.
*/
var indent_level = ['  ','    ','        ','                ']; //2^1,2^2,2^3,2^4, should be enough
var specialChars=["&","<",">",'"',"'"];
var validChars = ["&amp;","&lt;","&gt;","&quot;","&apos;"];

function replaceSpecialChar(s){
  if (typeof(s) !== 'string') { return s; }
  for(var i=0;i<specialChars.length;i++){
    s=s.replace(new RegExp(specialChars[i],"g"),validChars[i]);
  }
  return s;
}

function j2x(src,lev,namespace,indent)
{
  var dest = "";
  if (lev === 0) { dest += '<?xml version="1.0" encoding="UTF-8"?>\n'; }
  if (src === null || src === undefined) { return dest; }
  if (typeof(src) !== 'object') {
    dest += replaceSpecialChar(src);
    return dest;
  }
  var keys = Object.keys(src);
  if (indent !== undefined && lev > 0 && keys.length > 0) { dest += '\n'; }
  for (var idx = 0; idx < keys.length; idx++)
  {
    var val = src[keys[idx]];
    if (val.push === undefined) { val = [val]; }
    for (var idx2 = 0; idx2 < val.length; idx2++) {
      var lev2 = lev,bit=0;
      if (indent === undefined) { lev2 = 0; }
      while (lev2 > 0) {
        if (lev2 % 2 === 1) { dest += indent_level[bit]; }
        lev2 = (lev2 >> 1); bit += 1;
      }
      dest += '<' + keys[idx];
      if (lev === 0 && namespace !== undefined) {
        dest += ' xmlns="'+namespace+'"';
      }
      dest += '>';
      dest += j2x(val[idx2],lev+1,namespace,indent);
      lev2 = lev; bit=0;
      if (indent === undefined || dest.charAt(dest.length-1) !== '\n') { lev2 = 0; }
      while (lev2 > 0) {
        if (lev2 % 2 === 1) { dest += indent_level[bit]; }
        lev2 = (lev2 >> 1); bit += 1;
      }
      dest += '</' + keys[idx] + '>';
      if (indent !== undefined) { dest += '\n'; }
    }
  }
  return dest;
}

module.exports.json2xml = j2x;
