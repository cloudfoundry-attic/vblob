/*
Copyright (c) 2011-2012 VMware, Inc.
*/
var fs = require('fs');
var events = require("events");
var exec = require('child_process').exec;
var crypto = require('crypto');

//identical to the ones in blob_fs
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

var argv = process.argv;
var root_path = argv[2];
var buck = new events.EventEmitter();
var containers = fs.readdirSync(root_path);
console.log(containers);
buck.on('compact',function(buck_idx) {
  try {
    var enum_dir = root_path + "/" + containers[buck_idx] + "/~enum";
    var meta_dir = root_path + "/" + containers[buck_idx] + "/meta";
    var enum_base = {};
    var _used_quota = 0;
    try {
      enum_base = JSON.parse(fs.readFileSync(enum_dir+"/base"));
      var obj_q = JSON.parse(fs.readFileSync(enum_dir+"/quota"));
      _used_quota = parseInt(obj_q.storage,10);
    } catch (e) {
    }
    var ivt_enum = {};
    var keys1 = Object.keys(enum_base);
    for (var nIdx1=0; nIdx1<keys1.length; nIdx1++) {
      var ver1 = enum_base[keys1[nIdx1]].version;
      ver1 = ver1.substr(0,ver1.lastIndexOf('-'));  //remove rand2
      ver1 = ver1.substr(0,ver1.lastIndexOf('-')); //remove rand1
      ver1 = ver1.substr(0,ver1.lastIndexOf('-')); //remove ts
      ivt_enum[ver1] = keys1[nIdx1];
    }
    var temp_file = "/tmp/"+new Date().valueOf()+"-"+Math.floor(Math.random()*10000)+"-"+Math.floor(Math.random()*10000);
    var child = exec('find '+ enum_dir +"/ -type f -name \"delta-*\" >"+temp_file,
      function (error, stdout, stderr) {
        if (!error) {
          var versions = fs.readFileSync(temp_file).toString().split("\n");
          versions = versions.sort(); //by time stamp
          fs.unlink(temp_file,function() {});
          if (versions.length === 0 || versions.length === 1 && versions[0] === '') return;
          var evt2 = new events.EventEmitter();
          evt2.counter = versions.length;
          evt2.on('next',function(idx2) {
            var file1 = versions[idx2];
              evt2.counter--;
              fs.readFile(file1,function(err2,data) {
                if (!err2) {
                  var obj = JSON.parse(data);
                  var keys = Object.keys(obj);
                  for (var i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    if (obj[key] == 0) {
                      if (ivt_enum[key]) key = ivt_enum[key]; else continue; //look up file name by fingerprint
                    }
                    //CALC FINGERPRINT AND READ META
                    var filename = get_key_fingerprint(key);
                    ivt_enum[filename] = key;
                    var pref1 = filename.substr(0,2), pref2 = filename.substr(2,2);
                    try {
                      var data2 = fs.readFileSync(meta_dir+"/"+pref1+"/"+pref2+"/"+filename);
                      var obj2 = JSON.parse(data2);
                      var old_size = enum_base[key]?enum_base[key].size:0;
                      enum_base[key] = {};
                      enum_base[key].size = obj2.vblob_file_size; 
                      enum_base[key].etag = obj2.vblob_file_etag;
                      enum_base[key].lastmodified = obj2.vblob_update_time;
                      enum_base[key].version = obj2.vblob_file_version;
                      _used_quota += enum_base[key].size - old_size;
                    } catch (e) {
                      if (enum_base[key]) {
                        _used_quota -= enum_base[key].size;
                        delete enum_base[key];
                      }
                    }
                  }
                } else {
                  //?
                }
                //UPDATE BASE
                fs.unlinkSync(enum_dir+"/base");
                fs.writeFileSync(enum_dir+"/base",JSON.stringify(enum_base));
                try {
                  fs.unlinkSync(enum_dir+"/quota");
                } catch (e) {}
                var obj_cnt = Object.keys(enum_base).length;
                fs.writeFileSync(enum_dir+"/quota","{\"storage\":"+_used_quota+",\"count\":"+obj_cnt+"}");
                fs.unlink(file1,function() {} );
                if (evt2.counter > 0) evt2.emit('next',idx2+1); 
              });
          }); //end of next
          evt2.emit('next',0);
        } else {
          fs.unlink(temp_file,function() {});
          console.error('error!' + error);
        }
      }
    ); //end of exec callback
  } catch (err) {
    console.error(err);
  }
});//end of on compact event
for (var i = 0; i < containers.length; i++)
  buck.emit('compact',i);
