/*!
 * knox
 * Copyright(c) 2010 LearnBoost <dev@learnboost.com>
 * MIT Licensed
 */

/**
 * Client is the main export.
 */

module.exports = require('./client');

/**
 * Library version.
 * 
 * @type String
 */

module.exports.version = '0.0.5';

/**
 * Expose utilities.
 * 
 * @type Object
 */

module.exports.utils = require('./utils');

/**
 * Expose auth utils.
 *
 * @type Object
 */

module.exports.auth = require('./auth');
