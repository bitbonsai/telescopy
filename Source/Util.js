"use strict";
const debug = require("debug")("tcopy-util");
const Path = require("path");
const FS = require("fs");
const async = require("async");
const mkdirp = require("mkdirp");
const URL = require("url");
const methods = {};

methods.guessMime = function( fromHeader, fromUrl ) {
	debug( "guessingMime", [ fromHeader, fromUrl ] );
	if (fromUrl && fromUrl !== 'application/octet-stream') {
		return fromUrl;
	}
	if (fromHeader) return fromHeader;
	return fromUrl;
};

methods.normalizeUrl = function( url ) {
	let parts = URL.parse( url );
	parts.path = parts.path.trim();
	if (parts.hash) parts.hash = '';
	return URL.format( parts );
};

methods.createSymlink = function(from, to) {
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
			console.log("unable to create symlink!",from,path,err);
		} else {
			debug("created symlink: "+from+" => "+path);
		}
	});
};


module.exports = methods;