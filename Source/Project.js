"use strict";
const DataStructures = require("datastructures-js");
const Resource = require("./Resource");
const debug = require("debug")("tcopy-project");
const FS = require("fs");
const async = require("async");
const Path = require("path");
const CP = require("child_process");

function Project(options) {

	this.localPath = Path.normalize( options.local );
	this.httpEntry = options.remote;
	this.cleanLocal = options.cleanLocal || false;
	this.tempDir = options.tempDir || '/tmp/telescopy';
	this.skipExistingFiles = options.skipExistingFiles;
	this.onFinish = options.onFinish;

	this.id = '';
	this.running = false;

	this.queue = DataStructures.queue();
	this.resourcesByUrl = new Map();
	this.downloadedUrls = new Set();
	this.skippedUrls = new Set();
	this.queuedUrls = new Set();

	this.next = this.processNext.bind(this);
}

Project.prototype.start = function() {
	if (this.running) {
		throw new Error("already running");
	}
	var ths = this;
	this.running = true;
	var p = Promise.resolve(1);
	if (this.cleanLocal) {
		p = p.then(this.cleanLocalFiles.bind(this));
	}
	p = p.then(this.prepareLocalDirectories.bind(this));
	p.then(function(){
		let res = ths.getResourceByUrl( ths.httpEntry );
		res.expectedMime = 'html';
		ths.queue.enqueue( res );
		ths.processNext();
	}).catch(function(err){
		console.log("error starting project",err,err.stack.split("\n"));
	})
};

Project.prototype.processNext = function () {
	var res = this.queue.dequeue();
	if (!res || this.running === false) {
		this.running = false;
		return this.finish(true);
	}
	debug("now processing",res.remoteUrl);
	var ths = this;
	res.process()
	.then(function(){
		ths.downloadedUrls.add( res.remoteUrl );
		process.nextTick( ths.next );
	},function(err){
		console.log("skipped resource for error",err,err.stack.split("\n"));
		ths.skippedUrls.add( res.remoteUrl );
		process.nextTick( ths.next );
	});
};

Project.prototype.stop = function () {
	if (!running) {
		throw new Error("Project not running");
	}
	this.running = false;
	this.finish(false);
};

Project.prototype.finish = function (finished) {
	debug("finishing",finished);
	if (this.onFinish) {
		this.onFinish(finished);
	}
};


Project.prototype.parseResourceForMoreResources = function( res ) {
	var ths = this;
	return res.parse()
	.then(function(){
		res.parsed.forEach(function(entry){
			let uri = entry[0],
				type = entry[1];
			if (ths.isUrlProcessed( uri )) {
				return;
			}
			var res = ths.getResourceByUrl( uri );
			ths.queue.push( res );
		});
		return res;
	});
};

Project.prototype.saveResourceLocally = function ( res ) {
	var localPath = this.getLocalPath( res.remoteUrl );
	return res;
};

Project.prototype.isUrlProcessed = function( url ) {
	return this.downloadedUrls.has( url )
		|| this.skippedUrls.has( url );
};

Project.prototype.getResourceByUrl = function (url, parent) {
	if (this.resourcesByUrl.has(url)) {
		return this.resourcesByUrl.get(url);
	}
	let res = new Resource();
	res.remoteUrl = url;
	res.parentResource = parent;
	res.project = this;
	this.resourcesByUrl.set( url, res );
	return res;
};

Project.tmpFiles = 0;
Project.prototype.getTmpFileName = function () {
	Project.tmpFiles += 1;
	let fname = 'telescopy-tmp-'+Project.tmpFiles;
	return Path.join( this.tempDir, fname );
};

Project.prototype.addResourceUrls = function (set) {
	var ths = this;
	var added = 0;
	set.forEach(function(entry){
		let url = entry[0];
		if (ths.isUrlQueued(url) || ths.isUrlProcessed(url)) return;
		debug("adding url",url);
		let res = ths.getResourceByUrl(url);
		res.expectedMime = entry[2];
		res.expectedLocalPath = entry[1];
		ths.queue.enqueue(res);
		ths.queuedUrls.add(url);
		added += 1;
	});
	debug( "added %s / %s resource urls", added, set.size );
};

Project.prototype.isUrlQueued = function (url) {
	return this.queuedUrls.has(url);
};

Project.prototype.cleanLocalFiles = function () {
	var ths = this;
	return new Promise(function(resolve, reject) {
		CP.exec("rm -rf "+ths.localPath,function(err){
			if (err) reject(err);
			else resolve();
		});
	});
};

Project.prototype.prepareLocalDirectories = function () {
	var dirs = [this.tempDir, this.localPath];
	return new Promise(function(resolve, reject) {
		dirs.forEach(function(dir){
			try {
				FS.mkdirSync(dir);
			} catch(e){
				if (e) {
					if (e.code === 'EEXIST') resolve();
					else reject(e);
				} else {
					resolve();
				}
			}
		});
		resolve();
	});

};

module.exports = Project;