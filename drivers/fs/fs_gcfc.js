/*
Copyright (c) 2011 VMware, Inc.
*/
var fs = require('fs');
var events = require("events");
var exec = require('child_process').exec;

var argv = process.argv;

var BATCH_NUM = 1;
var root_path = argv[3];
var tmp_path = '/tmp';
for (var ii = 0; ii < argv.length; ii++) {
  if (argv[ii] === '--tmp') {
    if (ii+1 < argv.length) {
      tmp_path = argv[ii+1];
    }
    break;
  }
}
var PREFIX_LENGTH = 2;
var MAX_TRIES = 5;
var gc_hash = JSON.parse(fs.readFileSync(argv[2]));
console.log(containers);
var buck = new events.EventEmitter();
var containers = Object.keys(gc_hash); //first level key: container_name
buck.on('gc',function(buck_idx) {
  try {
    var trashes = Object.keys(gc_hash[containers[buck_idx]]); //second level key: file fingerprint
    var trash_dir = root_path + "/" + containers[buck_idx] + "/~gc";
    var enum_dir = root_path + "/" + containers[buck_idx] + "/~enum";
    fs.mkdir(enum_dir,"0775", function(err) {} );
    var enum_delta = {};

    for (var j = 0; j < trashes.length; j++)
      enum_delta[gc_hash[containers[buck_idx]][trashes[j]].fn] = 1;
    //WRITE ENUM DELTA
    var enum_delta_file = enum_dir + "/delta-"+new Date().valueOf()+"-"+Math.floor(Math.random()*10000)+"-"+Math.floor(Math.random()*10000);
    fs.writeFileSync(enum_delta_file, JSON.stringify(enum_delta));
    enum_delta = null;

    var evt = new events.EventEmitter();
    evt.Container = containers[i];
    evt.Batch = BATCH_NUM; evt.Counter = 0;
    evt.on('next',function(idx) {
      var filename = trashes[idx]; //hash-pref-suff-ts-rand1-rand
      //console.log(filename);
      for (var xx = 0; xx < gc_hash[containers[buck_idx]][filename].ver.length; xx++)
        fs.unlink(trash_dir+"/"+gc_hash[containers[buck_idx]][filename].ver[xx], function(err) {} );
      var prefix1 = filename.substr(0,PREFIX_LENGTH), prefix2 = filename.substr(PREFIX_LENGTH,PREFIX_LENGTH);
      var fdir_path = root_path + "/" + evt.Container + "/versions/" + prefix1 + "/" + prefix2;
      var temp_file = tmp_path+"/gcfctmp"+new Date().valueOf()+"-"+Math.floor(Math.random()*10000)+"-"+Math.floor(Math.random()*10000);
      var child = exec('find '+ fdir_path +"/ -type f -name \""+filename+"-*\" >"+temp_file,
        function (error, stdout, stderr) {
          if (!error) {
            var versions = fs.readFileSync(temp_file).toString().split("\n");
            var try_cnt=0;
            while (try_cnt<MAX_TRIES) { try { fs.unlinkSync(temp_file); } catch (e) {}; try_cnt++; }
            var evt2 = new events.EventEmitter();
            evt2.counter = versions.length;
            evt2.on('next',function(idx2) {
              var file1 = versions[idx2];
              fs.stat(file1,function(err,stats) {
                evt2.counter--;
                if (!err && stats.nlink <= 1) {
                  fs.readFile(file1,function(err2,data) {
                    if (!err2) {
                      var obj = JSON.parse(data);
                      fs.unlink(root_path+"/"+evt.Container+"/"+obj.vblob_file_path,function() {} );
                    } else {
                      //??
                    }
                    fs.unlink(file1,function() {} );
                    if (evt2.counter > 0) evt2.emit('next',idx2+1); else
                    if (evt2.counter === 0 && evt.Batch === 0) {
                      evt.Batch = BATCH_NUM; evt.emit('nextbatch');
                    }
                  });
                } else {
                  if (evt2.counter === 0) {
                    evt.Counter++; evt.Batch--;
                    if (evt.Batch === 0) { evt.Batch = BATCH_NUM; evt.emit('nextbatch'); }
                  } else evt2.emit('next',idx2+1);
                }
              });
            });
            evt2.emit('next',0);
          } else {
            fs.unlink(temp_file,function() {});
            console.error('error!' + error);
            evt.Counter++; evt.Batch--;
            if (evt.Batch === 0) {  evt.Batch = BATCH_NUM; evt.emit('nextbatch'); }
          }
        }
      ); //end of exec callback
    }); //end of on next
    evt.on('nextbatch',function() {
      console.log('counter ' + evt.Counter);
      if (evt.Counter + BATCH_NUM > trashes.length) evt.Batch = trashes.length - evt.Counter;
      /*
      if (evt.Counter >= trashes.length) {
        //WRITE ENUM DELTA
        var enum_delta_file = enum_dir + "/delta-"+new Date().valueOf()+"-"+Math.floor(Math.random()*10000)+"-"+Math.floor(Math.random()*10000);
        fs.writeFile(enum_delta_file, JSON.stringify(enum_delta),function(err) {} );
        enum_delta = null;
      }
      */
      for (var i = evt.Counter; i < trashes.length && i < evt.Counter + BATCH_NUM; i++) {
        evt.emit('next', i);
      }
    });
    evt.emit('nextbatch');
  } catch (err) {
    console.error(err);
  }
});//end of on gc event
for (var i = 0; i < containers.length; i++)
  buck.emit('gc',i);
