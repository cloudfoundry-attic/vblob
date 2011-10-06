/*
  Author: wangs@vmware.com
  Set the root dir of the blob, e.g.: var fb = new FS_blob("/mnt/sdb1/tmp");
*/
var fs = require('fs');
var Path = require('path');
var crypto = require('crypto');
var util = require('util');
var events = require("events");
var exec = require('child_process').exec;
var PREFIX_LENGTH = 2; //how many chars we use for hash prefixes
var MAX_LIST_LENGTH = 1000; //max number of objects to list
var base64_char_table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var TEMP_FOLDER = "~tmp";
var GC_FOLDER = "~gc";

var gc_hash = {}; //for caching gc info;

function hex_val(ch)
{
  if (48 <= ch && ch <= 57) { return ch - 48; }
  return ch - 97 + 10;
}

function hex2base64(hex_str)
{
  hex_str = hex_str.toLowerCase();
  var result = "";
  var va = new Array(8);
  var ca = new Array(8);
  for (var idx = 0; idx < hex_str.length; )
  {
    for (var idx2 = 0; idx2 < 6; idx2++)
    {
      if (idx+idx2 < hex_str.length) {
        va[idx2] = hex_str.charCodeAt(idx2+idx);
        va[idx2] = hex_val(va[idx2]);
      } else { va[idx2] = 0; }
    }
    ca[0] = base64_char_table.charAt((va[0] << 2) + (va[1] >> 2));
    ca[1] = base64_char_table.charAt(((va[1]&0x03)<<4)+va[2]);
    ca[2] = base64_char_table.charAt((va[3] << 2) + (va[4] >> 2));
    ca[3] = base64_char_table.charAt(((va[4]&0x03)<<4)+va[5]);
    if (idx + 5 < hex_str.length) {
      //normal case
      result += (ca[0]+ca[1]+ca[2]+ca[3]);
    } else if (idx + 3 < hex_str.length) {
      //padding 1
      result += (ca[0]+ca[1]+ca[2]+"=");
    } else {
      //padding 2
      result += (ca[0]+ca[1]+"==");
    }
    idx += 6;
  }
  return result;
}

function common_header()
{
  var header = {};
  header.Server = "FS";
  return header;
}

function error_msg(statusCode,code,msg,resp)
{
  resp.resp_code = statusCode;
  resp.resp_header = common_header();
  resp.resp_body = {"Error":{
    "Code": code,
    "Message" : ( msg && msg.toString )? msg.toString() : ""
  }};
  //no additional info for now
}

function start_gc(option,fb)
{
  gc_hash = null; gc_hash = {};
  var gc_status = 0; //1 = started
  var node_exepath = option.node_exepath ? option.node_exepath : "node";
  var gc_exepath = option.gc_exepath ? option.gc_exepath : "drivers/fs/fs_gc.js";
  var gcfc_exepath = option.gcfc_exepath ? option.gcfc_exepath : "drivers/fs/fs_gcfc.js";
  var gc_interval = option.gc_interval ? option.gc_interval : "600000";
  var gcfc_interval = option.gcfc_interval ? option.gcfc_interval : "3000";
  var gctmp_exepath = option.gctmp_exepath ? option.gctmp_exepath : "drivers/fs/fs_gctmp.js";
  var gctmp_interval = option.gctmp_interval ? option.gctmp_interval : "3600000";
  fb.gcid = setInterval(function() {
    if (gc_status === 1) return; //already a gc process running
    gc_status = 1;
    exec(node_exepath + " " + gc_exepath + " " + option.root + " > /dev/null",
        function(error,stdout, stderr) {
          gc_status = 0; //finished set to 0
        } );
    }, parseInt(gc_interval,10));

  //gc from cache
  var gcfc_status = 0;
  fb.gcfcid = setInterval(function() {
    if (gcfc_status === 1) return;
    gcfc_status = 1;
    var tmp_fn = "/tmp/gcfc-"+new Date().valueOf()+"-"+Math.floor(Math.random()*10000);
    var tmp_hash = gc_hash;
    gc_hash = null;
    gc_hash = {};
    fs.writeFile(tmp_fn,JSON.stringify(tmp_hash), function(err) {
      tmp_hash = null;
      if (err) { gcfc_status = 0; return; }
      exec(node_exepath + " " + gcfc_exepath + " " + tmp_fn + " " +option.root + " > /dev/null",
        function(error,stdout, stderr) {
          gcfc_status = 0; //finished set to 0
          fs.unlink(tmp_fn,function() {} );
        } );
    });
   }, parseInt(gcfc_interval,10));
  //gc tmp
  var gctmp_status = 0;
  fb.gctmpid = setInterval(function() {
    if (gctmp_status === 1) return; //already a gc process running
    gctmp_status = 1;
    exec(node_exepath + " " + gctmp_exepath + " " + option.root + " > /dev/null",
        function(error,stdout, stderr) {
          gctmp_status = 0; //finished set to 0
        } );
    }, parseInt(gctmp_interval,10));
}

