"use strict";
const DataStructures = require("datastructures-js");
const Resource = require("./Resource");

function Project(options) {

	this.localPath = options.path;
	this.httpEntry = options.remote;
	this.skipExistingFiles = options.skipExistingFiles;

	this.id = '';
	this.running = false;

	this.queue = DataStructures.queue();
	this.resourcesByUrl = new Map();
	this.downloadedUrls = new Set();
	this.skippedUrls = new Set();

	this.next = this.processNext.bind(this);
}

Project.prototype.start = function() {
	if (this.running) {
		throw new Error("already running");
	}
	this.running = true;

	let res = this.getResourceByUrl( this.httpEntry );
	this.queue.push( res );
	this.processNext();
};

Project.prototype.processNext = function () {
	var res = this.queue.shift();
	if (!res || this.running === false) {
		this.running = false;
		return;
	}
	var ths = this;
	res.process()
	.then(function(){
		ths.downloadedUrls.add( res.remoteUrl );
		process.nextTick( ths.next );
	},function(err){
		console.log("skipped resource for error",err);
		ths.skippedUrls.add( res.remoteUrl );
		process.nextTick( ths.next );
	});
};

Project.prototype.stop = function () {
	if (!running) {
		throw new Error("Project not running");
	}
	this.running = false;
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
	return '/tmp/telescopy-tmp-'+Project.tmpFiles;
};

Project.prototype.addResourceUrls = function (set) {
	var ths = this;
	set.forEach(function(entry){
		let url = entry[0];
		if (ths.isUrlProcessed(url)) return;
		let res = ths.getResourceByUrl(url);
		res.expectedMime = entry[2];
		res.expectedLocalPath = entry[1];
		ths.queue.push(res);
	});
};


module.exports = Project;