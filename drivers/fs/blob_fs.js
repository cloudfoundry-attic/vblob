/*
Copyright (c) 2011-2012 VMware, Inc.
Author: wangs@vmware.com
*/
var fs = require('fs');
var Path = require('path');
var crypto = require('crypto');
var util = require('util');
var events = require("events");
var exec = require('child_process').exec;
var PREFIX_LENGTH = 2; //how many chars we use for hash prefixes
var MAX_LIST_LENGTH = 1000; //max number of files to list
var base64_char_table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var TEMP_FOLDER = "~tmp";
var GC_FOLDER = "~gc";
var ENUM_FOLDER = "~enum";
var MAX_COPY_RETRY = 3;
var MAX_READ_RETRY = 3;
var MAX_DEL_RETRY = 6;
var openssl_available = false; //by default do not use openssl to calculate md5
var gc_hash = {}; //for caching gc info;
var enum_cache = {};
var enum_expire = {};

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

function start_collector(option,fb)
{
  var node_exepath = option.node_exepath ? option.node_exepath : process.execPath;
  var ec_exepath = option.ec_exepath ? option.ec_exepath : __dirname+"/fs_ec.js";
  var ec_interval;
  try { if (isNaN(ec_interval = parseInt(option.ec_interval,10))) throw 'isNaN'; } catch (err) { ec_interval = 1500; }
  fb.node_exepath = node_exepath;
  fb.ec_exepath = ec_exepath;
  fb.ec_interval = ec_interval;
  var ec_status = 0;
  fb.ecid = setInterval(function() {
    if (ec_status === 1) return; //already a gc process running
    ec_status = 1;
    //node fs_ec.js <blob root> <global tmp>
    exec(node_exepath + " " + ec_exepath + " " + fb.root_path + " --tmp " + fb.tmp_path + " > /dev/null",
        function(error,stdout, stderr) {
          ec_status = 0; //finished set to 0
          if (error || stderr) {
            var msg = 'enumeration collector error: ';
            try {
              msg += error?error:''+'-- '+stderr?stderr:'';
            } catch (e) { }
            fb.logger.warn(msg);
          }
        } );
    }, ec_interval);

}

function start_gc(option,fb)
{
  gc_hash = null; gc_hash = {};
  var gc_status = 0; //1 = started
  var tmp_path = option.tmp_path ? option.tmp_path : "/tmp";
  var node_exepath = option.node_exepath ? option.node_exepath : process.execPath;
  var gc_exepath = option.gc_exepath ? option.gc_exepath : __dirname+"/fs_gc.js";
  var gcfc_exepath = option.gcfc_exepath ? option.gcfc_exepath : __dirname+"/fs_gcfc.js";
  var gc_interval;
  var gcfc_interval;
  var gctmp_interval;
  try { if (isNaN(gc_interval = parseInt(option.gc_interval,10))) throw 'isNaN'; } catch (err) { gc_interval = 600000; }
  try { if (isNaN(gcfc_interval = parseInt(option.gcfc_interval,10))) throw 'isNaN'; } catch (err) { gcfc_interval = 1500; }
  try { if (isNaN(gctmp_interval = parseInt(option.gctmp_interval,10))) throw 'isNaN'; } catch (err) { gctmp_interval = 3600000; }
  var gctmp_exepath = option.gctmp_exepath ? option.gctmp_exepath : __dirname+"/fs_gctmp.js";
  fb.node_exepath = node_exepath;
  fb.gc_exepath = gc_exepath;
  fb.gcfc_exepath = gcfc_exepath;
  fb.gctmp_exepath = gctmp_exepath;
  fb.gc_interval = gc_interval;
  fb.gcfc_interval = gcfc_interval;
  fb.gctmp_interval = gctmp_interval;
  fb.gcid = setInterval(function() {
    if (gc_status === 1) return; //already a gc process running
    gc_status = 1;
    exec(node_exepath + " " + gc_exepath + " " + fb.root_path + " --tmp " + tmp_path + " > /dev/null",
        function(error,stdout, stderr) {
          gc_status = 0; //finished set to 0
          if (error || stderr) {
            var msg = 'garbage collector error: ';
            try {
              msg += error?error:''+'-- '+stderr?stderr:'';
            } catch (e) { }
            fb.logger.warn(msg);
          }
        } );
    }, gc_interval);

  //gc from cache
  var gcfc_status = 0;
  fb.gcfcid = setInterval(function() {
    if (gcfc_status === 1 || gc_hash === null || Object.keys(gc_hash).length === 0) return; //optimization to avoid empty loop
    gcfc_status = 1;
    var tmp_fn = tmp_path+"/gcfc-"+new Date().valueOf()+"-"+Math.floor(Math.random()*10000)+"-"+Math.floor(Math.random()*10000);
    var tmp_hash = gc_hash;
    gc_hash = null;
    gc_hash = {};
    fs.writeFile(tmp_fn,JSON.stringify(tmp_hash), function(err) {
      tmp_hash = null;
      if (err) { gcfc_status = 0; return; }
      exec(node_exepath + " " + gcfc_exepath + " " + tmp_fn + " " +fb.root_path + " --tmp " + tmp_path + " > /dev/null",
        function(error,stdout, stderr) {
          gcfc_status = 0; //finished set to 0
          if (error || stderr) {
            var msg = 'light weight garbage collector error: ';
            try {
              msg += error?error:''+'-- '+stderr?stderr:'';
            } catch (e) { }
            fb.logger.warn(msg);
          }
          fs.unlink(tmp_fn,function() {} );
        } );
    });
   }, gcfc_interval);
  //gc tmp
  var gctmp_status = 0;
  fb.gctmpid = setInterval(function() {
    if (gctmp_status === 1) return; //already a gc process running
    gctmp_status = 1;
    exec(node_exepath + " " + gctmp_exepath + " " + fb.root_path + " > /dev/null",
        function(error,stdout, stderr) {
          if (error || stderr) {
            var msg = 'tmp garbage collector error: ';
            try {
              msg += error?error:''+'-- '+stderr?stderr:'';
            } catch (e) { }
            fb.logger.warn(msg);
          }
          gctmp_status = 0; //finished set to 0
        } );
    }, gctmp_interval);
  //gc left over files
  var current_ts = new Date().valueOf();
  setTimeout(function() {
    fb.logger.info('start to collect left over tmp files');
    exec(node_exepath + " " + gctmp_exepath + " " + fb.root_path + " --ts "+current_ts+" > /dev/null",
        function(error,stdout, stderr) {
          if (error || stderr) {
            fb.logger.warn('error in gc left over tmp files: ' + error?error:''+'-- '+stderr?stderr:'');
          }
          fb.logger.info('left over tmp files collected; now start to collect left over gc files');
          exec(node_exepath + " " + gc_exepath + " " + fb.root_path + " --ts "+current_ts+" ",
              function(error2,stdout2, stderr2) {
                if (error2 || stderr2) {
                  fb.logger.warn('error in gc left over gc files: ' + error2?error2:''+'-- '+stderr2?stderr2:'');
                }
                else fb.logger.info('left over gc files collected');
              } );
        } );
  },500);
}

