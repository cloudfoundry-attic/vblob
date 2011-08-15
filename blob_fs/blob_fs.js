/*
  Author: wangs@vmware.com
  Require additional library node-mongodb-native: https://github.com/christkv/node-mongodb-native.git
  Do not use NPM to install that lib, version's too old; use the latest source code
  Set the root dir of the blob, e.g.: var fb = new FS_blob("/mnt/sdb1/tmp");
  A mongo db service is needed for storing meta data.
  start a mongod process, and create a user id/pwd
  Need winston module for logging
*/
var winston = require('winston');
var fs = require('fs');
var Path = require('path');
var crypto = require('crypto');
var util = require('util');
var events = require("events");
var mongo_path = "./node-mongodb-native/lib/mongodb";
var Db = require( mongo_path ).Db;
var Connection = require( mongo_path ).Connection;
var Server = require( mongo_path ).Server;
var BSON = require( mongo_path ).BSONNative;
var PREFIX_LENGTH = 2; //how many chars we use for hash prefixes
var MAX_LIST_LENGTH = 1000; //max number of objects to list
var base64_char_table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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
  header.Connection = "close";
  header["content-type"] = "application/json";
  var dates = new Date();
  header.date = dates.toString();
  header.Server = "FS";
  header["x-amz-request-id"] = "1D2E3A4D5B6E7E8F9"; //No actual request id for now
  header["x-amz-id-2"] = "3F+E1E4B1D5A9E2DB6E5E3F5D8E9"; //no actual request id 2
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

function FS_blob(root_path,mds_cred,callback)  //fow now no encryption for fs
{
  this.root_path = root_path;
  var host = mds_cred.host;
  var port = mds_cred.port;
  var this1 = this;
  this.MDS  = null;
  var db = new Db(mds_cred.db, new Server(host, port, {}), {native_parser:true});
  db.open(function(err, db) {
    if (err) {
      winston.log('error',(new Date())+' - Please make sure mongodb host and port are correct!');
      throw err;
    }
    db.authenticate(mds_cred.user,mds_cred.pwd,function(err,res) {
      if (!err) { winston.log('info',(new Date())+" - connectd to mongo");} else {
        winston.log('error',(new Date())+' - Please use correct credentials!');
        throw err;
      }
      this1.MDS = db;
      if (callback) { callback(this1); }
    });
  });
}

FS_blob.prototype.create_container = function(container,resp)
{
  var c_path = this.root_path + "/" + container;
  if (Path.existsSync(c_path) === false)
  {
    winston.log('debug',(new Date())+" - path "+c_path+" does not exist! Let's create one");
    fs.mkdirSync(c_path,"0777");
  } else
  {
    winston.log('debug',(new Date())+" - path "+c_path+" exists!");
  }
  resp.resp_code = 200;
  var header = common_header();
  delete header["content-type"];
  header["content-length"] = 0;
  header.location = '/'+container;
  resp.resp_header = header;
  resp.resp_end();
};

FS_blob.prototype.create_container_meta = function(container,resp,fb)
{
  var dTime = new Date();
  fb.MDS.collection(container, {safe:true},function(err,coll) {
    if (coll) {winston.log('debug',"container "+container+" exists!");
      resp.resp_code = 200;
      var header = common_header();
      delete header["content-type"];
      header["content-length"] = 0;
      header.location = '/' + container;
      resp.resp_header = header;
      resp.resp_end();
      return;
    }
    fb.MDS.createCollection(container, function (err,col) {
      if (err) { winston.log('error',(new Date())+" - container creation error! "+err);
        error_msg(500,"InternalError",err,resp); resp.resp_end();
        return;
      }
      col.insert({
          "vblob_container_name" : container,
          "vblob_create_time" : dTime.toString(),
          "vblob_update_time" : dTime.toString()
        }, {safe:true}, function (err, item) {
        if (!err) {
          winston.log('debug'+(new Date())+" - Inserted item "+util.inspect(item)+" to db");
          col.ensureIndex("vblob_file_name", function(err,resp) { } );
          col.ensureIndex("vblob_container_name", function(err,resp) {} ); //for quickly locating collection info
          fb.create_container(container,resp);
        }
        else {
          winston.log('error',(new Date())+" - Insertion failed for container "+container);
          error_msg(500,"InternalError",err,resp); resp.resp_end();
          fb.MDS.dropCollection(container, function(err,result) {} );
        }
      });
    });
  });
};

