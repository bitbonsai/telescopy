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

MIME.define({
	'text/xml' : ['xml']
});

function Project(options) {

	this.localPath = Path.normalize( options.local );
	this.httpEntry = options.remote;
	this.cleanLocal = options.cleanLocal || false;
	this.tempDir = options.tempDir || '/tmp/telescopy';
	this.skipExistingFiles = options.skipExistingFiles || false;
	this.skipExistingFilesExclusion = options.skipExistingFilesExclusion || null;
	this.onFinish = options.onFinish;
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

	if (options.filterByUrl) {
		this.filterByUrl = options.filterByUrl;
	} else if (options.urlFilter) {
		this.urlFilter = new Filter(options.urlFilter);
        this.filterByUrl = this.urlFilter.run.bind( this.urlFilter );
	} else {
		var entryHost = URL.parse( this.httpEntry, false, true ).host;
		this.filterByUrl = function(urlParts) {
			return urlParts.host === entryHost;
		};
	}

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

	this.urls = new Map();

	this.next = this.processNext.bind(this);

	this.state = new ProjectState(this);
}

Project.prototype.fetch = function(url) {
	let https = url.substr(0,6) === 'https:';
	let stream = new Fetch.FetchStream(url,{
		userAgent : this.userAgent,
		httpAgent : this.httpAgent,
        httpsAgent : this.httpsAgent,
		encoding : ''
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
		res.expectedMime = 'text/html';
		ths.queue.push( res );
		ths.processNext();
	}).catch(function(err){
		console.log("error starting project",err,err.stack.split("\n"));
	})
};

Project.prototype.processNext = function() {
	var res = this.queue.shift();
	if (!res || this.running === false) {
		this.running = false;
		return this.finish( !!res );
	}
	debug("now processing",res.linkedUrl);
	var ths = this;
	res.process()
	.then(function(){
		ths.finishResource( res );
		process.nextTick( ths.next );
	},function(err){
		ths.finishResource( res, err );
		process.nextTick( ths.next );
	}).catch(function(err){
		console.log(err,err.stack.split("\n"));
	});
};

Project.prototype.finishResource = function (res, err) {
	if (!err) {
		res.getUrls().forEach(function(url){
			let obj = this.getUrlObj(url);
			obj.queued = false;
			obj.downloaded = true;
		}.bind(this));
	} else {
		debug("skipped resource for error",err, err.stack ? err.stack.split("\n") : '');
		if (err === "timeout" && ++res.retries < this.maxRetries) {
			this.queue.push( res );
		} else {
			res.getUrls().forEach(function(url){
				let obj = this.getUrlObj(url);
				obj.queued = false;
				obj.skipped = true;
			}.bind(this));
		}
	}
};

Project.prototype.stop = function() {
	if (!running) {
		throw new Error("Cannot stop project. Project not running");
	}
	this.running = false;
};

Project.prototype.finish = function(finished) {
	debug("finishing",finished);
	if (this.onFinish) {
		this.onFinish(finished);
	}
	this.httpAgent.destroy();
	this.httpsAgent.destroy();
};

Project.prototype.addUrl = function(url, mime) {
	if (this.isUrlQueued(url)) return false;
	let res = this.getResourceByUrl(url);
	if (mime) res.expectedMime = mime;
	this.queue.push(res);
	this.getUrlObj(url).queued = true;
	if (!this.running) {
		this.processNext();
	}
	return true;
};

Project.prototype.saveResourceLocally = function( res ) {
	var localPath = this.getLocalPath( res.linkedUrl );
	return res;
};

Project.prototype.isUrlProcessed = function( url ) {
	let obj = this.getUrlObj(url);
	return obj.downloaded || obj.skipped;
};

Project.prototype.getResourceByUrl = function(url, parent) {
	let res = new Resource();
	res.linkedUrl = url;
	res.parentResource = parent;
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
		let url = ths.normalizeUrl( entry[0] );
		if (ths.isUrlQueued(url) || ths.isUrlProcessed(url)) return;
		debug("adding url",url);
		let res = ths.getResourceByUrl(url);
		res.expectedMime = entry[2];
		res.expectedLocalPath = entry[1];
		ths.queue.push(res);
		ths.getUrlObj(url).queued = true;
		added += 1;
	});
	debug( "added %s / %s resource urls", added, set.size );
};

Project.prototype.isUrlQueued = function(url) {
	return this.getUrlObj(url).queued;
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

Project.prototype.printMemory = function() {
	let mem = process.memoryUsage();
	let b = mem.rss+"";
	for (let i=b.length-3; i>0; i-=3) {
		b = b.substr(0,i)+"."+b.substr(i);
	}
	debug("STATS",b,this.queue.length);
}

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

Project.prototype.createSymlink = function(from, to) {
	if (from === to) return;
	let path = Path.relative( Path.dirname(from), to);
	debug("symlinking "+from+" => "+path);
	FS.lstat(filePath, function(err){
		if (!err) return;
		FS.symlink(path,from,function(err){
			if (err) {
				console.log("unable to create symlink!",from,path,err);
			}
		});
	});
};

Project.prototype.normalizeUrl = function (url) {
	if (typeof url.length !== 'undefined') {
		url = URL.parse( url, false, false );
	}
	if (url.hash) {
		url.hash = '';
	}
	return URL.format(url);
};

Project.prototype.getUrlObj = function (url) {
	return this.state.getUrlObj( url );
};

Project.prototype.queryUrlFilter = function( url ){
	let obj = this.getUrlObj(url);
	if (obj.asked === 0) {
		let parsed = URL.parse( url, true, false );
		obj.allowed = this.filterByUrl( parsed );
	}
	obj.asked += 1;
	return obj.allowed;
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

module.exports = Project;