function start_quota_gathering(fb)
{
  fs.readdir(fb.root_path, function(err, dirs) {
    if (err) {
      setTimeout(start_quota_gathering, 1000, fb);
      return;
    }
    var evt = new events.EventEmitter();
    var counter = dirs.length;
    var sum = 0, sum2 = 0;
    var used_quota = new Array(dirs.length);
    var obj_count = new Array(dirs.length);
    evt.on("Get Usage",function (dir_name, idx) {
      fs.readFile(fb.root_path+"/"+dir_name+"/~enum/quota", function(err,data) {
          if (err) { obj_count[idx] = null; used_quota[idx] = null; } else
          { try { var obj = JSON.parse(data); obj_count[idx] = parseInt(obj.count,10); used_quota[idx] = parseInt(obj.storage,10); } catch (e) { obj_count[idx] = null; used_quota[idx] = null; } }
          counter--; if (counter === 0) { evt.emit("Start Aggregate"); }
      });
    });
    evt.on("Start Aggregate", function () {
      for (var i = 0; i < dirs.length; i++) {
        if (used_quota[i] === null)  { continue; }
        sum += used_quota[i]; sum2 += obj_count[i];
      }
      fb.used_quota = sum; fb.obj_count = sum2;
      //console.log('usage: ' + sum +' count: '+sum2);
      setTimeout(start_quota_gathering,1000,fb);
    });
    if (dirs.length === 0) { evt.emit("Start Aggregate"); }
    for (var i = 0; i < dirs.length; i++)
    { evt.emit("Get Usage",dirs[i],i); }
  });
}

function FS_blob(option,callback)  //fow now no encryption for fs
{
  var this1 = this;
  this.root_path = option.root; //check if path exists here
  this.tmp_path = option.tmp_path ? option.tmp_path : "/tmp";
  this.logger = option.logger;
  if (option.quota) { this.quota = parseInt(option.quota,10); this.used_quota = 0; }
  else {this.quota = 100 * 1024 * 1024; this.used_quota=0;} //default 100MB
  if (option.obj_limit) { this.obj_limit = parseInt(option.obj_limit, 10); this.obj_count = 0; }
  else {this.obj_limit=10000; this.obj_count=0;} //default 10,000 objects
  if (!this1.root_path) {
    this1.root_path = './fs_root'; //default fs root
    try {
      fs.mkdirSync(this1.root_path, "0775");
    } catch (err) {
      if (err.code != 'EEXIST') {
        this1.logger.error( ('default root folder creation error: '+err));
        if (callback) { callback(this1,err); }
        return;
      }
    }
  }
  fs.stat(this1.root_path, function(err,stats) {
    if (!err) {
      start_gc(option,this1);
      //set enumeration on by default
      if (option.collector === undefined || option.collector === true) {
        this.collector = true;
        start_collector(option,this1);
        //as long as enumeration is on, quotas is enabled as well
        setTimeout(start_quota_gathering, 1000, this1);
      }
    } else { this1.logger.error( ('root folder in fs driver is not mounted')); }
    if (callback) { callback(this1,err); }
    //check openssl
    exec('echo "dummy" | openssl md5',
        function(error,stdout, stderr) {
          if (error || stderr || stdout !== 'f02e326f800ee26f04df7961adbf7c0a\n') {
            this1.logger.info('no openssl for md5 calculation');
            return;
          }
          this1.logger.info('use openssl for md5 calculation');
          openssl_available = true;
        } );
  });
}

