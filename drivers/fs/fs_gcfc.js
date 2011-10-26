/*
Copyright (c) 2011 VMware, Inc.
*/
var fs = require('fs');
var events = require("events");
var exec = require('child_process').exec;

var argv = process.argv;

var BATCH_NUM = 1;
var root_path = argv[3];
var PREFIX_LENGTH = 2;
var gc_hash = JSON.parse(fs.readFileSync(argv[2]));
console.log(buckets);
var buck = new events.EventEmitter();
var buckets = Object.keys(gc_hash); //first level key: bucket_name
buck.on('gc',function(buck_idx) {
  try {
    var trashes = Object.keys(gc_hash[buckets[buck_idx]]); //second level key: file fingerprint
    var trash_dir = root_path + "/" + buckets[buck_idx] + "/~gc";
    var evt = new events.EventEmitter();
    evt.Bucket = buckets[i];
    evt.Batch = BATCH_NUM; evt.Counter = 0;
    evt.on('next',function(idx) {
      var filename = trashes[idx]; //hash-pref-suff-ts-rand1-rand
      //console.log(filename);
      for (var xx = 0; xx < gc_hash[buckets[buck_idx]][filename].length; xx++)
        fs.unlink(trash_dir+"/"+gc_hash[buckets[buck_idx]][filename][xx], function(err) {} );
      var prefix1 = filename.substr(0,PREFIX_LENGTH), prefix2 = filename.substr(PREFIX_LENGTH,PREFIX_LENGTH);
      var fdir_path = root_path + "/" + evt.Bucket + "/versions/" + prefix1 + "/" + prefix2;
      var temp_file = "/tmp/"+new Date().valueOf()+"-"+Math.floor(Math.random()*10000)+"-"+Math.floor(Math.random()*10000);
      var child = exec('find '+ fdir_path +"/ -type f -name \""+filename+"-*\" >"+temp_file,
        function (error, stdout, stderr) {
          if (!error) {
            var versions = fs.readFileSync(temp_file).toString().split("\n");
            fs.unlink(temp_file,function() {});
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
                      fs.unlink(obj.vblob_file_path,function() {} );
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
            console.log('error!' + error);
            evt.Counter++; evt.Batch--;
            if (evt.Batch === 0) {  evt.Batch = BATCH_NUM; evt.emit('nextbatch'); }
          }
        }
      ); //end of exec callback
    }); //end of on next
    evt.on('nextbatch',function() {
      console.log('counter ' + evt.Counter);
      if (evt.Counter + BATCH_NUM > trashes.length) evt.Batch = trashes.length - evt.Counter;
      for (var i = evt.Counter; i < trashes.length && i < evt.Counter + BATCH_NUM; i++) {
        evt.emit('next', i);
      }
    });
    evt.emit('nextbatch');
  } catch (err) {
    console.log(err);
  }
});//end of on gc event
for (var i = 0; i < buckets.length; i++)
  buck.emit('gc',i);
