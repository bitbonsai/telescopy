"use strict";
const DataStructures = require("datastructures-js");
const Resource = require("./Resource");

function Project(options) {
	this.localPath = options.path;
	this.httpEntry = options.remote;
	this.id = '';
	this.running = false;
	this.start();

	this.queue = new DataStructures.Queue();
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

	res.remoteUrl = this.httpEntry;
	this.queue.push( res );
	this.processNext();
};

Project.prototype.processNext = function () {
	var res = this.queue.shift();
	if (!res) {
		this.running = false;
		return;
	}
	var ths = this;
	return res.download()
	.then( this.parseResourceForMoreResources )
	.catch(function(err){
		console.log("skipped resource for error",err);
			ths.skippedUrls.add( res.remoteUrl );
	}).then(function(){
		ths.downloadedUrls.add( res.remoteUrl );
		process.nextTick( ths.next );
	});
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
	});
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


module.exports = Project;