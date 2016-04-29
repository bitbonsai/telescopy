"use strict";
const debug = require("debug")("tcopy-util");
const Path = require("path");
const FS = require("fs");
const async = require("async");
const mkdirp = require("mkdirp");
const URL = require("url");
const methods = {};

/**
 * procedure to determin most likely mime type based on behavior or mime-package
 * @param {string} fromHeader
 * @param {string} fromUrl
 * @return {string} mime
 **/
methods.guessMime = function( fromHeader, fromUrl ) {
	debug( "guessingMime", [ fromHeader, fromUrl ] );
	if (fromUrl && fromUrl !== 'application/octet-stream') {	//this has likely determined the filename
		return fromUrl;
	}
	if (fromHeader) return fromHeader;
	return fromUrl;
};

/**
 * url normalization procedure
 * @param {string} url
 * @param {boolean} aggressive
 * @return {string} url
 **/
methods.normalizeUrl = function( url, aggressive ) {
	var parts;
	if (typeof url.length !== 'undefined') {
		parts = URL.parse( url, false, false );
	} else {
		parts = url;
	}
	if (aggressive) {
		parts.pathname = parts.pathname.replace(/([^ -~])|(%[0-9a-z]{2})/ig,'');
	}
	if (parts.hash) parts.hash = '';
	return URL.format( parts );
};

/**
 * symlink creation procedure
 * creates relative symlink based on absolute paths
 * makes sure the parent dirs exist
 * overrides existing symlinks if existing
 * @param {string} from
 * @param {string} to
 **/
methods.createSymlink = function(from, to) {
	debug("create symlink: "+from+" - "+to);
	if (from === to) return;
	let targetDir = Path.dirname( from );
	let path = Path.relative( targetDir, to);
	async.waterfall([
		function(cb){	//check if parent dir exists
			FS.stat( targetDir, function(err,stat){
				if (err) {
					if (err.code === 'ENOENT') {
						cb(null,false);
					} else {
						cb(err);
					}
				} else {
					if (!stat.isDirectory()) {
						cb("is not a directory");
					} else {
						cb(null,true);
					}
				}
			});
		},function(dirExists,cb){	//create parent dir if neccessary
			if (!dirExists) {
				mkdirp(targetDir, cb);
			} else {
				cb(null, targetDir);
			}
		},function(made, cb){		//check if it exists as a link
			FS.readlink( from, function(err, oldTarget){
				if (err) {
					if (err.code === 'ENOENT') {
						cb(null,false);
					} else {
						FS.unlink( from, function(err){
							cb(err,true);
						});
					}
				} else {
					if (oldTarget !== path) {
						FS.unlink( from, function(err){
							cb(err,true);
						});
					} else {
						cb(null,true);
					}
				}
			});
		},function(linkExists,cb){	//create link if neccessary
			if (!linkExists) {
				FS.symlink( path, from, cb );
			} else {
				cb();
			}
		}
	],function(err){
		if (err) {
			debug("unable to create symlink!",from,path,err);
		} else {
			debug("created symlink: "+from+" => "+path);
		}
	});
};


module.exports = methods;