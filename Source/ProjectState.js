"use strict";
const Path = require("path");
const crypto = require("crypto");
const FS = require("fs");
const debug = require("debug")("tcopy-state");
const ProjectUrl = require("./ProjectUrl");
const URL = require("url");

module.exports = ProjectState;

/**
 * keeps track of the project state
 * @constructor
 * @param {PROJECT} project - the main project
 * @param {object} urlFilter - the filter fn
 **/
function ProjectState( project, urlFilter ) {

	this.urlFilter = urlFilter;
	this.urls = new Map();

	this.downloadedBytes = 0;
	this.downloads = 0;
	this.speedAggregate = 0;

	//state aggregate. is kept up to date at all times
	this.allowed = 0;
	this.denied = 0;
	this.skipped = 0;
	this.downloaded = 0;
	this.queued = 0;
}

/**
 * called to retrieve or create a state object for an url
 * @param {string} url
 * @return {PROJECT_URL} obj
 **/
ProjectState.prototype.getUrlObj = function ( url ) {
	if (!this.urls.has(url)) {
		let obj;
		if (!obj) {
			debug("create url obj: "+url);
			obj = new ProjectUrl( this );
			let parsed = URL.parse( url, true, false );
			let allowed = this.urlFilter( parsed );
			obj.setUrl( url, allowed );
		}
		this.urls.set( url, obj );
	} else {
		debug("readCached",url);
	}
	let obj = this.urls.get( url );
	return obj;
};

/**
 * retrieve project statistics
 * @return {object} stats
 **/
ProjectState.prototype.getUrlStats = function(){
	var stats = {
		allowed : this.allowed,
		denied : this.denied,
		skipped : this.skipped,
		downloaded : this.downloaded,
		queued : this.queued,
		bytes : this.downloadedBytes,
		speed : ~~(this.speedAggregate / this.downloads)
	};
	return stats;
};

/**
 * generate analysis of filter usage
 * warning: generation may be performance intensive in big projects
 * @return {object} keys: allowedUrls[], deniesUrls[]
 **/
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

/**
 * called internally after a resource has finished
 * @param {int} b - bytes
 * @param {int} bps - bytes per second
 **/
ProjectState.prototype.addDownloadedBytes = function (b, bps) {
	this.downloadedBytes += b;
	this.speedAggregate += bps;
	this.downloads += 1;
};