FS_blob.prototype.container_create = function(container_name,callback,fb)
{
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  fs.stat(fb.root_path+"/"+container_name+"/ts", function(err,stats) {
    if (stats) {fb.logger.debug("container_name "+container_name+" exists!");
      resp_code = 200;
      var header = common_header();
      header.Location = '/' + container_name;
      resp_header = header;
      callback(resp_code, resp_header, null, null);
      return;
    }
    var c_path = fb.root_path + "/" + container_name;
    try {
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
      if (Path.existsSync(c_path+"/"+ENUM_FOLDER) === false)
      {
        fs.mkdirSync(c_path+"/"+ENUM_FOLDER,"0775");
      }
      fs.writeFileSync(c_path+"/"+ENUM_FOLDER+"/base", "{}");
      if (Path.existsSync(c_path+"/ts") === false) //double check ts
      {
        fb.logger.debug( ("timestamp "+c_path+"/ts does not exist. Need to create one"));
        fs.writeFileSync(c_path+"/ts", "DEADBEEF");
      } else
      {
        fb.logger.debug( ("timestamp "+c_path+"/ts exists!"));
      }
    } catch (err1) {
      var resp = {};
      error_msg(500,"InternalError","Cannot create bucket because: "+err1,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body,null);
      return;
    }
    resp_code = 200;
    var header = common_header();
    header.Location = '/'+container_name;
    resp_header = header;
    callback(resp_code, resp_header, null, null);
  });
};

