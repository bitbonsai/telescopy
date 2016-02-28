"use strict";
const LRU = require("lru-cache");
const Path = require("path");
const crypto = require("crypto");
const FS = require("fs");
const debug = require("debug")("tcopy-state");

function ProjectState( project ){
	this.project = project;
	this.tempDir = project.tempDir;
	this.lruLimit = project.lruCache;
	if (this.lruLimit > 0) {
		this.urls = LRU({
			max : this.lruLimit,
			dispose : this._saveToTemp.bind(this)
		});
	} else {
		this.urls = new Map();
	}
	this.tempReadAccess = 0;
	this.tempSaveAccess = 0;
}

ProjectState.prototype._readFromTemp = function (url) {
	debug("readTemp",url);
	this.tempReadAccess += 1;
	let file = Path.join( this.tempDir, getPathFromUrl(url) );
	try {
		let content = FS.readFileSync(file);
		return JSON.parse( content );
	} catch(e){
		return null;
	}
};

ProjectState.prototype._saveToTemp = function (url, obj) {
	debug("saveTemp",url);
	this.tempSaveAccess += 1;
	let file = Path.join( this.tempDir, getPathFromUrl(url) );
	let content = JSON.stringify( obj );
	return FS.writeFileSync( file, content,{ encoding: 'utf8', flags: 'w+' } );
};

ProjectState.prototype.getUrlObj = function ( url ) {
	if (!this.urls.has(url)) {
		let obj;
		if (this.lruLimit > 0) {
			obj = this._readFromTemp( url );
		}
		if (!obj) {
			obj = {
				allowed : false,
				asked : 0,
				skipped : false,
				downloaded : false,
				queued : false
			};
		}
		this.urls.set( url, obj );
	} else {
		debug("readCached",url);
	}
	let obj = this.urls.get( url );
	return obj;
};


ProjectState.prototype.getUrlStats = function(){
	var stats = {
		allowed : 0,
		denied : 0,
		skipped : 0,
		downloaded : 0,
		queued : 0
	};
	if (this.lruLimit > 0) {
		stats.readAccess = this.tempReadAccess;
		stats.writeAccess = this.tempSaveAccess;
	}
	this.urls.forEach(function(obj,url){
		if (obj.allowed === true) stats.allowed += 1;
		else if(obj.asked > 0) stats.denied += 1;
		if (obj.queued) stats.queued += 1;
		else if (obj.skipped) stats.skipped += 1;
		else if (obj.allowed === true) stats.downloaded += 1;
	});
	return stats;
};

ProjectState.prototype.getUrlFilterAnalysis = function(){
	var allowedUrls = [];
	var deniedUrls = [];
	this.urls.forEach(function(obj,url){
		if (obj.asked === 0) return;
		if (obj.allowed) {
			allowedUrls.push([url,obj.asked]);
		} else {
			deniedUrls.push([url,obj.asked]);
		}
	});
	var sort = function(a,b){
		if (a[1] > b[1]) return -1;
		if (a[1] < b[1]) return 1;
		return 0;
	}
	allowedUrls = allowedUrls.sort(sort);
	deniedUrls = deniedUrls.sort(sort);
	return {
		allowed : allowedUrls,
		denied : deniedUrls
	};
};

function getPathFromUrl(url){
	return "ps_"+crypto.createHash('md5').update(url).digest('hex');
}

module.exports = ProjectState;