function FS_blob(option,callback)  //fow now no encryption for fs
{
  var this1 = this;
  this.root_path = option.root; //check if path exists here
  this.logger = option.logger;
  fs.stat(this1.root_path, function(err,stats) {
    if (!err) {
      start_gc(option,this1);
    } else { this1.logger.error( ('root folder in fs driver is not mounted')); }
    if (callback) { callback(this1,err); }
  });
}

FS_blob.prototype.bucket_create = function(bucket_name,callback,fb)
{
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  fs.stat(fb.root_path+"/"+bucket_name+"/ts", function(err,stats) {
    if (stats) {fb.logger.debug("bucket_name "+bucket_name+" exists!");
      resp_code = 200;
      var header = common_header();
      header.Location = '/' + bucket_name;
      resp_header = header;
      callback(resp_code, resp_header, null, null);
      return;
    }
    var c_path = fb.root_path + "/" + bucket_name;
    if (Path.existsSync(c_path) === false)
    {
      fb.logger.debug("path "+c_path+" does not exist! Let's create one");
      fs.mkdirSync(c_path,"0775");
    } else
    {
      fb.logger.debug(("path "+c_path+" exists!"));
    }
    if (Path.existsSync(c_path+"/"+TEMP_FOLDER) === false)
    {
      fs.mkdirSync(c_path+"/"+TEMP_FOLDER,"0775");
    }
    if (Path.existsSync(c_path+"/"+GC_FOLDER) === false)
    {
      fs.mkdirSync(c_path+"/"+GC_FOLDER,"0775");
    }
    if (Path.existsSync(c_path+"/ts") === false) //double check ts
    {
      fb.logger.debug( ("timestamp "+c_path+"/ts does not exist. Need to create one"));
      fs.writeFile(c_path+"/ts", "DEADBEEF");
    } else
    {
      fb.logger.debug( ("timestamp "+c_path+"/ts exists!"));
    }
    resp_code = 200;
    var header = common_header();
    header.Location = '/'+bucket_name;
    resp_header = header;
    callback(resp_code, resp_header, null, null);
  });
};

//delete a bucket_name; fail if it's not empty
//deleting a bucket is generally considered rare, and we don't care too much about
//its performance or isolation
FS_blob.prototype.bucket_delete = function(bucket_name,callback,fb)
{
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  var c_path = fb.root_path + "/" + bucket_name+"/meta";
  if (Path.existsSync(c_path) === false)
  { //shortcut, remove directly
    var child = exec('rm -rf '+fb.root_path+"/"+bucket_name,
      function (error, stdout, stderr) {
        var header = common_header();
        resp_code = 204; resp_header = header;
        callback(resp_code, resp_header, null, null);
      }
    );
    return;
  }
  var fn1,fn2;
  var da = new Date().valueOf();
  fn1 = '/tmp/find1-'+da+Math.floor(Math.random() * 10000);
  fn2 = '/tmp/find2-'+da+Math.floor(Math.random() * 10000);
  var child1 = exec('find '+c_path+"/*/* -type d -empty > "+fn1, function(error,stdout,stderr) {
      var child2 = exec('find '+c_path+"/*/* -type d > "+fn2, function(error,stdout,stderr) {
        var child3 =  exec('diff -q '+fn1+" "+fn2, function(error,stdout,stderr) {
          if (stdout === null || stdout === undefined || stdout === '') {
            var child = exec('rm -rf '+fb.root_path+"/"+bucket_name,
              function (error, stdout, stderr) {
                var header = common_header();
                resp_code = 204; resp_header = header;
                callback(resp_code, resp_header, null, null);
              }
            );
          } else {
            var resp = {};
            error_msg(409,"BucketNotEmpty","The bucket you tried to delete is not empty.",resp);
            resp_code = resp.resp_code; resp_header = resp.resp_header; resp_body = resp.resp_body;
            callback(resp_code, resp_header, resp_body, null);
          }
          fs.unlink(fn1,function(err) {} );
          fs.unlink(fn2,function(err) {} );
        });
   });
  });
};

//need to revisit sync operation on FS in this check
// currently necessary for PUT (to avoid losing events at the beginning of the request)
// not necessary for other operations - could call async version of this for better concurrency
// revisit for perf when perf is revisited
function bucket_exists(bucket_name, callback,fb)
{
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  var c_path = fb.root_path + "/" + bucket_name;
  if (!Path.existsSync(c_path)) {
    fb.logger.error( ("no such bucket_name"));
    var resp = {};
    error_msg(404,"NoSuchBucket","No such bucket on disk",resp);
    resp_code = resp.resp_code; resp_header = resp.resp_header; resp_body = resp.resp_body;
    callback(resp_code, resp_header, resp_body, null);
    return false;
  }
  return true;
}