//delete a container_name; fail if it's not empty
//deleting a container is generally considered rare, and we don't care too much about
//its performance or isolation
FS_blob.prototype.container_delete = function(container_name,callback,fb)
{
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  var c_path = fb.root_path + "/" + container_name+"/meta";
  if (Path.existsSync(c_path) === false)
  { //shortcut, remove directly
    var child = exec('rm -rf '+fb.root_path+"/"+container_name,
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
  fn1 = fb.tmp_path+'/find1-'+da+"-"+Math.floor(Math.random() * 10000)+"-"+Math.floor(Math.random()*10000);
  fn2 = fb.tmp_path+'/find2-'+da+"-"+Math.floor(Math.random() * 10000)+"-"+Math.floor(Math.random()*10000);
  var child1 = exec('find '+c_path+"/*/* -type d -empty > "+fn1, function(error,stdout,stderr) {
      var child2 = exec('find '+c_path+"/*/* -type d > "+fn2, function(error,stdout,stderr) {
        var child3 =  exec('diff -q '+fn1+" "+fn2, function(error,stdout,stderr) {
          if (stdout === null || stdout === undefined || stdout === '') {
            var child = exec('rm -rf '+fb.root_path+"/"+container_name,
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
          var retry_cnt=0;
          while (retry_cnt < MAX_DEL_RETRY) { try { fs.unlinkSync(fn1); } catch (e) {} ; retry_cnt++; }
          retry_cnt=0;
          while (retry_cnt < MAX_DEL_RETRY) { try { fs.unlinkSync(fn2); } catch (e) {} ; retry_cnt++; }
        });
   });
  });
};

//need to revisit sync operation on FS in this check
// currently necessary for PUT (to avoid losing events at the beginning of the request)
// not necessary for other operations - could call async version of this for better concurrency
// revisit for perf when perf is revisited
function container_exists(container_name, callback,fb)
{
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  var c_path = fb.root_path + "/" + container_name;
  if (!Path.existsSync(c_path)) {
    fb.logger.error( ("no such container_name"));
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
    physical path: /container_name/prefix/filename
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
        //ENOENT: error response no such container
      }
    }
  }
  return true;
}

FS_blob.prototype.file_create = function (container_name,filename,create_options, create_meta_data, data,callback,fb)
{
  var resp = {};
//step 1 check container existence
  var c_path = this.root_path + "/" + container_name;
  if (container_exists(container_name,callback,fb) === false) return;
  //QUOTA
  if (this.quota && this.used_quota + parseInt(create_meta_data["content-length"],10) > this.quota || this.obj_limit && this.obj_count >= this.obj_limit) {
    error_msg(500,"UsageExceeded","Usage will exceed the quota",resp);
    callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
    return;
  }
//step2.1 calc unique hash for key
  var key_fingerprint = get_key_fingerprint(filename);
//step2.2 gen unique version id
  var version_id = generate_version_id(key_fingerprint);
//step3 create meta file in ~tmp (probably create parent folders)
  var prefix1 = key_fingerprint.substr(0,PREFIX_LENGTH), prefix2 = key_fingerprint.substr(PREFIX_LENGTH,PREFIX_LENGTH);
  var prefix_path = prefix1 + "/" + prefix2 + "/";
  var temp_path = c_path + "/" + TEMP_FOLDER +"/" + version_id;
  var blob_path = c_path + "/blob/" + prefix_path + version_id;
  var meta_json = { vblob_file_name : filename, vblob_file_path : "blob/"+prefix_path+version_id };
  try {
    fs.writeFileSync(temp_path, JSON.stringify(meta_json));
  } catch (err1) {
    if (resp !== null) {
      error_msg(500,"InternalError",err1,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
    }
    fs.unlink(temp_path,function(err) {});
    return;
  }
//step 3.1 create folders is needed
  if (!create_prefix_folders([c_path+"/blob",prefix1,prefix2],callback)) { fs.unlink(temp_path,function(err) {}); return; }
  if (!create_prefix_folders([c_path+"/versions", prefix1,prefix2],callback)) { fs.unlink(temp_path,function(err) {}); return; }
  if (!create_prefix_folders([c_path+"/meta",prefix1,prefix2],callback)) { fs.unlink(temp_path,function(err) {}); return; }
//step 4 stream blob
  var stream = fs.createWriteStream(blob_path);
  var md5_etag = crypto.createHash('md5');
  var md5_base64 = null;
  var file_size = 0;
  var upload_failed = false;
  stream.on("error", function (err) {
    upload_failed = true;
    fb.logger.error( ("write stream " + blob_path+" "+err));
    if (resp !== null) {
      error_msg(500,"InternalError",err,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
    }
    if (data) data.destroy();
    if (stream && !stream.destroyed) { stream.destroyed = true;  stream.destroy(); }
    stream = null;
    fs.unlink(blob_path, function(err) {});
    fs.unlink(temp_path, function(err) {});
    //stream.destroy();
  });
  data.on("error", function (err) {
    upload_failed = true;
    if (resp !== null) {
      error_msg(500,"InternalError",err,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
    }
    fb.logger.error( ('input stream '+blob_path+" "+err));
    if (data) data.destroy();
    if (stream && !stream.destroyed) { stream.destroyed = true; stream.destroy(); }
  });
  data.on("data",function (chunk) {
    if (file_size < 512000 || !openssl_available) md5_etag.update(chunk); else md5_etag = null;
    file_size += chunk.length;
    stream.write(chunk);
  });
  data.on("end", function () {
    fb.logger.debug( ('upload ends '+blob_path));
    data.upload_end = true;
    stream.end();
    stream.destroySoon();
  });

  var closure1 = function(md5_etag) {
    var opts = {vblob_file_name: filename, vblob_file_path: "blob/"+prefix_path+version_id, vblob_file_etag : md5_etag, vblob_file_size : file_size, vblob_file_version : version_id, vblob_file_fingerprint : key_fingerprint};
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
        fs.unlink(temp_path, function(err) {});
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
    fb.file_create_meta(container_name,filename,temp_path,opts,callback,fb,!data.connection);
  };

  stream.once("close", function() {
    if (upload_failed) {
      if (resp !== null) {
        error_msg(500,"InternalError","upload failed",resp);
        callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
      }
      fs.unlink(blob_path, function(err) {});
      fs.unlink(temp_path, function(err) {});
      return;
    }
    fb.logger.debug( ("close write stream "+filename));
    if (md5_etag) {
      md5_etag = md5_etag.digest('hex');
      closure1(md5_etag);
    } else
    var child = exec('openssl md5 '+blob_path,
          function (error, stdout, stderr) {
      if (error) {
          fb.logger.error(blob_path+' md5 calculation error: '+error);
          error_msg(500,"InternalError","Error in md5 calculation:"+error,resp);
          callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
          data.destroy();
          remove_uploaded_file(blob_path);
          return;
      }
      //MD5(test1.txt)= xxxxx
      md5_etag = stdout.substr(stdout.lastIndexOf(" ")+1);
      md5_etag = md5_etag.replace("\n","");
      closure1(md5_etag);
    }); //openssl
  });
  if (data.connection) // copy stream does not have connection
  {
    data.connection.once('close',function() {
      fb.logger.debug( ('client disconnect'));
      if (data.upload_end === true) { return; }
      upload_failed = true;
      fb.logger.warn( ('interrupted upload: ' + filename));
      data.destroy();
      stream.destroy();
    });
  }
};

FS_blob.prototype.file_create_meta = function (container_name, filename, temp_path, opt,callback,fb,is_copy)
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
  doc.vblob_update_time = dDate.toUTCString().replace(/UTC/ig, "GMT"); //RFC 822
  doc.vblob_file_name = filename;
  //temp_path will be writen twice, to prevent losing information when crash in the middle of an upload
  fs.writeFile(temp_path,JSON.stringify(doc), function(err) {
    if (err) {
      fb.logger.error( ("In creating file "+filename+" meta in container_name "+container_name+" "+err));
      if (resp !== null) {
        error_msg(404,"NoSuchBucket",err,resp);
        callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
      }
      fs.unlink(temp_path,function(err) {});
      fs.unlink(fb.root_path+"/"+container_name+"/"+doc.vblob_file_path,function(err){});
      return;
    }
    fb.logger.debug( ("Created meta for file "+filename+" in container_name "+container_name));
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
    fs.symlink(temp_path, fb.root_path + "/" + container_name + "/" +GC_FOLDER +"/" + doc.vblob_file_version,function(err) {
      if (err) {
        fb.logger.error( ("In creating file "+filename+" meta in container_name "+container_name+" "+err));
        if (resp !== null) {
          error_msg(500,"InternalError",err,resp);
          callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
        }
        fs.unlink(temp_path,function(err) {});
        fs.unlink(fb.root_path+"/"+container_name+"/"+doc.vblob_file_path,function(err){});
        return;
      }
      //add to gc cache
      if (!gc_hash[container_name]) gc_hash[container_name] = {};
      if (!gc_hash[container_name][doc.vblob_file_fingerprint]) gc_hash[container_name][doc.vblob_file_fingerprint] = {ver:[doc.vblob_file_version], fn:doc.vblob_file_name}; else gc_hash[container_name][doc.vblob_file_fingerprint].ver.push(doc.vblob_file_version);
    //step 6 mv to versions
      var prefix1 = doc.vblob_file_version.substr(0,PREFIX_LENGTH), prefix2 = doc.vblob_file_version.substr(PREFIX_LENGTH,PREFIX_LENGTH);
      //link to version, so version link > 1, gc won't remove it at this point
      fs.link(temp_path, fb.root_path + "/"+container_name+"/versions/" + prefix1 + "/" + prefix2 + "/" + doc.vblob_file_version,function (err) {
        if (err) {
          fb.logger.error( ("In creating file "+filename+" meta in container_name "+container_name+" "+err));
          if (resp !== null) {
            error_msg(500,"InternalError",err,resp);
            callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
          }
          return;
        }
    //step 7 ln -f meta/key versions/version_id
        var child = exec('ln -f '+fb.root_path + "/"+container_name+"/versions/" + prefix1 + "/" + prefix2 + "/" + doc.vblob_file_version+" "+ fb.root_path + "/"+container_name+"/meta/" + prefix1 + "/" + prefix2 + "/" + doc.vblob_file_fingerprint,
          function (error, stdout, stderr) {
            //now we can remove temp
            fs.unlink(temp_path,function(err) {});
    //step 8 respond
            fb.logger.debug("file creation "+doc.vblob_file_version+" complete, now reply back...");
            callback(resp.resp_code, resp.resp_header, resp.resp_body,null);
          }
        );
      });
    });
  });
};

FS_blob.prototype.file_delete_meta = function (container_name, filename, callback, fb)
{
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  var c_path = fb.root_path + "/" + container_name;
  if (container_exists(container_name,callback,fb) === false) return;
//step2.1 calc unique hash for key
  var key_fingerprint = get_key_fingerprint(filename);
//step2.2 gen unique version id
  //generate a fake version, just a place holder to let gc know there are work to do
  var version_id = generate_version_id(key_fingerprint);
  var prefix1 = key_fingerprint.substr(0,PREFIX_LENGTH), prefix2 = key_fingerprint.substr(PREFIX_LENGTH,PREFIX_LENGTH);
  var file_path = c_path + "/meta/" + prefix1 +"/"+prefix2+"/"+key_fingerprint; //complete representation: /container_name/filename
  fs.symlink(c_path +"/" + TEMP_FOLDER + "/"+version_id, c_path + "/"+GC_FOLDER+"/" + version_id,function(err) {
    if (err) {
      var resp = {};
      error_msg(500,"InternalError",err,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
      return;
    }
    //add to gc cache
    if (!gc_hash[container_name]) gc_hash[container_name] = {};
    if (!gc_hash[container_name][key_fingerprint]) gc_hash[container_name][key_fingerprint] = {ver:[version_id],fn:filename}; else gc_hash[container_name][key_fingerprint].ver.push(version_id);

    fs.unlink(file_path, function(err) {
      //ERROR?
      resp_code = 204;
      var header = common_header();
      resp_header = header;
      callback(resp_code, resp_header, null, null);
    });
  });
};

FS_blob.prototype.file_copy = function (container_name,filename,source_container,source_file,options, metadata, callback,fb, retry_cnt)
{
  var resp = {};
//step 1 check container existence
  var c_path = this.root_path + "/" + container_name;
  var src_path = this.root_path + "/" + source_container;
  if (container_exists(container_name,callback,fb) === false) return;
  if (container_exists(source_container,callback,fb) === false) return ;
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
      if (!retry_cnt) retry_cnt = 0;
      if (retry_cnt < MAX_COPY_RETRY) { //reduce the false negative rate
        setTimeout(function(fb1) { fb1.file_copy(container_name, filename, source_container, source_file, options, metadata, callback,fb1, retry_cnt+1); }, Math.floor(Math.random()*1000) + 100,fb);
        return;
      }
      error_msg(404,"NoSuchFile",err,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
      return;
    }
    var obj = JSON.parse(data);
    //QUOTA
    if (source_container !== container_name || source_file !== filename) {
      if (fb.quota && fb.used_quota + obj.vblob_file_size > fb.quota ||
          fb.obj_limit && fb.obj_count >= fb.obj_limit) {
        error_msg(500,"UsageExceeded","Usage will exceed quota",resp);
        callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
        return;
      }
    }
    if (true) {
      //check etag, last modified
      var check_modified = true;
      var t1,t2;
      if (date_modified) {
        t1 = new Date(date_modified).valueOf();
        t2 = new Date(obj.vblob_update_time).valueOf();
        check_modified = t2 > t1 || t1 >  new Date().valueOf();
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
      dest_obj.vblob_file_path = "blob/"+prefix_path+version_id;//blob_path;
      keys = Object.keys(obj);
      if (meta_dir === 'COPY') {
        if (source_container === container_name && source_file === filename) {
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
          } else if (!key.match(/^content-length/i)) dest_obj[key] = metadata[key];
        }
      }
      dest_obj.vblob_file_size = obj.vblob_file_size; //not to override content-length!!
      //new file meta constructed, ready to create links etc.
      if (!create_prefix_folders([c_path+"/blob",prefix1,prefix2],callback)) return;
      if (!create_prefix_folders([c_path+"/versions", prefix1,prefix2],callback)) return;
      if (!create_prefix_folders([c_path+"/meta",prefix1,prefix2],callback)) return;
      fs.writeFile(temp_path, JSON.stringify(dest_obj), function (err) {
        if (err) {
          error_msg(500,"InternalError",""+err,resp);
          callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
          return;
        }
        fs.link(src_path+"/"+obj.vblob_file_path, c_path+"/"+dest_obj.vblob_file_path, function(err) {
          if (err) {
            remove_uploaded_file(temp_path);
            setTimeout(function(fb1) { fb1.file_copy(container_name, filename, source_container, source_file, options, metadata, callback,fb1); }, Math.floor(Math.random()*1000) + 100,fb);
            return;
          }
          //ready to call file_create_meta
          fb.file_create_meta(container_name,filename, temp_path, dest_obj, callback, fb, true);
        });
      });
    };
  });
};

FS_blob.prototype.file_read = function (container_name, filename, options, callback, fb, retry_cnt)
{
  var range = options.range;
  var verb = options.method;
  var resp = {}; //for error_msg
  var resp_code, resp_header, resp_body;
  resp_code = resp_header = resp_body = null;
  var c_path = this.root_path + "/" + container_name;
  if (container_exists(container_name,callback,this) === false) return;
//step2.1 calc unique hash for key
  var key_fingerprint = get_key_fingerprint(filename);
//step2.2 gen unique version id
  var file_path = c_path + "/meta/" + key_fingerprint.substr(0,PREFIX_LENGTH)+"/"+key_fingerprint.substr(PREFIX_LENGTH,PREFIX_LENGTH)+"/"+key_fingerprint; //complete representation: /container_name/filename
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
    if (err) {
      //link is atomic, but re-link is two-step; re-query once to reduce the false negative rate
      if (!retry_cnt) retry_cnt = 0;
      if (retry_cnt < MAX_READ_RETRY) {
        setTimeout(function(fb1) { fb1.file_read(container_name, filename, options, callback,fb1, retry_cnt+1); }, Math.floor(Math.random()*1000) + 100,fb);
        return;
      }
      error_msg(404,"NoSuchFile",err,resp); callback(resp.resp_code, resp.resp_header, resp.resp_body, null); return;
    }
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
      modified_since = t2 > t1 || t1 > new Date().valueOf(); //make sure the timestamp is not in the future
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
      resp.resp_header.etag = obj.vblob_file_etag; resp.resp_header["last-modified"] = obj.vblob_update_time;
      callback(resp.resp_code, resp.resp_header, /*resp.resp_body*/ null, null); //304 should not have body
      return;
    }
    header["content-type"] = obj["content-type"] ? obj["content-type"] :  "binary/octet-stream";
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
      } else if (obj_key.match(/^vblob_/) === null) {
        //other standard attributes
        header[obj_key] = obj[obj_key];
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
      if (range.start === undefined) { range.start = obj.vblob_file_size - range.end; delete range.end; }
      if (range.end === undefined) { range.end = obj.vblob_file_size-1; }
      header["Content-Length"] = range.end - range.start + 1;
      //resp.writeHeader(206,header);
      resp_code = 206; resp_header = header;
      if (verb==="get") { //TODO: retry for range read?
        if (range.start < 0 || range.start > range.end ||
            range.start > obj.vblob_file_size-1 || range.end > obj.vblob_file_size-1)
        {
          error_msg(416,'InvalidRange','The requested range is not satisfiable',resp);
          callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
          return;
        }
        st = fs.createReadStream(c_path+"/"+obj.vblob_file_path, range);
        st.on('error', function(err) {
          st = null;
          error_msg(503,'SlowDown','The object is being updated too frequently, try later',resp);
          callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
        });
        st.on('open', function(fd) {
          callback(resp_code, resp_header, null, st);
        });
      } else {
        if (range.start < 0 || range.start > range.end ||
            range.start > obj.vblob_file_size-1 || range.end > obj.vblob_file_size-1)
        {
          error_msg(416,'InvalidRange','The requested range is not satisfiable',resp);
          callback(resp.resp_code, resp.resp_header, null, null);
          return;
        }
        callback(resp_code, resp_header, null, null);
      }
    } else {
      resp_code = 200; resp_header = header;
      //resp.writeHeader(200,header);
      if (verb==="get") {
        st = fs.createReadStream(c_path+"/"+obj.vblob_file_path);
        st.on('error', function(err) {//RETRY??
          st = null;
          fb.logger.error( ("file "+obj.vblob_file_version+" is purged by gc already!"));
          //error_msg(508,'SlowDown','The object is being updated too frequently, try later',resp);
          //callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
          setTimeout(function(fb1) { fb1.file_read(container_name, filename, options, callback,fb1); }, Math.floor(Math.random()*1000) + 100,fb);
        });
        st.on('open', function(fd) {
          callback(resp_code, resp_header, null, st);
        });
      }  else { callback(resp_code, resp_header, null, null);  }
    }
  });
};

