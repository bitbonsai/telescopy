"use strict";
const Dequeue = require("dequeue");
const Resource = require("./Resource");
const debug = require("debug")("tcopy-project");
const FS = require("fs");
const rimraf = require("rimraf");
const async = require("async");
const Path = require("path");
const CP = require("child_process");
const Fetch = require("fetch");
const HTTP = require("http");
const HTTPS = require("https");
const URL = require("url");
const Filter = require("./Filter");
const UpdateHtml = require("./UpdateHtml");
const UpdateCss = require("./UpdateCss");
const TransformerHtml = require("./TransformHtml");
const TransformerCss = require("./TransformCss");
const Stream = require("stream");
const MIME = require("mime");
const ProjectState = require("./ProjectState");
const mkdirp = require("mkdirp");
const Events = require("events");
const util = require("util");

MIME.define({
	'text/xml' : ['xml']
});

function Project(options) {

	Events.EventEmitter.call(this,{});

	this.localPath = Path.normalize( options.local );
	this.httpEntry = options.remote;
	this.cleanLocal = options.cleanLocal || false;
	this.tempDir = options.tempDir || '/tmp/telescopy';
	this.skipExistingFiles = options.skipExistingFiles || false;
	this.skipExistingFilesExclusion = options.skipExistingFilesExclusion || null;
	this.maxRetries = options.maxRetries || 3;
	this.timeoutToHeaders = options.timeoutToHeaders || 6000;
	this.timeoutToDownload = options.timeoutToDownload || 12000;
	this.linkRedirects = options.linkRedirects || false;
	this.defaultIndex = options.defaultIndex || 'index';
	this.userAgent = options.useragent || 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:40.0) Gecko/20100101 Firefox/40.1';
	this.lruCache = options.lruCache || 0;
	this.transformers = options.transformers ? options.transformers : {
		'text/html' : TransformerHtml,
		'text/css' : TransformerCss
	};
	this.transformerOptions = options.transformerOptions ? options.transformerOptions : {
		'text/html' : UpdateHtml,
		'text/css' : UpdateCss
	};
	this.baseWaitTime = options.baseWaitTime || 0;
	this.randWaitTime = options.randWaitTime || 0;

	let filterByUrl;
	if (options.filterByUrl) {
		filterByUrl = options.filterByUrl;
	} else if (options.urlFilter) {
		this.urlFilter = new Filter(options.urlFilter);
        filterByUrl = this.urlFilter.run.bind( this.urlFilter );
	} else {
		var entryHost = URL.parse( this.httpEntry, false, true ).host;
		filterByUrl = function(urlParts) {
			return urlParts.host === entryHost;
		};
	}
	this.state = new ProjectState( this, filterByUrl );

	this.agentOptions = {
		keepAlive : true,
		keepAliveMsecs : 3000,
		maxSockets : 1000,
		maxFreeSockets : 256
	};
	this.httpAgent = new HTTP.Agent(this.agentOptions);
	this.httpsAgent = new HTTPS.Agent(this.agentOptions);

	this.id = '';
	this.running = false;

	this.queue = new Dequeue();

	this.next = this.processNext.bind(this);

}

util.inherits(Project, Events.EventEmitter);

Project.prototype.fetch = function( url, referer ) {
	let https = url.substr(0,6) === 'https:';
	let stream = new Fetch.FetchStream(url,{
		userAgent : this.userAgent,
		httpAgent : this.httpAgent,
        httpsAgent : this.httpsAgent,
		encoding : '',
		headers : {
			Referer : referer
		}
	});
	stream.pause();
	return stream;
};

Project.prototype.start = function() {
	if (this.running) {
		throw new Error("already running");
	}
	var ths = this;
	this.running = true;
	var p = Promise.resolve();
	if (this.cleanLocal) {
		p = p.then(this.cleanLocalFiles.bind(this))
			.then(this.cleanTempFiles.bind(this));
	}
	p = p.then(this.prepareLocalDirectories.bind(this));
	p.then(function(){
		if (!ths.httpEntry) return;
		let res = ths.getResourceByUrl( ths.httpEntry );
		ths.getUrlObj( ths.httpEntry ).setQueued();
		res.expectedMime = 'text/html';
		ths.queue.push( res );
		ths.processNext();
	}).catch(function(err){
		ths.emit("error",err);
		debug("error starting project",err,err.stack.split("\n"));
	})
};

Project.prototype.processNext = function() {
	if (this.running === false || this.queue.length === 0) {
		this.running = false;
		return this.finish( this.queue.length === 0 );
	}
	var res = this.queue.shift();
	debug("now processing",res.linkedUrl);
	this.emit("startresource",res);
	var ths = this;
	res.process()
	.then(function(){
		ths.finishResource( res );
		setTimeout( ths.next, ths.getWaitTime() );
	},function(err){
		ths.finishResource( res, err );
		setTimeout( ths.next, ths.getWaitTime() );
	}).catch(function(err){
		console.error(err);
		ths.emit("error",err);
		debug(err,err.stack ? err.stack.split("\n") : '');
	});
};