FS_blob.prototype.delete_container_meta = function(container,resp)
{
  winston.log('debug',(new Date())+" - deleting "+container);
  this.MDS.dropCollection(container,function (err,result) {
    if (err) {
      winston.log("error",(new Date())+" - deleting container "+container+" err! "+err);
      error_msg(500,"InternalError",err,resp); resp.resp_end(); return;
    }
    else { winston.log("debug",(new Date())+" - deleted container "+container); }
    var header = common_header();
    delete header["content-type"];
    resp.resp_code = 204; resp.resp_header = header;
    resp.resp_end();
  });
};

//delete a container; fail if it's not empty
FS_blob.prototype.delete_container = function(container,resp,fb)
{
  var c_path = this.root_path + "/" + container;
  if (Path.existsSync(c_path) === false)
  {
    error_msg(404,"NoSuchBucket","No such bucket on disk",resp); resp.resp_end(); return;
  }
  fs.rmdir(c_path,function(err) {
    if (err) { error_msg(409,"BucketNotEmpty","The bucket you tried to delete is not empty.",resp); resp.resp_end(); return; }
    fb.delete_container_meta(container,resp);
  });
};
/*
    complete name: /container/filename
    physical path: /container/prefix/filename
    prefix calculaton: prefix of PREFIX_LENGTH chars of  md5 digest of filename
    TODO: store uploaded file to a temporary place, and rename it afterwards
*/

//supress warning: no making functions inside loops
function remove_uploaded_file(fdir_path,esp_name) //folder and file name
{
  fs.unlink(fdir_path+"/"+esp_name,function(err) {
    winston.log('error',(new Date())+" - Error in deleting upload file: " + err);
    fs.rmdir(fdir_path,function(err2) {});
  });
}