function query_files(container_name, options, callback, fb)
{
  var keys = null;
  keys = enum_cache[container_name].keys;
  if (!keys) {
    fb.logger.debug("sorting the file keys in container " + container_name);
    keys = Object.keys(enum_cache[container_name].tbl);
    keys = keys.sort();
    enum_cache[container_name].keys = keys;
  }
  var idx = 0;
  var low = 0, high = keys.length-1, mid;
  if (options.marker || options.prefix) {
    var st = options.marker;
    if (!st || st < options.prefix) st = options.prefix;
    while (low <= high) {
      mid = ((low + high) >> 1);
      if (keys[mid] === st) { low = mid; break; } else
      if (keys[mid] < st) low = mid + 1;
      else high = mid-1;
    }
    idx = low;
  }
  var idx2 = keys.length;
  if (options.prefix) { //end of prefix range
    var st2 = options.prefix;
    st2 = st2.substr(0,st2.length-1)+String.fromCharCode(st2.charCodeAt(st2.length-1)+1);
    low = idx; high = keys.length-1;
    while (low <= high) {
      mid = ((low + high) >> 1);
      if (keys[mid] === st2) { low = mid; break; } else
      if (keys[mid] < st2) low = mid + 1;
      else high = mid-1;
    }
    idx2 = low;
  }
  var limit1;
  try { limit1 = options["max-keys"] ? parseInt(options["max-keys"],10) : 1000; } catch (err) { limit1 = 1000; }
  var limit = limit1;
  if (limit > 1000) limit = 1000;
  var res_json = {};
  var res_contents = [];
  var res_common_prefixes = [];
  res_json["Name"] = container_name;
  res_json["Prefix"] = options.prefix ? options.prefix : {};
  res_json["Marker"] = options.marker ? options.marker : {};
  res_json["MaxKeys"] = ""+limit;
  if (options.delimiter) {
    res_json["Delimiter"] = options.delimiter;
  }
  var last_pref = null;
  for (var i = 0; i < limit && idx < idx2; ) {
    var key = keys[idx];
    idx++;
    if (options.delimiter) {
      var start = 0;
      if (options.prefix) start = options.prefix.length;
      var pos = key.indexOf(options.delimiter,start);
      if (pos >= 0) { //grouping together [prefix] .. delimiter
        var pref = key.substring(0, pos+1);
        if (pref === last_pref) continue;
        last_pref = pref;
        res_common_prefixes.push({"Prefix":pref});
        i++; continue;
      }
    }
    i++;
    var doc = enum_cache[container_name].tbl[key];
    res_contents.push({"Key":key, "LastModified":new Date(doc.lastmodified).toISOString(), "ETag":'"'+doc.etag+'"', "Size":doc.size, "Owner":{}, "StorageClass":"STANDARD"});
  }
  if (i >= limit && idx < idx2 && limit <= limit1) res_json["IsTruncated"] = 'true';
  else res_json["IsTruncated"] = 'false';
  if (res_contents.length > 0) res_json["Contents"] =  res_contents; //files
  if (res_common_prefixes.length > 0) res_json["CommonPrefixes"] = res_common_prefixes; //folders
  var resp = {};
  resp.resp_code = 200; resp.resp_header = common_header(); resp.resp_body = {"ListBucketResult":res_json};
  res_json = null; res_contents = null; keys = null; res_common_prefixes = null;
  callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
}

