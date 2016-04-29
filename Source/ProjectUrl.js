"use strict";

module.exports = ProjectUrl;

/**
 * object representing an encountered url
 * @constructor
 * @param {PROJECT_STATE} projectState
 **/
function ProjectUrl( projectState ) {
	this.allowed = false;
	this.asked = 0;
	this.skipped = false;
	this.downloaded = false;
	this.queued = false;
	this.projectState = projectState;
	this.url = '';
}

/**
 * init after filter was run in projectState
 * @param {string} url
 * @param {boolean} allowed
 **/
ProjectUrl.prototype.setUrl = function ( url, allowed ) {
	this.url = url;
	this.allowed = allowed;
	if (allowed) {
		this.projectState.allowed += 1;
	} else {
		this.projectState.denied += 1;
	}
};

/**
 * ask if allowed an keep track of how often was asked for analysis
 * @return {boolean} allowed
 **/
ProjectUrl.prototype.getAllowed = function () {
	this.asked += 1;
	return this.allowed;
};

/**
 * called if the resource was skipped due to error
 **/
ProjectUrl.prototype.setSkipped = function () {
	if (this.queued === false) return;
	this.queued = false;
	this.skipped = true;
	this.projectState.queued -= 1;
	this.projectState.skipped += 1;
};

/**
 * called if the resource was successfully downloaded
 **/
ProjectUrl.prototype.setDownloaded = function () {
	if (this.queued === false) return;
	this.queued = false;
	this.downloaded = true;
	this.projectState.queued -= 1;
	this.projectState.downloaded += 1;
};

/**
 * called if the resource was added to the queue
 **/
ProjectUrl.prototype.setQueued = function () {
	if (this.queued === true || this.skipped === true || this.downloaded === true) return;
	this.queued = true;
	this.projectState.queued += 1;
};

/**
 * called when adding new resources to the queue
 **/
ProjectUrl.prototype.getIsNew = function () {
	return this.queued === false && this.skipped === false && this.downloaded === false;
};

/**
 * called when manually adding new urls
 **/
ProjectUrl.prototype.getQueued = function () {
	return this.queued;
};
