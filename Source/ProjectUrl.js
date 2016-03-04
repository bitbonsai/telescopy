

function ProjectUrl( projectState ) {
	this.allowed = false;
	this.asked = 0;
	this.skipped = false;
	this.downloaded = false;
	this.queued = false;
	this.projectState = projectState;
	this.url = '';
}

ProjectUrl.prototype.setUrl = function ( url, allowed ) {
	this.url = url;
	this.allowed = allowed;
	if (allowed) {
		this.projectState.allowed += 1;
	} else {
		this.projectState.denied += 1;
	}
};

ProjectUrl.prototype.getAllowed = function () {
	this.asked += 1;
	return this.allowed;
};

ProjectUrl.prototype.setSkipped = function () {
	if (this.queued === false) return;
	this.queued = false;
	this.skipped = true;
	this.projectState.queued -= 1;
	this.projectState.skipped += 1;
};

ProjectUrl.prototype.setDownloaded = function () {
	if (this.queued === false) return;
	this.queued = false;
	this.downloaded = true;
	this.projectState.queued -= 1;
	this.projectState.downloaded += 1;
};

ProjectUrl.prototype.setQueued = function () {
	if (this.queued === true || this.skipped === true || this.downloaded === true) return;
	this.queued = true;
	this.projectState.queued += 1;
};

ProjectUrl.prototype.getIsNew = function () {
	return this.queued === false && this.skipped === false && this.downloaded === false;
};

ProjectUrl.prototype.getQueued = function () {
	return this.queued;
};

module.exports = ProjectUrl;