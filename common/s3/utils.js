/*!		
* knox - utils		
* Copyright(c) 2010 LearnBoost <dev@learnboost.com>		
* Portions Copyright (c) 2011-2012 VMware, Inc.
* MIT Licensed		
*/

exports.to_query_string = function(options) {
 if (options === null || options === undefined) { return ''; }
 var filter = ['acl','notification','partNumber','policy','requestPayment','torrent', 'uploadId', 'uploads', 'versionId', 'versioning', 'versions', 'website','prefix','max-keys','marker','delimiter','location','logging','response-content-type', 'response-content-language','response-expires','response-cache-control','response-content-disposition','response-content-encoding'];
 var keys = Object.keys(options);
 var query_string = '';
 for (var i = 0, len = keys.length; i < len; ++i) {
   var key = keys[i];
   var lkey = key.toLowerCase();
   if (filter.indexOf(lkey) !== -1) {
     if (query_string === '') { query_string += '?'; } else { query_string += '&'; }
     query_string += lkey + (options[key]?('=' + encodeURIComponent(options[key])):"");
   }
 }
 return query_string;
};

/**
 * Merge object `b` with object `a`.
 *
 * @param {Object} a
 * @param {Object} b
 * @return {Object} a
 * @api private
 */

exports.merge = function(a, b){
  var keys = Object.keys(b);
  for (var i = 0, len = keys.length; i < len; ++i) {
    var key = keys[i];
    a[key] = b[key];
  }
  return a;
};

/**
 * Base64.
 */

exports.base64 = {

  /**
   * Base64 encode the given `str`.
   *
   * @param {String} str
   * @return {String}
   * @api private
   */

  encode: function(str){
    return new Buffer(str).toString('base64');
  },

  /**
   * Base64 decode the given `str`.
   *
   * @param {String} str
   * @return {String}
   * @api private
   */

  decode: function(str){
    return new Buffer(str, 'base64').toString();
  }
};