FS_blob.prototype.create_file = function (container,filename,data,resp,fb)
{
  if (resp === undefined) { resp = null; }
  var c_path = this.root_path + "/" + container;
  if (!Path.existsSync(c_path)) {
    winston.log("error",(new Date())+" - no such container");
    error_msg(404,"NoSuchBucket","No such bucket on disk",resp); resp.resp_end(); return;
  }
  var file_path = c_path + "/" + filename; //complete representation: /container/filename
  var md5_name = crypto.createHash('md5');
  //md5_name.update(file_path);
  md5_name.update(filename); //de-couple from root and container paths
  var name_digest =  md5_name.digest('hex');
  winston.log('debug',(new Date())+" - create: the md5 hash for string "+filename+" is "+name_digest);
  var name_dig_pre = name_digest.substr(0,PREFIX_LENGTH);
  var fdir_path = c_path + "/" + name_dig_pre; //actual dir for the file  /container/hashprefix/
  if (!Path.existsSync(fdir_path)) { //create such folder
    fs.mkdirSync(fdir_path,"0777");
  }
  var esp_name = filename.replace(/\//g,"$_$");
  var stream = fs.createWriteStream(fdir_path+"/"+esp_name);
  var md5_etag = crypto.createHash('md5');
  var md5_base64 = null;
  var file_size = 0;
  stream.on("error", function (err) {
    winston.log('error',(new Date())+" - write stream " + filename+err);
    if (resp !== null) {
      error_msg(500,"InternalError",err,resp); resp.resp_end();
    }
    data.destroy();
    stream.destroy();
    fs.unlink(fdir_path+"/"+esp_name,function(err) {
      fs.rmdir(fdir_path,function(err) { } );
    });
    return;
  });
  data.on("error", function (err) {
    if (resp !== null) {
      error_msg(500,"InternalError",err,resp); resp.resp_end();
    }
    winston.log('error',(new Date())+' - input stream '+filename+err);
    data.destroy();
    stream.destroy();
    fs.unlink(fdir_path+"/"+esp_name,function(err) {
      fs.rmdir(fdir_path,function(err) {});
    });
    return;
  });
  data.on("data",function (chunk) {
    md5_etag.update(chunk);
    file_size += chunk.length;
    stream.write(chunk);
  });
  data.on("end", function () {
    winston.log('debug',(new Date())+' - upload ends');
    data.upload_end = true;
    stream.end();
    stream.destroySoon();
    //md5_etag = md5_etag.digest('hex');
    //fb.create_file_meta(container,filename,{"vblob_file_etag":md5_etag,"vblob_file_size":file_size},res,fb);
  });
  stream.on("close", function() {
    winston.log('debug',(new Date())+" - close write stream "+filename);
    md5_etag = md5_etag.digest('hex');
    var opts = {"vblob_file_etag":md5_etag,"vblob_file_size":file_size};
    var keys = Object.keys(data.headers);
    for (var idx = 0; idx < keys.length; idx++) {
      var obj_key = keys[idx];
      if (obj_key.match(/^x-amz-meta-/i)) {
        var sub_key = obj_key.substr(11);
        sub_key = "vblob_meta_" + sub_key;
        opts[sub_key] = data.headers[obj_key];
      } else if (obj_key.match(/^content-md5$/i)) {
        //check if content-md5 matches
        md5_base64 = hex2base64(md5_etag);
        if (md5_base64 !== data.headers[obj_key]) // does not match
        {
          if (resp !== null) {
            error_msg(400,"InvalidDigest","The Content-MD5 you specified was invalid.",resp); resp.resp_end();
          }
          winston.log('error',(new Date())+' - '+filename+' md5 not match: uploaded: '+ md5_base64 + ' specified: ' + data.headers[obj_key]);
          data.destroy();
          remove_uploaded_file(fdir_path,esp_name);
          return;
        }
      } else if (obj_key.match(/^content-type$/i)) {
        opts[obj_key.toLowerCase()] = data.headers[obj_key];
      }
    }
    if (!data.connection && data.headers.vblob_create_time)
    { opts.vblob_create_time = data.headers.vblob_create_time; }
    fb.create_file_meta(container,filename,opts,resp,fb,!data.connection);
  });
  if (data.connection) // copy stream does not have connection
  {
    data.connection.on('close',function() {
      winston.log('debug',(new Date())+' - client disconnect');
      if (data.upload_end === true) { return; }
      winston.log('warn',(new Date())+' - interrupted upload: ' + filename);
      data.destroy();
      stream.destroy();
      fs.unlink(fdir_path+"/"+esp_name, function() {
        fs.rmdir(c_path,function(err) {});
      });
      return;
    });
  }
};

FS_blob.prototype.create_file_meta = function (container, filename, opt,resp,fb,is_copy)
{
  if (opt === undefined) { opt = null; }
  if (resp === undefined) { resp = null; }
  var doc = {};
  if (opt !== null) {
    for (var key in opt)
    { doc[key] = opt[key]; }
  }
  var dDate = new Date();
  if (!doc.vblob_create_time) //special consideration for copy
  { doc.vblob_create_time = dDate.toString(); }
  doc.vblob_update_time = dDate.toString();
  doc.vblob_file_name = filename;
  fb.MDS.collection(container, {safe:true}, function (err,coll) {
    if (err || !coll) {
      winston.log('error',(new Date())+" - In creating file "+filename+" meta in container "+container+" "+err);
      if (resp !== null) {
        error_msg(404,"NoSuchBucket",err,resp);
        resp.resp_end();
      }
      fb.delete_file(container,filename,null);
      return;
    }
    coll.findOne({"vblob_file_name":filename}, function (err, obj) {
      if (err) {
        if (resp !== null) { error_msg(500,"InternalError",err,resp); resp.resp_end();}
        fb.delete_file_meta(container,filename,null,fb);
        return;
      }
      if (!obj) {
        //new object
        coll.insert(doc, function(err,docs) {
          if (err) {
            winston.log('error',(new Date())+" - In creating file "+filename+" meta in container "+container+" "+err);
            if (resp !== null) { error_msg(500,"InternalError",err,resp); resp.resp_end();  }
            fb.delete_file_meta(container,filename,null,fb);
            return;
          } else {
            winston.log('debug',(new Date())+" - Created meta for file "+filename+" in container "+container);
            var header = common_header();
            header.ETag = opt.vblob_file_etag;
            resp.resp_code = 200;
            winston.log('debug',(new Date())+' - is_copy: ' + is_copy);
            if (is_copy) {
              resp.resp_body = ('{"CopyObjectResult":')+('{"LastModified":"'+doc.vblob_update_time+'",') + ('"ETag":"'+opt.vblob_file_etag+'"}}');
              header["content-length"] = resp.resp_body.length;
              resp.resp_header = header;
            } else {
              delete header["content-type"];
              header["content-length"] = 0;
              resp.resp_header = header;
            }
            resp.resp_end();
          }
        });
      } else {
        //update
        delete doc.vblob_create_time;
        var u_doc = {};
        //we need to get rid of all user-defined meta (coz this is an overwrite)
        if (true) {
          var keys = Object.keys(obj);
          for (var idx = 0; idx < keys.length; idx++) {
            var obj_key = keys[idx];
            if (!obj_key.match(/^vblob_meta_/i)) { continue; }
            if (doc[obj_key]) { continue; } //don't delete the one to be inserted!
            u_doc[obj_key] = 1;
          }
        }
        coll.update({"_id":obj._id},{$set:doc, $unset:u_doc}, function (err, cnt) {
          if (err) {
            winston.log('error',(new Date())+" - In creating file "+filename+" meta in container "+container+" "+err);
            if (resp !== null) { error_msg(500,"InternalError",err,resp); resp.resp_end(); }
            fb.delete_file_meta(container,filename,null,fb);
            return;
          } else {
            winston.log('debug',(new Date())+" - Created meta for file "+filename+" in container "+container);
            var header = common_header();
            header.ETag = opt.vblob_file_etag;
            resp.resp_code = 200;
            winston.log('debug',(new Date())+' - is_copy: ' + is_copy);
            if (is_copy) {
              resp.resp_body = ('{"CopyObjectResult":')+('{"LastModified":"'+doc.vblob_update_time+'",') + ('"ETag":"'+opt.vblob_file_etag+'"}}');
              header["content-length"] = resp.resp_body.length;
              resp.resp_header = header;
            } else {
              delete header["content-type"];
              header["content-length"] = 0;
              resp.resp_header = header;
            }
            resp.resp_end();
          }
        });
      }
    });
  });
};

FS_blob.prototype.delete_file_meta = function (container, filename, resp, fb)
{
  if (resp === undefined) { resp = null; }
  fb.MDS.collection(container, {safe:true}, function (err,coll) {
    if (err || !coll) {  winston.log('error',(new Date())+" - In deleting file "+filename+" meta in container "+container+" "+err); if (resp!== null) { error_msg(404,"NoSuchBucket",err,resp); resp.resp_end();}  return; }
    coll.remove({vblob_file_name:filename}, function(err,docs) {
      if (err) {
        winston.log('error',(new Date())+" - In deleting file "+filename+" meta in container "+container+" "+err);
        if (resp !== null) {
          error_msg(404,"NoSuchFile",err,resp);
          resp.resp_end();
        }
        return;
      }
      else { winston.log('debug',(new Date())+" - Deleted meta for file "+filename+" in container "+container); }
      fb.delete_file(container,filename,resp);
    });
  });
};

FS_blob.prototype.delete_file = function (container, filename, resp)
{
  if (resp === undefined) { resp = null; }
  var c_path = this.root_path + "/" + container;
  var file_path = c_path + "/" + filename; //complete representation: /container/filename
  var md5_name = crypto.createHash('md5');
  //md5_name.update(file_path);
  md5_name.update(filename); //de-couple from root and container paths
  var name_digest =  md5_name.digest('hex');
  winston.log('debug',(new Date())+" - delete: the md5 hash for "+filename+" is "+name_digest);
  var name_dig_pre = name_digest.substr(0,PREFIX_LENGTH);
  var fdir_path = c_path + "/" + name_dig_pre; //actual dir for the file  /container/hashprefix/
  if (!Path.existsSync(fdir_path)) { //check such folder
    if (resp !== null) {
      //var dDate = new Date(); res.header("Date",dDate.toString()); res.send(404);
      error_msg(404,"NoSuchFile","File does not exists on Disk",resp);
      resp.resp_end();
      return;
    }
    return;
  }
  var esp_name = filename.replace(/\//g,"$_$");
  fs.unlink(fdir_path+"/"+esp_name, function (err) {
    if (err) { winston.log('error',+(new Date())+" - Deleting file "+err); if(resp !== null) {error_msg(500,"InternalError",err,resp); resp.resp_end();  resp = null; } }
    fs.rmdir(fdir_path, function(err) {
      if (resp !== null) {
        //resp.writeHeader(204,common_header()); resp.end();
        resp.resp_code = 204;
        var header = common_header();
        delete header["content-type"];
        resp.resp_header = header;
        resp.resp_end();
      }
    });
  });
};

FS_blob.prototype.copy_file = function (dest_c,dest_f,container,filename,requ,resp,fb)
{
  var c_path = this.root_path + "/" + container;
  if (!Path.existsSync(c_path)) {
    error_msg(404,"NoSuchBucket","No such container",resp);resp.resp_end();return;
  }
  var file_path = c_path + "/" + filename; //complete representation: /container/filename
  var md5_name = crypto.createHash('md5');
  //md5_name.update(file_path);
  md5_name.update(filename); //de-couple from root and container paths
  var name_digest =  md5_name.digest('hex');
  winston.log('debug',(new Date()) + " - copy: the md5 hash for "+filename+" is "+name_digest);
  var name_dig_pre = name_digest.substr(0,PREFIX_LENGTH);
  var fdir_path = c_path + "/" + name_dig_pre; //actual dir for the file  /container/hashprefix/
  if (!Path.existsSync(fdir_path)) { //check such folder
    error_msg(404,"NoSuchFile","No such file",resp);resp.resp_end();return;
  }
  var esp_name = filename.replace(/\//g,"$_$");
  var file_size = fs.statSync(fdir_path+"/"+esp_name).size;
  if (file_size === undefined) {
    error_msg(404,"NoSuchFile","No such file",resp);resp.resp_end(); return;
  }
  var etag_match=null, etag_none_match=null, date_modified=null, date_unmodified=null;
  var meta_dir=null;
  if (true){
    var keys = Object.keys(requ.headers);
    for (var idx = 0; idx < keys.length; idx++)
    {
      if (keys[idx].match(/^x-amz-copy-source-if-match$/i))
      { etag_match = requ.headers[keys[idx]]; }
      else if (keys[idx].match(/^x-amz-copy-source-if-none-match$/i))
      { etag_none_match = requ.headers[keys[idx]]; }
      else if (keys[idx].match(/^x-amz-copy-source-if-unmodified-since$/i))
      { date_unmodified = requ.headers[keys[idx]]; }
      else if (keys[idx].match(/^x-amz-copy-source-if-modified-since$/i))
      { date_modified = requ.headers[keys[idx]]; }
      else if (keys[idx].match(/^x-amz-metadata-directive$/i))
      { meta_dir = requ.headers[keys[idx]]; }
    }
  }
  if (meta_dir === null) { meta_dir = 'COPY'; }
  else { meta_dir = meta_dir.toUpperCase(); }
  if ((meta_dir !== 'COPY' && meta_dir !== 'REPLACE') ||
      (etag_match && date_modified) ||
      (etag_none_match && date_unmodified) ||
      (date_modified && date_unmodified)  ||
      (etag_match && etag_none_match) ) {
    error_msg(400,"NotImplemented","The headers are not supported",resp);
    resp.resp_end(); return;
  }
  //read meta here
  this.MDS.collection(container,{safe:true},function(err,coll) {
    if (err||!coll) { error_msg(404,"NoSuchBucket",err,resp); resp.resp_end(); return; }
    coll.findOne({"vblob_file_name":filename}, function (err, obj) {
      if (err||!obj) {
        error_msg(404,"NoSuchFile",err,resp); resp.resp_end(); return;
      }
      if (file_size !== obj.vblob_file_size) {
        error_msg(500,"InternalError","file corrupted",resp); resp.resp_end(); return;
      }
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
        error_msg(412,"PreconditionFailed","At least one of the preconditions you specified did not hold.",resp); resp.resp_end(); return;
      }
      var keys,keys2;  var idx; //supress warning
      if (dest_c !== container || dest_f !== filename) {
        var st = fs.createReadStream(fdir_path+"/"+esp_name);
        st.on('error',function(err) { throw err;});
        requ.headers.vblob_create_time = obj.vblob_create_time;
        keys = Object.keys(obj);
        if (meta_dir === 'COPY') {
          //delete request meta headers, add object's
          keys2 = Object.keys(requ.headers);
          for (var idx2 = 0; idx2 < keys2.length; idx2++) {
            if (keys2[idx2].match(/^x-amz-meta-/i))
            { delete requ.headers[keys2[idx2]]; }
          }
          for (idx = 0; idx < keys.length; idx++) {
            var key = keys[idx];
            if (key.match(/^vblob_meta_/i)) {
              var key2 = key.replace(/^vblob_meta_/i,"x-amz-meta-");
              if (requ.headers[key2]) { continue; }
              requ.headers[key2] = obj[key];
            }
          }
        }
        st.headers = requ.headers;
        fb.create_file(dest_c,dest_f,st,resp,fb);
      } else {//copy self to self, only update meta, replace meta only, use only meta in header
        if (meta_dir === 'COPY') {
          error_msg(400,"NotImplemented","The headers are not supported",resp);
          resp.resp_end(); return;
        }
        var opts = {"vblob_file_etag":obj.vblob_file_etag,"vblob_file_size":file_size};
        keys = Object.keys(obj);
        //overwrite here
        keys = Object.keys(requ.headers);
        for (idx = 0; idx < keys.length; idx++) {
          var obj_key = keys[idx];
          if (obj_key.match(/^x-amz-meta-/i)) {
            var key3 = obj_key.replace(/^x-amz-meta-/i,"vblob_meta_");
            opts[key3] = requ.headers[obj_key];
          }
        }
        fb.create_file_meta(dest_c,dest_f,opts,resp,fb,true);
      }
    });
  });
};

FS_blob.prototype.read_file = function (container, filename, range,requ,resp,verb)
{
  var c_path = this.root_path + "/" + container;
  if (!Path.existsSync(c_path)) {
    error_msg(404,"NoSuchBucket","No such container",resp);resp.resp_end();return;
  }
  var file_path = c_path + "/" + filename; //complete representation: /container/filename
  var md5_name = crypto.createHash('md5');
  //md5_name.update(file_path);
  md5_name.update(filename); //de-couple from root and container paths
  var name_digest =  md5_name.digest('hex');
  winston.log('debug',(new Date())+" - read: the md5 hash for "+filename+" is "+name_digest);
  var name_dig_pre = name_digest.substr(0,PREFIX_LENGTH);
  var fdir_path = c_path + "/" + name_dig_pre; //actual dir for the file  /container/hashprefix/
  if (!Path.existsSync(fdir_path)) { //check such folder
    error_msg(404,"NoSuchFile","No such file",resp);resp.resp_end();return;
  }
  var esp_name = filename.replace(/\//g,"$_$");
  var file_size = fs.statSync(fdir_path+"/"+esp_name).size;
  if (file_size === undefined) {
    error_msg(404,"NoSuchFile","No such file",resp);resp.resp_end(); return;
  }
  var etag_match=null, etag_none_match=null, date_modified=null, date_unmodified=null;
  if (true){
    var keys = Object.keys(requ.headers);
    for (var idx = 0; idx < keys.length; idx++)
    {
      if (keys[idx].match(/^if-match$/i))
      { etag_match = requ.headers[keys[idx]]; }
      else if (keys[idx].match(/^if-none-match$/i))
      { etag_none_match = requ.headers[keys[idx]]; }
      else if (keys[idx].match(/^if-unmodified-since$/i))
      { date_unmodified = requ.headers[keys[idx]]; }
      else if (keys[idx].match(/^if-modified-since$/i))
      { date_modified = requ.headers[keys[idx]]; }
    }
  }
  //read meta here
  this.MDS.collection(container,{safe:true},function(err,coll) {
    if (err||!coll) { error_msg(404,"NoSuchBucket",err,resp); resp.resp_end(); return; }
    coll.findOne({"vblob_file_name":filename}, function (err, obj) {
      if (err||!obj) {
        error_msg(404,"NoSuchFile",err,resp); resp.resp_end(); return;
      }
      var header = common_header();
      if (file_size !== obj.vblob_file_size) {
        error_msg(500,"InternalError","file corrupted",resp); resp.resp_end(); return;
      }
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
        error_msg(412,"PreconditionFailed","At least one of the preconditions you specified did not hold.",resp); resp.resp_end(); return;
      }
      //304
      if (modified_since === false ||
          etag_none_match && etag_none_match === obj.vblob_file_etag)
      {
        error_msg(304,'NotModified','The object is not modified',resp);
        resp.resp_end(); return;
      }
      header["content-type"] = obj["content-type"] ? obj["content-type"] :  "binary/octet-stream";
      header["Content-Length"] = obj.vblob_file_size;
      header["Last-Modified"] = obj.vblob_update_time;
      header.ETag = obj.vblob_file_etag;
      if (true) {
        var keys = Object.keys(obj);
        for (var idx = 0; idx < keys.length; idx++) {
          var obj_key = keys[idx];
          if (obj_key.match(/^vblob_meta_/)) {
            var sub_key = obj_key.substr(11);
            sub_key = "x-amz-meta-" + sub_key;
            header[sub_key] = obj[obj_key];
          }
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
        resp.resp_code = 206; resp.resp_header = header;
        if (verb==="get") {
          st = fs.createReadStream(fdir_path+"/"+esp_name, range);
          //st.pipe(resp);
          st.on('data',function(chunk) {
            if (resp.client_closed === true)  { st.destroy(); resp.resp_end(); return; }
            resp.resp_handler(chunk);
          });
          st.on('end',function() { resp.resp_end(); });
        } else { resp.resp_end(); }
      } else {
        resp.resp_code = 200; resp.resp_header = header;
        //resp.writeHeader(200,header);
        if (verb==="get") {
          st = fs.createReadStream(fdir_path+"/"+esp_name);
          st.on('error',function(err) { throw err;});
          //st.pipe(resp);
          st.on('data',function(chunk) {
            if (resp.client_closed === true)  { st.destroy(); resp.resp_end(); return; }
            resp.resp_handler(chunk);
          });
          st.on('end',function() { resp.resp_end(); });
        }  else { resp.resp_end(); }
      }
    });
  });
};

FS_blob.prototype.list_containers = function()
{
  return  fs.readdirSync(this.root_path);
};

//sequentially issue queries to obtain max-keys number of files/folders
FS_blob.prototype.list_container = function (container, opt, resp)
{
  //TODO: handling marker, prefix, delimiter, virtual folder
  var pre_marker = opt.marker;
  if (!opt["max-keys"] || parseInt(opt["max-keys"],10) > MAX_LIST_LENGTH) { opt["max-keys"] = MAX_LIST_LENGTH; }
  var pre_maxkey=  opt["max-keys"];
  this.MDS.collection(container,{safe:true},function(err,coll) {
    if (err) {  winston.log('error',(new Date())+" - In listing container "+container+" "+err); error_msg(404,"NoSuchBucket",err,resp); resp.resp_end(); return; }
    var evt = new events.EventEmitter();
    var res_array = []; //regular file
    var res_array2 = []; //folder
    evt.on("Next Query", function (opts) {
      if (resp.client_closed === true) { winston.log('warn',(new Date())+' - client disconnected'); resp.resp_end(); return; }
      winston.log('debug',(new Date())+" - Next Query");
      var cond = {$exists:true};
      if (opts.prefix) { cond.$regex = "^"+opts.prefix; }
      if (opts.marker) { cond.$gt = opts.marker; }
      var options = {sort:[['vblob_file_name','asc']]};
      if (opts["max-keys"]) { opts["max-keys"] = parseInt(opts["max-keys"],10); options.limit = opts["max-keys"]; }
      coll.find({vblob_file_name:cond},{/*'vblob_file_name':true*/},options, function (err, cursor) {
        if (err) { winston.log('error',(new Date())+" - Error retrieving data from db "+err); error_msg(500,"InternalError",err,resp); resp.resp_end(); return; }
        if (cursor === null || cursor === undefined) {evt.emit("Finish List");}
        else if (opts.delimiter) { evt.emit("Next Object", opts, cursor); }
        else {
          cursor.each( function(err,doc) {//optimization for queries without delimiter
            if (resp.client_closed === true) { winston.log('warn',(new Date())+' - client disconnected'); cursor.close(); resp.resp_end(); return; }
            if (doc)
            { res_array.push({"Key":doc.vblob_file_name, "LastModified":doc.vblob_update_time, "ETag":'"'+doc.vblob_file_etag+'"', "Size":doc.vblob_file_size, "Owner":{}, "StorageClass":"STANDARD"});
              if (opts["max-keys"]) { opts["max-keys"] = opts["max-keys"] - 1; }
            }
            else { evt.emit("Finish List"); }
          });
        }
      });
    });
    evt.on("Next Object", function (opts,cursor) {
      cursor.nextObject( function (err, doc) {
        if (err)  { winston.log('error',(new Date())+" - Error retrieving data from db "+err); error_msg(500,"InternalError",err,resp); resp.resp_end(); return; }
        if (resp.client_closed === true) { winston.log('warn',(new Date())+' - client disconnected'); cursor.close(); resp.resp_end(); return; }
        if (doc === null || doc === undefined) {
          if (cursor.totalNumberOfRecords > 0)
          { evt.emit("Next Query", opts); }
          else { evt.emit("Finish List"); }
        } else {
          opts.marker = doc.vblob_file_name;
          if (opts["max-keys"]) { opts["max-keys"] = opts["max-keys"] - 1; }
          var str1;
          if (opts.prefix) { str1 = doc.vblob_file_name.substring(opts.prefix.length);}
          else { str1 = doc.vblob_file_name; }
          var pos;
          if (str1 === "") { res_array.push({"Key":doc.vblob_file_name, "LastModified":doc.vblob_update_time, "ETag":'"'+doc.vblob_file_etag+'"', "Size":doc.vblob_file_size, "Owner":{}, "StorageClass":"STANDARD"}); }
          else {
            //delimiter
            //str1 = doc.vblob_file_name;
            pos = str1.search(opts.delimiter);
            winston.log('debug',(new Date())+" - found delimiter "+opts.delimiter+" at position "+pos);
            if (pos === -1)
            {
              //not found
              res_array.push({"Key":doc.vblob_file_name, "LastModified":doc.vblob_update_time, "ETag":'"'+doc.vblob_file_etag+'"', "Size":doc.vblob_file_size, "Owner":{}, "StorageClass":"STANDARD"});
              if (opts["max-keys"] !== undefined &&  opts["max-keys"] <= 0) {cursor.close(); evt.emit("Finish List");}
              else { evt.emit("Next Object", opts,cursor); }
            } else
            {
              var len = 0;
              if (opts.prefix) { len = opts.prefix.length; }
              var str2 = doc.vblob_file_name.substring(0,len+pos);
              opts.marker = str2+String.fromCharCode(doc.vblob_file_name.charCodeAt(len+pos)+1);
              winston.log('debug',(new Date())+" - Next Marker "+opts.marker+" and len "+len);
              res_array2.push({"Prefix":str2+opts.delimiter}); //another array for folder
              cursor.close();
              if (opts["max-keys"] !== undefined &&  opts["max-keys"] <= 0) { evt.emit("Finish List"); }
              else { evt.emit("Next Query", opts); }
            }
          }
        }
      });
    });
    evt.on("Finish List", function () {
      resp.resp_code = 200; resp.resp_header = common_header();
      var res_json = {};
      res_json.Name = container;
      res_json.Prefix = opt.prefix?opt.prefix:{};
      res_json.Marker = pre_marker?pre_marker:{};
      res_json.MaxKeys = ""+pre_maxkey;
      if (opt.delimiter) { res_json.Delimiter = opt.delimiter; }
      if (opt["max-keys"] <= 0) { res_json.IsTruncated = 'true'; }
      else { res_json.IsTruncated = 'false'; }
      if (res_array.length > 0) {res_json.Contents =  res_array; } //files
      if (res_array2.length > 0) { res_json.CommonPrefixes = res_array2;} //folder
      resp.resp_body = {"ListBucketResult": res_json};
      resp.resp_end();
    });
    evt.emit("Next Query", opt);
  });
};

function render_containers(dirs,resp,fb)
{
  var dates = new Array(dirs.length);
  var evt = new events.EventEmitter();
  var counter = dirs.length;
  evt.on("Get Date",function (dir_name, idx) {
    fb.MDS.collection(dir_name, {safe:true},function(err,col) {
      if (err) {
        winston.log('error',(new Date())+" - retreiving meta "+err); /*error_msg(500,"InternalError",err,resp); resp.resp_end();*/
        dates[idx] = null;
        counter--; if (counter === 0) { evt.emit("Start Render"); }
        return;
      } //skip this folder
      col.findOne({"vblob_container_name" : dir_name},  function (err, item) {
        if (err) { error_msg(500,"InternalError",err,resp); resp.resp_end(); return;   }
        dates[idx] = item.vblob_create_time;
        counter--; if (counter === 0) { evt.emit("Start Render"); }
      });
    });
  });
  evt.on("Start Render", function () {
    resp.resp_code = 200;
    resp.resp_header = common_header();
    var output = "";
    output += '{"ListAllMyBucketsResult":';
    output += '{"Buckets":{"Owner":{}';//empty owner information
    output += ',"Bucket":[';
    for (var i = 0,j=0; i < dirs.length; i++) {
      if (dates[i] === null)  { continue; }
      if (j > 0) { output += ','; }
      j = j+1;
      output += '{';
      output += ('"Name":"'+dirs[i]+'"');
      output += (',"CreationDate":"'+dates[i]+'"');
      output += ('}');
    }
    output += (']}}}');
    resp.resp_body = JSON.parse(output);
    resp.resp_end();
  });
  if (dirs.length === 0) { evt.emit("Start Render"); }
  for (var i = 0; i < dirs.length; i++)
  { evt.emit("Get Date",dirs[i],i); }
}

//=======================================================
var FS_Driver = function(root_path, mds_cred,callback) {
  var this1 = this;
  var client = new FS_blob(root_path,mds_cred, function(obj) {
    this1.client = obj;
    if (callback) { callback(this1); }
  }); //supress warning
};

FS_Driver.prototype.list_buckets = function (requ,resp) {
  var dirs = this.client.list_containers();
  render_containers(dirs,resp,this.client);
};

FS_Driver.prototype.list_bucket = function(container,option,resp) {
  this.client.list_container(container,option,resp);
};

FS_Driver.prototype.read_file = function(container,filename,range,verb,resp,requ){
  var range1 = null;
  if (range) {
    range1 = range;
    range1 = range1.substr(6);
    var m = range1.match(/^([0-9]*)-([0-9]*)$/);
    if (m[1]===m[2]&& m[1]==='') { range1=null; }
    else {
      range1 = {};
      if (m[1] !== '') { range1.start = parseInt(m[1],10); }
      if (m[2] !== '') { range1.end = parseInt(m[2],10); }
    }
    winston.log('debug',(new Date())+" - Final range: "+util.inspect(range1));
  }
  this.client.read_file(container, filename, range1,requ,resp,verb);
};

FS_Driver.prototype.create_file = function(container,filename,requ,resp) {
  this.client.create_file(container,filename,requ,resp,this.client);
};

FS_Driver.prototype.copy_file = function(dest_c, dest_f, src_c,src_f,requ,resp)
{
  this.client.copy_file(dest_c,dest_f,src_c,src_f,requ,resp,this.client);
};

FS_Driver.prototype.create_bucket = function(container,resp) {
  this.client.create_container_meta(container,resp,this.client);
};

FS_Driver.prototype.delete_file = function(container,filename,resp) {
  this.client.delete_file_meta(container,filename,resp,this.client);
};

FS_Driver.prototype.delete_bucket = function(container,resp) {
  this.client.delete_container(container,resp,this.client);
};

FS_Driver.prototype.pingDest = function(callback) {
  callback(null);
};

module.exports.createDriver = function(option,callback) {
  return new FS_Driver(option.root, option.mds, callback);
};
