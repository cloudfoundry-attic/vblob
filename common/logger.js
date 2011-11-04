/*
Copyright (c) 2011 VMware, Inc.
*/
//logger type is a string specifying the logger type name;  logger_file is a string pointing the where the log should be written
//logger_file not defined means writing to stdout
var Path = require('path');
function Logger(logger_type, logger_file)
{
  var self1 = this;
  if (logger_type === 'winston') { //for now winston is the only type supported
    this.logger_type = 'winston';
    this.logger = require('winston');
    if (logger_file) {
      this.logger.add(this.logger.transports.File, {filename:logger_file}).remove(this.logger.transports.Console);
      setInterval(function() {
        if (Path.existsSync(logger_file) === false)
        {
          self1.logger.remove(self1.logger.transports.File);
          self1.logger.add(self1.logger.transports.File, {filename:logger_file});
        }
      }, 5000);
    }
  }
}

Logger.prototype.timed_st = function(st)
{
  return new Date().toUTCString()+' - ' + st;
};

Logger.prototype.info = function(st)
{
  if (this.logger) {
    if (this.logger_type === 'winston') st = this.timed_st(st); // adding time for winston logger
    this.logger.info(st);
  }
};

Logger.prototype.warn = function(st)
{
  if (this.logger) {
    if (this.logger_type === 'winston') st = this.timed_st(st); // adding time for winston logger
    this.logger.warn(st);
  }
};

Logger.prototype.debug = function(st)
{
  if (this.logger) {
    if (this.logger_type === 'winston') st = this.timed_st(st); // adding time for winston logger
    this.logger.debug(st);
  }
};

Logger.prototype.error = function(st)
{
  if (this.logger) {
    if (this.logger_type === 'winston') st = this.timed_st(st); // adding time for winston logger
    this.logger.error(st);
  }
};

module.exports.Logger = Logger;