Project.prototype.finishResource = function (res, err) {
	this.emit("finishresource",err, res);
	if (!err) {
		this.state.addDownloadedBytes( res.bytes, res.bps );
		res.getUrls().forEach(function(url){
			let obj = this.getUrlObj(url);
			obj.setDownloaded();
		}.bind(this));
	} else {
		debug("skipped resource for error",err, err.stack ? err.stack.split("\n") : '');
		if (err === "timeout" && ++res.retries < this.maxRetries) {
			this.queue.push( res );
		} else {
			res.getUrls().forEach(function(url){
				let obj = this.getUrlObj(url);
				obj.setSkipped();
			}.bind(this));
		}
	}
};

Project.prototype.stop = function() {
	if (!this.running) {
		throw new Error("Cannot stop project. Project not running");
	}
	this.running = false;
};

Project.prototype.finish = function(finished) {
	debug("finishing",finished);
	this.running = false;
	this.emit("end",finished);
};

Project.prototype.addUrl = function(url, mime) {
	let urlObj = this.getUrlObj( url );
	if ( urlObj.getQueued() ) return false;
	let res = this.getResourceByUrl(url);
	if (mime) res.expectedMime = mime;
	this.queue.push(res);
	urlObj.setQueued();
	if (!this.running) {
		this.processNext();
	}
	return true;
};

Project.prototype.getResourceByUrl = function( url ) {
	let res = new Resource();
	res.linkedUrl = url;
	res.project = this;
	return res;
};

Project.tmpFiles = 0;
Project.prototype.getTmpFileName = function() {
	Project.tmpFiles += 1;
	let fname = 'telescopy-tmp-'+Project.tmpFiles;
	return Path.join( this.tempDir, fname );
};

Project.prototype.addResourceUrls = function(set) {
	var ths = this;
	var added = 0;
	set.forEach(function(entry){
		let url = entry[0];
		let urlObj = ths.getUrlObj( url );
		if (urlObj.getIsNew() === false) return;
		debug("adding url",url);
		let res = ths.getResourceByUrl(url);
		res.expectedMime = entry[2];
		res.expectedLocalPath = entry[1];
		res.referer = entry[3];
		if (res.expectedLocalPath === 'text/html') {
			ths.queue.push(res);
		} else {
			ths.queue.unshift(res);
		}
		urlObj.setQueued();
		added += 1;
	});
	debug( "added %s / %s resource urls", added, set.size );
};

Project.prototype.cleanLocalFiles = function() {
	var ths = this;
	return new Promise(function(resolve, reject) {
        rimraf(ths.localPath,function(err){
            if (err) reject(err);
            else resolve();
        });
	});
};

Project.prototype.cleanTempFiles = function() {
	var ths = this;
	return new Promise(function(resolve, reject) {
        rimraf(ths.tempDir,function(err){
            if (err) reject(err);
            else resolve();
        });
	});
};

Project.prototype.prepareLocalDirectories = function() {
	var dirs = [this.localPath, this.tempDir];
	return new Promise(function(resolve, reject) {
		dirs.forEach(function(dir){
			try {
				mkdirp.sync(dir);
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

Project.prototype.getUrlStats = function(){
	return this.state.getUrlStats();
};

Project.prototype.getUrlFilterAnalysis = function(){
	return this.state.getUrlFilterAnalysis();
};

Project.prototype.skipFile = function(filePath) {
	if (!this.skipExistingFiles) return false;
	if (this.skipExistingFilesExclusion) {
		let fileExt = Path.extname( filePath );
		let mime = MIME.lookup( fileExt );
		if (this.skipExistingFilesExclusion[mime]) return false;
	}
	try {
		FS.statSync(filePath);
		return true;
	} catch(e) {
		if (e.code === 'ENOENT') return false;
		else throw e;
	}
};

Project.prototype.getUrlObj = function (url) {
	return this.state.getUrlObj( url );
};

Project.prototype.getTransformStream = function (mime, resource) {
	if (this.transformers[mime]) {
		let opfn = this.transformerOptions[mime];
		let options = opfn( resource );
		let CL = this.transformers[mime];
		let transformer = new CL( options );
		return transformer;
	}
	return new Stream.PassThrough();
};

Project.prototype.getWaitTime = function () {
	if (!this.randWaitTime) {
		return this.baseWaitTime;
	}
	return this.baseWaitTime + Math.random() * this.randWaitTime;
};

Project.prototype.destroy = function () {
	this.httpAgent.destroy();
	this.httpsAgent.destroy();
};

module.exports = Project;