FS_blob.prototype.file_list = function(container_name, options, callback, fb)
{
  if (options.delimiter && options.delimiter.length > 1) {
    var resp = {};
    error_msg(400,"InvalidArgument","Delimiter should be a single character",resp);
    callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
    return;
  }
  var c_path = this.root_path + "/" + container_name;
  if (container_exists(container_name,callback,this) === false) return;
  var now = new Date().valueOf();
  if (!enum_cache[container_name] || !enum_expire[container_name] || enum_expire[container_name] < now) {
    enum_cache[container_name] = null;
    try {
      enum_cache[container_name] = {tbl:JSON.parse(fs.readFileSync(fb.root_path+"/"+container_name+"/"+ENUM_FOLDER+"/base"))};
      enum_expire[container_name] = now + 1000 * 5;
      query_files(container_name, options,callback,fb);
    } catch (e) {
      var resp = {};
      error_msg(500,'InternalError',e,resp);
      callback(resp.resp_code, resp.resp_header, resp.resp_body, null);
    }
  } else query_files(container_name, options,callback,fb);
}

FS_blob.prototype.container_list = function()
{
  return  fs.readdirSync(this.root_path);
};

function render_containers(dirs,callback,fb)
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
//this is interface file for abstraction
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

FS_Driver.prototype.container_list = function (callback) {
  if (check_client(this.client,callback) === false) return;
  var dirs = this.client.container_list();
  render_containers(dirs,callback,this.client);
};

