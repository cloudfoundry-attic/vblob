/*
Copyright (c) 2011 VMware, Inc.
*/
var fs = require('fs');
var events = require("events");
var exec = require('child_process').exec;

var argv = process.argv;
var force = false;
var gc_timestamp = null;
for (var ii = 0; ii < argv.length; ii++) {
  if (argv[ii] === '--force') { force = true; continue; } //if force, gc every file
  if (argv[ii] === '--ts') {
    if (ii+1 < argv.length) {
      try {
        if (isNaN(gc_timestamp=parseInt(argv[ii+1],10))) throw 'NaN';
      } catch(err) {
        gc_timestamp = new Date().valueOf(); //current time
      }
    } else {
      gc_timestamp = new Date().valueOf(); //the time this is executed
    }
    continue;
  }
}
var BATCH_NUM = 1;
var root_path = argv[2];
var PREFIX_LENGTH = 2;
var MAX_TIMEOUT = 6 * 3600 * 1000; //6 hrs
var containers = fs.readdirSync(root_path);
console.log(containers);
var buck = new events.EventEmitter();
var current_ts = new Date().valueOf();
buck.on('gc',function(buck_idx) {
  try {
    var trashes = fs.readdirSync(root_path + "/" + containers[buck_idx] + "/~tmp");
    var trash_dir = root_path + "/" + containers[buck_idx] + "/~tmp";
    var evt = new events.EventEmitter();
    evt.Container = containers[i];
    evt.Batch = BATCH_NUM; evt.Counter = 0;
    evt.on('next',function(idx) {
      var filename = trashes[idx]; //hash-pref-suff-ts-rand1-rand
      //console.log(filename);
      var prefix1 = filename.substr(0,PREFIX_LENGTH), prefix2 = filename.substr(PREFIX_LENGTH,PREFIX_LENGTH);
      var fdir_path = root_path + "/" + evt.Container + "/blob/" + prefix1 + "/" + prefix2;
      fs.stat(trash_dir+"/"+filename, function(err,stats) {
        if (err) {
          evt.Counter++; evt.Batch--
          if (evt.Batch === 0) {
            evt.Batch = BATCH_NUM; evt.emit('nextbatch');
          }
          return;
        }
        var mtime = new Date(stats.mtime).valueOf();
        if ( !force &&
             (gc_timestamp && gc_timestamp < mtime //created later than the specified timestamp
               || !gc_timestamp && current_ts < mtime + MAX_TIMEOUT) ){
          evt.Counter++; evt.Batch--; //still within a valid window
          if (evt.Batch === 0) {
            evt.Batch = BATCH_NUM; evt.emit('nextbatch');
          }
          return;
        }
        if (stats.nlink <= 2) fs.unlink(fdir_path+"/"+filename,function() {} ); //not an active version
        fs.unlink(trash_dir+"/"+filename,function() {
          evt.Counter++; evt.Batch--
          if (evt.Batch === 0) {
            evt.Batch = BATCH_NUM; evt.emit('nextbatch');
          }
        });
      });
    });
    evt.on('nextbatch',function() {
      console.log('counter ' + evt.Counter);
      if (evt.Counter + BATCH_NUM > trashes.length) evt.Batch = trashes.length - evt.Counter;
      for (var i = evt.Counter; i < trashes.length && i < evt.Counter + BATCH_NUM; i++) {
        evt.emit('next', i);
      }
    });
    evt.emit('nextbatch');
  } catch (err) {
    console.error(err);
  }
});
for (var i = 0; i < containers.length; i++)
  buck.emit('gc',i);
