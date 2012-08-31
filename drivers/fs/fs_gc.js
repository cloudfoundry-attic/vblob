/*
Copyright (c) 2011 VMware, Inc.
*/
var fs = require('fs');
var events = require("events");
var exec = require('child_process').exec;

var argv = process.argv;

var gc_timestamp = null;
var tmp_path = '/tmp';
for (var ii = 0; ii < argv.length; ii++) {
  if (argv[ii] === '--tmp') {
    if (ii+1 < argv.length) {
      tmp_path = argv[ii+1];
    }
    break;
  }
}
for (var ii = 0; ii < argv.length; ii++) {
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
    break;
  }
}
var BATCH_NUM = 1;
var root_path = argv[2];
var PREFIX_LENGTH = 2;
var MAX_TRIES = 5;
var containers = fs.readdirSync(root_path);
console.log(containers);
var buck = new events.EventEmitter();
buck.on('gc',function(buck_idx) {
  try {
    var trashes = fs.readdirSync(root_path + "/" + containers[buck_idx] + "/~gc");
    var trash_dir = root_path + "/" + containers[buck_idx] + "/~gc";
    var enum_delta = {};
    for (var nIdx1=0; nIdx1<trashes.length; nIdx1++) {
      var fileversion = trashes[nIdx1];
      try {
        var prefix1 = fileversion.substr(0,PREFIX_LENGTH), prefix2 = fileversion.substr(PREFIX_LENGTH,PREFIX_LENGTH);
        var ver_path = root_path + "/" + containers[buck_idx] + "/versions/" + prefix1 + "/" + prefix2+"/"+fileversion;
        var obj = JSON.parse(fs.readFileSync(ver_path));
        enum_delta[obj.vblob_file_name] = 1;
      } catch (err) {
        //missing version file...
        fileversion = fileversion.substr(0,fileversion.lastIndexOf('-'));  //remove rand2
        fileversion = fileversion.substr(0,fileversion.lastIndexOf('-')); //remove rand1
        fileversion = fileversion.substr(0,fileversion.lastIndexOf('-')); //remove ts
        enum_delta[fileversion] = 0;
      }
    }
    var enum_dir = root_path + "/" + containers[buck_idx] + "/~enum";
    var enum_delta_file = enum_dir + "/delta-"+new Date().valueOf()+"-"+Math.floor(Math.random()*10000)+"-"+Math.floor(Math.random()*10000);
    fs.writeFileSync(enum_delta_file, JSON.stringify(enum_delta));

    var evt = new events.EventEmitter();
    evt.Container = containers[buck_idx];
    evt.Batch = BATCH_NUM; evt.Counter = 0;
    evt.on('next',function(idx) {
      var filename = trashes[idx]; //hash-pref-suff-ts-rand1-rand
      //console.log(filename);
      if (gc_timestamp) { //specified timestamp, check stats here
        var stats = null;
        try { stats = fs.lstatSync(trash_dir+"/"+filename); }
        catch (err) {}
        if (!stats || new Date(stats.mtime).valueOf() > gc_timestamp) {
          evt.Counter++; evt.Batch--;
          if (evt.Batch === 0) {  evt.Batch = BATCH_NUM; evt.emit('nextbatch'); }
          return;
        }
      }
      fs.unlink(trash_dir+"/"+filename,function() {} );
      filename = filename.substr(0,filename.lastIndexOf('-'));  //remove rand2
      filename = filename.substr(0,filename.lastIndexOf('-')); //remove rand1
      filename = filename.substr(0,filename.lastIndexOf('-')); //remove ts
      var prefix1 = filename.substr(0,PREFIX_LENGTH), prefix2 = filename.substr(PREFIX_LENGTH,PREFIX_LENGTH);
      var fdir_path = root_path + "/" + evt.Container + "/versions/" + prefix1 + "/" + prefix2;
      var temp_file = tmp_path+"/gctmp-"+new Date().valueOf()+"-"+Math.floor(Math.random()*10000)+"-"+Math.floor(Math.random()*10000);
      var child = exec('find '+ fdir_path +"/ -type f -name \""+filename+"-*\" >"+temp_file,
        function (error, stdout, stderr) {
          if (!error) {
            var versions = fs.readFileSync(temp_file).toString().split("\n");
            var try_cnt=0;
            while (try_cnt<MAX_TRIES) { try {fs.unlinkSync(temp_file); } catch (e) {}; try_cnt++; }
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
        }//end of exec callback
      );
    });
    evt.on('nextbatch',function() {
      console.log('counter ' + evt.Counter);
      if (evt.Counter + BATCH_NUM > trashes.length) evt.Batch = trashes.length - evt.Counter;
      for (var i = evt.Counter; i < trashes.length && i < evt.Counter + BATCH_NUM; i++) {
        evt.emit('next', i);
      }
      if (evt.Counter >= trashes.length) {
        enum_delta_file = enum_dir + "/delta-"+new Date().valueOf()+"-"+Math.floor(Math.random()*10000)+"-"+Math.floor(Math.random()*10000);
        fs.writeFileSync(enum_delta_file, JSON.stringify(enum_delta));
      }
    });
    evt.emit('nextbatch');
  } catch (err) {
    console.error(err);
  }
});//end of on gc event
for (var i = 0; i < containers.length; i++)
  buck.emit('gc',i);