function get_key_md5_hash(filename)
{
  var md5_name = crypto.createHash('md5');
  md5_name.update(filename);
  return md5_name.digest('hex');
}

//<md5 hash of the key>-<prefix of the key>-<suffix of the key>
function get_key_fingerprint(filename)
{
  var digest = get_key_md5_hash(filename);
  var prefix, suffix;
  var file2 = filename.replace(/(\+|=|\^|#|\{|\}|\(|\)|\[|\]|%|\||,|:|!|;|\/|\$|&|@|\*|`|'|"|<|>|\?|\\)/g, "_"); //replacing all special chars with "_"
  if (file2.length < 8) {
    while (file2.length < 8) file2 += '0';
    prefix = file2.substr(0,8);
    suffix = file2.substr(file2.length - 8);
  } else {
    prefix = file2.substr(0,8);
    suffix = file2.substr(file2.length-8);
  }
  return digest+'-'+prefix+'-'+suffix;
}

function generate_version_id(key)
{
  var da = new Date().valueOf();
  return key+'-'+da+'-'+Math.floor(Math.random()*1000)+'-'+Math.floor(Math.random()*1000);
}

/*
    physical path: /bucket_name/prefix/filename
    prefix calculaton: prefix of PREFIX_LENGTH chars of  md5 digest of filename
*/

function remove_uploaded_file(fdir_path)
{
  fs.unlink(fdir_path,function(err) {
  });
}

function create_prefix_folders(prefix_array, callback)
{
  var resp = {};
  error_msg(404,"NoSuchBucket","Bucket does not exist.",resp);
  var path_pref = null;
  for (var idx = 0; idx < prefix_array.length; idx++) {
    if (path_pref === null) path_pref = prefix_array[idx];
    else path_pref = path_pref + "/" + prefix_array[idx];
    if (!Path.existsSync(path_pref)) {
      try {
        fs.mkdirSync(path_pref,"0775");
      } catch(err) {
        if (err.code !== 'EEXIST') {
          callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
          return false;
        }
        //EEXIST: OK to proceed
        //ENOENT: error response no such bucket
      }
    }
  }
  return true;
}

FS_blob.prototype.object_create = function (bucket_name,filename,create_options, create_meta_data, data,callback,fb)
{
  var resp = {};
//step 1 check bucket existence
  if (resp === undefined) { resp = null; }
  var c_path = this.root_path + "/" + bucket_name;
  if (bucket_exists(bucket_name,callback,fb) === false) return;
//step2.1 calc unique hash for key
  var key_fingerprint = get_key_fingerprint(filename);
//step2.2 gen unique version id
  var version_id = generate_version_id(key_fingerprint);
//step3 create meta file in ~tmp (probably create parent folders)
  var prefix1 = key_fingerprint.substr(0,PREFIX_LENGTH), prefix2 = key_fingerprint.substr(PREFIX_LENGTH,PREFIX_LENGTH);
  var prefix_path = prefix1 + "/" + prefix2 + "/";
  var temp_path = c_path + "/" + TEMP_FOLDER +"/" + version_id;
  var blob_path = c_path + "/blob/" + prefix_path + version_id;
  var meta_json = { vblob_file_name : filename, vblob_file_path : blob_path };
  fs.writeFileSync(temp_path, JSON.stringify(meta_json));
//step 3.1 create folders is needed
  if (!create_prefix_folders([c_path+"/blob",prefix1,prefix2],callback)) return;
  if (!create_prefix_folders([c_path+"/versions", prefix1,prefix2],callback)) return;
  if (!create_prefix_folders([c_path+"/meta",prefix1,prefix2],callback)) return;
//step 4 stream blob
  var stream = fs.createWriteStream(blob_path);
  var md5_etag = crypto.createHash('md5');
  var md5_base64 = null;
  var file_size = 0;
  stream.on("error", function (err) {
    fb.logger.error( ("write stream " + filename+err));
    if (resp !== null) {
      error_msg(500,"InternalError",err,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
    }
    data.destroy();
    stream.destroy();
  });
  data.on("error", function (err) {
    if (resp !== null) {
      error_msg(500,"InternalError",err,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
    }
    fb.logger.error( ('input stream '+filename+err));
    data.destroy();
    stream.destroy();
  });
  data.on("data",function (chunk) {
    md5_etag.update(chunk);
    file_size += chunk.length;
    stream.write(chunk);
  });
  data.on("end", function () {
    fb.logger.debug( ('upload ends'));
    data.upload_end = true;
    stream.end();
    stream.destroySoon();
  });
  stream.on("close", function() {
    fb.logger.debug( ("close write stream "+filename));
    md5_etag = md5_etag.digest('hex');
    var opts = {vblob_file_name: filename, vblob_file_path: blob_path, vblob_file_etag : md5_etag, vblob_file_size : file_size, vblob_file_version : version_id, vblob_file_fingerprint : key_fingerprint};
    if (create_options['content-md5']) {
      //check if content-md5 matches
      md5_base64 = hex2base64(md5_etag);
      if (md5_base64 !== create_options['content-md5']) // does not match
      {
        if (resp !== null) {
          error_msg(400,"InvalidDigest","The Content-MD5 you specified was invalid.",resp);
          callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
        }
        fb.logger.error( (filename+' md5 not match: uploaded: '+ md5_base64 + ' specified: ' + create_options['content-md5']));
        data.destroy();
        remove_uploaded_file(blob_path);
        return;
      }
    }
    var keys = Object.keys(create_meta_data);
    for (var idx = 0; idx < keys.length; idx++) {
      var obj_key = keys[idx];
      if (obj_key.match(/^x-amz-meta-/i)) {
        var sub_key = obj_key.substr(11);
        sub_key = "vblob_meta_" + sub_key;
        opts[sub_key] = create_meta_data[obj_key];
      } else if (obj_key.match(/^content-length$/i)) {
        continue; //actual file size is already calculated
      } else opts[obj_key] = create_meta_data[obj_key];
    }
    //step 5 starting to re-link meta
    fb.object_create_meta(bucket_name,filename,temp_path,opts,callback,fb,!data.connection);
  });
  if (data.connection) // copy stream does not have connection
  {
    data.connection.on('close',function() {
      fb.logger.debug( ('client disconnect'));
      if (data.upload_end === true) { return; }
      fb.logger.warn( ('interrupted upload: ' + filename));
      data.destroy();
      stream.destroy();
    });
  }
};

FS_blob.prototype.object_create_meta = function (bucket_name, filename, temp_path, opt,callback,fb,is_copy)
{
  var resp = {};
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
//step 5.5 update meta
  if (opt === undefined) { opt = null; }
  if (resp === undefined) { resp = null; }
  var doc = {};
  if (opt !== null) {
    for (var key in opt)
    { doc[key] = opt[key]; }
  }
  var dDate = new Date();
  doc.vblob_update_time = dDate.toString();
  doc.vblob_file_name = filename;
  fs.writeFile(temp_path,JSON.stringify(doc), function(err) {
    if (err) {
      fb.logger.error( ("In creating file "+filename+" meta in bucket_name "+bucket_name+" "+err));
      if (resp !== null) {
        error_msg(404,"NoSuchBucket",err,resp);
        callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
      }
      return;
    }
    fb.logger.debug( ("Created meta for file "+filename+" in bucket_name "+bucket_name));
    var header = common_header();
    header.ETag = opt.vblob_file_etag;
    resp.resp_code = 200; resp.resp_body = null;
    fb.logger.debug( ('is_copy: ' + is_copy));
    if (is_copy) {
      resp.resp_body = {"CopyObjectResult":{"LastModified":new Date(doc.vblob_update_time).toISOString(),"ETag":'"'+opt.vblob_file_etag+'"'}};
      resp.resp_header = header;
    } else {
      resp.resp_header = header;
    }
    //step 5.6 add to /~GC
    fs.symlink(temp_path, fb.root_path + "/" + bucket_name + "/" +GC_FOLDER +"/" + doc.vblob_file_version,function(err) {
      if (err) {
        fb.logger.error( ("In creating file "+filename+" meta in bucket_name "+bucket_name+" "+err));
        if (resp !== null) {
          error_msg(500,"InternalError",err,resp);
          callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
        }
        return;
      }
      //add to gc cache
      if (!gc_hash[bucket_name]) gc_hash[bucket_name] = {};
      if (!gc_hash[bucket_name][doc.vblob_file_fingerprint]) gc_hash[bucket_name][doc.vblob_file_fingerprint] = [doc.vblob_file_version]; else gc_hash[bucket_name][doc.vblob_file_fingerprint].push(doc.vblob_file_version);
    //step 6 mv to versions
      var prefix1 = doc.vblob_file_version.substr(0,PREFIX_LENGTH), prefix2 = doc.vblob_file_version.substr(PREFIX_LENGTH,PREFIX_LENGTH);
      fs.rename(temp_path, fb.root_path + "/"+bucket_name+"/versions/" + prefix1 + "/" + prefix2 + "/" + doc.vblob_file_version,function (err) {
        if (err) {
          fb.logger.error( ("In creating file "+filename+" meta in bucket_name "+bucket_name+" "+err));
          if (resp !== null) {
            error_msg(500,"InternalError",err,resp);
            callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
          }
          return;
        }
    //step 7 ln -f meta/key versions/version_id
        var child = exec('ln -f '+fb.root_path + "/"+bucket_name+"/versions/" + prefix1 + "/" + prefix2 + "/" + doc.vblob_file_version+" "+ fb.root_path + "/"+bucket_name+"/meta/" + prefix1 + "/" + prefix2 + "/" + doc.vblob_file_fingerprint,
          function (error, stdout, stderr) {
    //step 8 respond
            callback(resp.resp_code, resp.resp_header, resp.resp_body,null);
          }
        );
      });
    });
  });
};

FS_blob.prototype.object_delete_meta = function (bucket_name, filename, callback, fb)
{
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  var c_path = fb.root_path + "/" + bucket_name;
  if (bucket_exists(bucket_name,callback,fb) === false) return;
//step2.1 calc unique hash for key
  var key_fingerprint = get_key_fingerprint(filename);
//step2.2 gen unique version id
  var version_id = generate_version_id(key_fingerprint);
  var prefix1 = key_fingerprint.substr(0,PREFIX_LENGTH), prefix2 = key_fingerprint.substr(PREFIX_LENGTH,PREFIX_LENGTH);
  var file_path = c_path + "/meta/" + prefix1 +"/"+prefix2+"/"+key_fingerprint; //complete representation: /bucket_name/filename
  fs.symlink(c_path +"/" + TEMP_FOLDER + "/"+version_id, c_path + "/"+GC_FOLDER+"/" + version_id,function(err) {
    if (err) {
      var resp = {};
      error_msg(500,"InternalError",err,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
      return;
    }
    //add to gc cache
    if (!gc_hash[bucket_name]) gc_hash[bucket_name] = {};
    if (!gc_hash[bucket_name][key_fingerprint]) gc_hash[bucket_name][key_fingerprint] = [version_id]; else gc_hash[bucket_name][key_fingerprint].push(version_id);

    fs.unlink(file_path, function(err) {
      //ERROR?
      resp_code = 204;
      var header = common_header();
      resp_header = header;
      callback(resp_code, resp_header, null, null);
    });
  });
};

FS_blob.prototype.object_copy = function (bucket_name,filename,source_bucket,source_file,options, metadata, callback,fb)
{
  var resp = {};
//step 1 check bucket existence
  var c_path = this.root_path + "/" + bucket_name;
  var src_path = this.root_path + "/" + source_bucket;
  if (bucket_exists(bucket_name,callback,fb) === false) return;
  if (bucket_exists(source_bucket,callback,fb) === false) return ;
//step2.1 calc unique hash for key
  var key_fingerprint = get_key_fingerprint(filename);
  var src_key_fingerprint = get_key_fingerprint(source_file);
//step2.2 gen unique version id
  var version_id = generate_version_id(key_fingerprint);
//step3 create meta file in ~tmp (probably create parent folders)
  var prefix1 = key_fingerprint.substr(0,PREFIX_LENGTH), prefix2 = key_fingerprint.substr(PREFIX_LENGTH,PREFIX_LENGTH);
  var src_prefix1 = src_key_fingerprint.substr(0,PREFIX_LENGTH), src_prefix2 = src_key_fingerprint.substr(PREFIX_LENGTH,PREFIX_LENGTH);
  var prefix_path = prefix1 + "/" + prefix2 + "/";
  var src_prefix_path = src_prefix1 + "/" + src_prefix2 + "/";
  var temp_path = c_path + "/" + TEMP_FOLDER +"/" + version_id;
  var blob_path = c_path + "/blob/" + prefix_path + version_id;
  var src_meta_path = src_path + "/meta/" + src_prefix_path + src_key_fingerprint;

  var etag_match=null, etag_none_match=null, date_modified=null, date_unmodified=null;
  var meta_dir=null;
  if (true){
    var keys = Object.keys(options);
    for (var idx = 0; idx < keys.length; idx++)
    {
      if (keys[idx].match(/^x-amz-copy-source-if-match$/i))
      { etag_match = options[keys[idx]]; }
      else if (keys[idx].match(/^x-amz-copy-source-if-none-match$/i))
      { etag_none_match = options[keys[idx]]; }
      else if (keys[idx].match(/^x-amz-copy-source-if-unmodified-since$/i))
      { date_unmodified = options[keys[idx]]; }
      else if (keys[idx].match(/^x-amz-copy-source-if-modified-since$/i))
      { date_modified = options[keys[idx]]; }
      else if (keys[idx].match(/^x-amz-metadata-directive$/i))
      { meta_dir = options[keys[idx]]; }
    }
  }
  if (meta_dir === null) { meta_dir = 'COPY'; }
  else { meta_dir = meta_dir.toUpperCase(); }
  if ((meta_dir !== 'COPY' && meta_dir !== 'REPLACE') ||
      (etag_match && date_modified) ||
      (etag_none_match && date_unmodified) ||
      (date_modified && date_unmodified)  ||
      (etag_match && etag_none_match) ) {
    error_msg(400,"NotImplemented","The headers are not supported",resp); //same as S3 does
    callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
    return;
  }
  //read src meta here
  fs.readFile(src_meta_path, function(err,data) {
    if (err) {
      error_msg(404,"NoSuchFile",err,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
    }
    var obj = JSON.parse(data);
    if (true) {
      //check etag, last modified
      var check_modified = true;
      var t1,t2;
      if (date_modified) {
        t1 = new Date(date_modified).valueOf();
        t2 = new Date(obj.vblob_update_time).valueOf();
        check_modified = t2 > t1;
      } else if (date_unmodified) {
        t1 = new Date(date_unmodified).valueOf();
        t2 = new Date(obj.vblob_update_time).valueOf();
        check_modified = t2 <= t1;
      }
      if ((etag_match && obj.vblob_file_etag !== etag_match) ||
          (etag_none_match && obj.vblob_file_etag === etag_none_match) ||
          check_modified === false)
      {
        error_msg(412,"PreconditionFailed","At least one of the preconditions you specified did not hold.",resp);
        callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
        return;
      }
      var keys,keys2;  var idx; //supress warning
      var dest_obj = {};
      //TODO: more meta to copy (cache-control, encoding, disposition, expires, etc.)
      dest_obj.vblob_file_etag = obj.vblob_file_etag;
      dest_obj.vblob_file_size = obj.vblob_file_size;
      if (obj["content-type"]) dest_obj["content-type"] = obj["content-type"];
      if (obj["cache-control"]) dest_obj["cache-control"] = obj["cache-control"];
      if (obj["content-disposition"]) dest_obj["content-disposition"] = obj["content-disposition"];
      if (obj["content-encoding"]) dest_obj["content-encoding"] = obj["content-encoding"];
      if (obj["expires"]) dest_obj["expires"] = obj["expires"];
      dest_obj.vblob_file_version = version_id;
      dest_obj.vblob_file_fingerprint = key_fingerprint;
      dest_obj.vblob_file_path = blob_path;
      keys = Object.keys(obj);
      if (meta_dir === 'COPY') {
        if (source_bucket === bucket_name && source_file === filename) {
            error_msg(400,"NotImplemented","The headers are not supported",resp);
            callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
            return;
        }
        for (idx = 0; idx < keys.length; idx++) {
          var key = keys[idx];
          if (key.match(/^vblob_meta_/i)) {
            dest_obj[key] = obj[key];
          }
        }
      } else {
        keys = Object.keys(metadata);
        for (idx = 0; idx < keys.length; idx++) {
          var key = keys[idx];
          if (key.match(/^x-amz-meta-/i)) {
            var key2 = key.replace(/^x-amz-meta-/i,"vblob_meta_");
            dest_obj[key2] = metadata[key];
          } else dest_obj[key] = metadata[key];
        }
      }
      //new object meta constructed, ready to create links etc.
      if (!create_prefix_folders([c_path+"/blob",prefix1,prefix2],callback)) return;
      if (!create_prefix_folders([c_path+"/versions", prefix1,prefix2],callback)) return;
      if (!create_prefix_folders([c_path+"/meta",prefix1,prefix2],callback)) return;
      fs.writeFile(temp_path, JSON.stringify(dest_obj), function (err) {
        if (err) {
          error_msg(500,"InternalError",""+err,resp);
          callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
          return;
        }
        fs.link(obj.vblob_file_path, dest_obj.vblob_file_path, function(err) {
          if (err) {
            error_msg(500,"InternalError",""+err,resp);
            callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
            return;
          }
          //ready to call object_create_meta
          fb.object_create_meta(bucket_name,filename, temp_path, dest_obj, callback, fb, true);
        });
      });
    };
  });
};

FS_blob.prototype.object_read = function (bucket_name, filename, options, callback, fb)
{
  var range = options.range;
  var verb = options.method;
  var resp = {}; //for error_msg
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  var c_path = this.root_path + "/" + bucket_name;
  if (bucket_exists(bucket_name,callback,this) === false) return;
//step2.1 calc unique hash for key
  var key_fingerprint = get_key_fingerprint(filename);
//step2.2 gen unique version id
  var file_path = c_path + "/meta/" + key_fingerprint.substr(0,PREFIX_LENGTH)+"/"+key_fingerprint.substr(PREFIX_LENGTH,PREFIX_LENGTH)+"/"+key_fingerprint; //complete representation: /bucket_name/filename
//    error_msg(404,"NoSuchFile","No such file",resp);resp.resp_end();return;
  var etag_match=null, etag_none_match=null, date_modified=null, date_unmodified=null;
  var keys = Object.keys(options);
  for (var idx = 0; idx < keys.length; idx++)
  {
    if (keys[idx].match(/^if-match$/i))
    { etag_match = options[keys[idx]]; }
    else if (keys[idx].match(/^if-none-match$/i))
    { etag_none_match = options[keys[idx]]; }
    else if (keys[idx].match(/^if-unmodified-since$/i))
    { date_unmodified = options[keys[idx]]; }
    else if (keys[idx].match(/^if-modified-since$/i))
    { date_modified = options[keys[idx]]; }
  }
  //read meta here
  fs.readFile(file_path,function (err, data) {
    if (err) { error_msg(404,"NoSuchFile",err,resp); callback(resp.resp_code, resp.resp_header, resp.resp_body, null); return; }
    var obj = JSON.parse(data);
    var header = common_header();
//    if (file_size !== obj.vblob_file_size) {
//      error_msg(500,"InternalError","file corrupted",resp); resp.resp_end(); return;
//    }
    var modified_since=true, unmodified_since=true;
    var t1,t2;
    if (date_modified) {
      t1 = new Date(date_modified).valueOf();
      t2 = new Date(obj.vblob_update_time).valueOf();
      modified_since = t2 > t1;
    } else if (date_unmodified) {
      t1 = new Date(date_unmodified).valueOf();
      t2 = new Date(obj.vblob_update_time).valueOf();
      unmodified_since = t2 <= t1;
    }
    //412
    if (unmodified_since === false ||
        etag_match && etag_match !== obj.vblob_file_etag)
    {
      error_msg(412,"PreconditionFailed","At least one of the preconditions you specified did not hold.",resp); callback(resp.resp_code, resp.resp_header, resp.resp_body, null); return;
    }
    //304
    if (modified_since === false ||
        etag_none_match && etag_none_match === obj.vblob_file_etag)
    {
      error_msg(304,'NotModified','The object is not modified',resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
      return;
    }
    header["Content-Type"] = obj["content-type"] ? obj["content-type"] :  "binary/octet-stream";
    header["Content-Length"] = obj.vblob_file_size;
    header["Last-Modified"] = obj.vblob_update_time;
    header.ETag = obj.vblob_file_etag;
    var keys = Object.keys(obj);
    for (var idx = 0; idx < keys.length; idx++) {
      var obj_key = keys[idx];
      if (obj_key.match(/^vblob_meta_/)) {
        var sub_key = obj_key.substr(11);
        sub_key = "x-amz-meta-" + sub_key;
        header[sub_key] = obj[obj_key];
      }
    }
    //override with response-xx
    keys = Object.keys(options);
    for (var idx2 = 0; idx2 < keys.length; idx2++) {
      var obj_key2 = keys[idx2];
      if (obj_key2.match(/^response-/)) {
        var sub_key2 = obj_key2.substr(9);
        header[sub_key2] = options[obj_key2];
      }
    }
    header["Accept-Ranges"] = "bytes";
    var st;
    if (range !== null && range !== undefined) {
      header["Content-Range"] = "bytes "+ (range.start!==undefined?range.start:"")+'-'+(range.end!==undefined?range.end.toString():"") + "/"+obj.vblob_file_size.toString();
      if (range.start === undefined) { range.start = file_size - range.end; delete range.end; }
      if (range.end === undefined) { range.end = file_size-1; }
      header["Content-Length"] = range.end - range.start + 1;
      //resp.writeHeader(206,header);
      resp_code = 206; resp_header = header;
      if (verb==="get") { //TODO: retry for range read?
        st = fs.createReadStream(obj.vblob_file_path, range);
        st.on('error', function(err) {
          console.log(err);
          st.destroy();
          error_msg(503,'SlowDown','The object is being updated too frequently, try later',resp);
          callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
        });
        st.on('open', function(fd) {
          callback(resp_code, resp_header, null, st);
        });
      } else { callback(resp_code, resp_header, null, null); }
    } else {
      resp_code = 200; resp_header = header;
      //resp.writeHeader(200,header);
      if (verb==="get") {
        st = fs.createReadStream(obj.vblob_file_path);
        st.on('error', function(err) {//RETRY??
          st.destroy();
          fb.logger.error( ("file "+obj.vblob_file_version+" is purged by gc already!"));
          //error_msg(508,'SlowDown','The object is being updated too frequently, try later',resp);
          //callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
          setTimeout(function(fb1) { fb1.object_read(bucket_name, filename, options, callback,fb1); }, Math.floor(Math.random()*1000) + 100,fb);
        });
        st.on('open', function(fd) {
          callback(resp_code, resp_header, null, st);
        });
      }  else { callback(resp_code, resp_header, null, null);  }
    }
  });
};

FS_blob.prototype.bucket_list = function()
{
  return  fs.readdirSync(this.root_path);
};

function render_buckets(dirs,callback,fb)
{
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  var dates = new Array(dirs.length);
  var evt = new events.EventEmitter();
  var counter = dirs.length;
  evt.on("Get Date",function (dir_name, idx) {
    fs.stat(fb.root_path+"/"+dir_name+"/ts", function(err,stats) {
        if (err) dates[idx] = null; else
        dates[idx] = stats.ctime;
        counter--; if (counter === 0) { evt.emit("Start Render"); }
    });
  });
  evt.on("Start Render", function () {
    resp_code = 200;
    resp_header = common_header();
    resp_body = {ListAllMyBucketsResult : {Buckets: {Bucket: []}}};
    for (var i = 0; i < dirs.length; i++) {
      if (dates[i] === null)  { continue; }
      resp_body.ListAllMyBucketsResult.Buckets.Bucket.push({Name:dirs[i],CreationDate:new Date(dates[i]).toISOString()});
    }
    callback(resp_code, resp_header, resp_body, null);
  });
  if (dirs.length === 0) { evt.emit("Start Render"); }
  for (var i = 0; i < dirs.length; i++)
  { evt.emit("Get Date",dirs[i],i); }
}

//=======================================================
//this is interface object for abstraction
var FS_Driver = function(option,callback) {
  var this1 = this;
  this1.root_path = option.root;
  var client = new FS_blob(option, function(obj,err) {
    if (err) {this1.fs_err = err; this1.client = null; if (callback) {callback(this1);} return; }
    this1.client = obj;
    if (callback) { callback(this1); }
  });
};

function check_client(client,callback)
{
  if (client) return true;
  var resp_header = common_header();
  var resp_code = 500;
  var resp_body = {Code:500,Message:"fs root not mounted" };
  callback(resp_code, resp_header, resp_body, null);
  return false;
}

FS_Driver.prototype.bucket_list = function (callback) {
  if (check_client(this.client,callback) === false) return;
  var dirs = this.client.bucket_list();
  render_buckets(dirs,callback,this.client);
};

FS_Driver.prototype.object_list = function(bucket_name,option,callback) {
  var resp = {};
  error_msg(501,"NotImplemented","Listing bucket is not implemented in this version",resp);
  callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
};

FS_Driver.prototype.object_read = function(bucket_name,object_key,options,callback){
  if (check_client(this.client,callback) === false) return;
  var range1 = null;
  if (options.range) {
    range1 = options.range;
    range1 = range1.substr(6);
    var m = range1.match(/^([0-9]*)-([0-9]*)$/);
    if (m[1]===m[2]&& m[1]==='') { range1=null; }
    else {
      range1 = {};
      if (m[1] !== '') { range1.start = parseInt(m[1],10); }
      if (m[2] !== '') { range1.end = parseInt(m[2],10); }
    }
    this.client.logger.debug( ("Final range: "+util.inspect(range1)));
  }
  this.client.object_read(bucket_name, object_key, options, callback, this.client);
};

FS_Driver.prototype.object_create = function(bucket_name,object_key,options, metadata, data_stream,callback) {
  if (check_client(this.client,callback) === false) return;
  this.client.object_create(bucket_name,object_key,options,metadata, data_stream, callback,this.client);
};

FS_Driver.prototype.object_copy = function(bucket_name, object_key, source_bucket,source_object_key,options, metadata, callback)
{
  if (check_client(this.client,callback) === false) return;
  this.client.object_copy(bucket_name,object_key,source_bucket,source_object_key,options, metadata, callback,this.client);
};

FS_Driver.prototype.bucket_create = function(bucket_name,options,data_stream,callback) {
  if (check_client(this.client,callback) === false) return;
  this.client.bucket_create(bucket_name,callback,this.client);
};

FS_Driver.prototype.object_delete = function(bucket_name,object_key,callback) {
  if (check_client(this.client,callback) === false) return;
  this.client.object_delete_meta(bucket_name,object_key,callback,this.client);
};

FS_Driver.prototype.bucket_delete = function(bucket_name,callback) {
  if (check_client(this.client,callback) === false) return;
  this.client.bucket_delete(bucket_name,callback,this.client);
};

module.exports.createDriver = function(option,callback) {
  return new FS_Driver(option, callback);
};