FS_Driver.prototype.file_list = function(container_name,option,callback) {
  if (check_client(this.client,callback) === false) return;
  this.client.file_list(container_name,option, callback, this.client);
};

FS_Driver.prototype.file_read = function(container_name,file_key,options,callback){
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
    options.range = range1;
  }
  this.client.file_read(container_name, file_key, options, callback, this.client);
};

FS_Driver.prototype.file_create = function(container_name,file_key,options, metadata, data_stream,callback) {
  if (check_client(this.client,callback) === false) return;
  this.client.file_create(container_name,file_key,options,metadata, data_stream, callback,this.client);
};

FS_Driver.prototype.file_copy = function(container_name, file_key, source_container,source_file_key,options, metadata, callback)
{
  if (check_client(this.client,callback) === false) return;
  this.client.file_copy(container_name,file_key,source_container,source_file_key,options, metadata, callback,this.client);
};

FS_Driver.prototype.container_create = function(container_name,options,data_stream,callback) {
  if (check_client(this.client,callback) === false) return;
  this.client.container_create(container_name,callback,this.client);
};

FS_Driver.prototype.file_delete = function(container_name,file_key,callback) {
  if (check_client(this.client,callback) === false) return;
  this.client.file_delete_meta(container_name,file_key,callback,this.client);
};

FS_Driver.prototype.container_delete = function(container_name,callback) {
  if (check_client(this.client,callback) === false) return;
  this.client.container_delete(container_name,callback,this.client);
};

FS_Driver.prototype.get_config = function() {
  var obj = {}; var obj2 = {};
  obj.type = "fs";
  obj2.root= this.client.root_path;
  obj2.node_exepath = this.client.node_exepath;
  obj2.gc_exepath = this.client.gc_exepath;
  obj2.gc_interval = this.client.gc_interval;
  obj2.gcfc_exepath = this.client.gcfc_exepath;
  obj2.gcfc_interval = this.client.gcfc_interval;
  obj2.gctmp_exepath = this.client.gctmp_exepath;
  obj2.gctmp_interval = this.client.gctmp_interval;
  obj2.ec_exepath = this.client.ec_exepath;
  obj2.ec_interval = this.client.ec_interval;
  obj2.collector = this.client.collector;
  obj2.quota = this.client.quota;
  obj2.obj_limit = this.client.obj_limit;
  obj.option = obj2;
  return obj;
};

module.exports.createDriver = function(option,callback) {
  return new FS_Driver(option, callback);
};
