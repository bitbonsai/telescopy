"use strict";
const Dequeue = require("dequeue");
const Resource = require("./Resource");
const debug = require("debug")("tcopy-project");
const FS = require("fs");
const rimraf = require("rimraf");
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
const Socks5HttpAgent = require('socks5-http-client/lib/Agent');
const Socks5HttpsAgent = require('socks5-https-client/lib/Agent');

module.exports = Project;

/**
 * @constructor
 * @param {object} options - main configuration
 **/
function Project(options) {

	Events.EventEmitter.call(this,{});

	//local dir
	this.localPath = Path.normalize( options.local );
	//entry point to start
	this.httpEntry = options.remote;
	//clean local dir and temp first on start?
	this.cleanLocal = options.cleanLocal || false;
	//temp dir, optional
	this.tempDir = options.tempDir || this.localPath+'/tmp/';
	//skip url if calculated local path exists
	this.skipExistingFiles = options.skipExistingFiles || false;
	//exclude some mime types from being skipped if they exist
	this.skipExistingFilesExclusion = options.skipExistingFilesExclusion || null;
	//number of retries after timeouts
	this.maxRetries = options.maxRetries || 3;
	//timeout to retrieving http headers
	this.timeoutToHeaders = options.timeoutToHeaders || 6000;
	//timeout to full download completion
	this.timeoutToDownload = options.timeoutToDownload || 12000;
	//create symlinks for http redirects
	this.linkRedirects = options.linkRedirects || false;
	//expected index filename, e.g. is url ends with /
	this.defaultIndex = options.defaultIndex || 'index';
	//default useragent
	this.userAgent = options.useragent || 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:40.0) Gecko/20100101 Firefox/40.1';
	//socks proxy url:port
	this.proxy = options.proxy || null;

	//stream transformers per mime
	this.transformers = options.transformers ? options.transformers : {
		'text/html' : TransformerHtml,
		'text/css' : TransformerCss
	};
	this.transformerOptions = options.transformerOptions ? options.transformerOptions : {
		'text/html' : UpdateHtml,
		'text/css' : UpdateCss
	};

	//wait time between resources: base + random
	this.baseWaitTime = options.baseWaitTime || 0;
	this.randWaitTime = options.randWaitTime || 0;
	//more aggressive url path sanitation
	this.aggressiveUrlSanitation = options.aggressiveUrlSanitation || false;

	//filter settings
	let filterByUrl;
	if (options.filterByUrl) {	//override function
		filterByUrl = options.filterByUrl;
	} else if (options.urlFilter) {	//config
		this.urlFilter = new Filter(options.urlFilter);
        filterByUrl = this.urlFilter.run.bind( this.urlFilter );
	} else {	//fallback to host filter
		var entryHost = this.httpEntry ? URL.parse( this.httpEntry, false, true ).host : {};
		filterByUrl = function(urlParts) {
			return urlParts.host === entryHost;
		};
	}

	//initialize project state
	this.state = new ProjectState( this, filterByUrl );

	//init http or proxy agent
	this.agentOptions = {
		keepAlive : true,
		keepAliveMsecs : 3000,
		maxSockets : 1000,
		maxFreeSockets : 256
	};
	if (this.proxy) {
		let proxyParsed = URL.parse( this.proxy );
		this.agentOptions.keepAlive = false;	//workaround for some bug
		this.agentOptions.socksHost = proxyParsed.hostname;
		this.agentOptions.socksPort = 1*proxyParsed.port;
		this.httpAgent = new Socks5HttpAgent(this.agentOptions);
		this.httpsAgent = new Socks5HttpsAgent(this.agentOptions);
	} else {
		this.httpAgent = new HTTP.Agent(this.agentOptions);
		this.httpsAgent = new HTTPS.Agent(this.agentOptions);
	}

	//init own mime container since it's very important for file naming
	this.mime = new MIME.Mime();
	this.mime.define({
		'text/xml' : ['xml']
	});
	if (options.mimeDefinitions) {
		this.mime.define( options.mimeDefinitions );
	}

	//internal id
	this.id = '';
	//state
	this.running = false;
	//main queue for resources
	this.queue = new Dequeue();

	this.next = this.processNext.bind(this);

}

util.inherits(Project, Events.EventEmitter);

/**
 * create fetch stream to URL
 *
 * @param string url
 * @param string referer
 * @return ReadStream
 **/
Project.prototype.fetch = function( url, referer ) {
	let https = url.substr(0,6) === 'https:';
	let options = {
		userAgent : this.userAgent,
		agentHttp : this.httpAgent,
		agentHttps : this.httpsAgent,
		encoding : '',
		headers : {
			Referer : referer
		}
	};
	let stream = new Fetch.FetchStream( url, options );
	stream.setMaxListeners(12);	//for redirects
	stream.pause();	//must pause until pipes are established
	return stream;
};

/**
 * start the project procedure
 * creates directories or cleans them first as needed
 * creates entry resource
 * @public
 **/
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

/**
 * called internally to continue with next resource if available
 **/
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

/**
 * called internally after resource is finished or threw an error
 * house-keeping, retry management
 **/
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

/**
 * will stop project after current resource has finished
 * @public
 **/
Project.prototype.stop = function() {
	if (!this.running) {
		throw new Error("Cannot stop project. Project not running");
	}
	this.running = false;
};

/**
 * called internally after project has come to a halt
 **/
Project.prototype.finish = function(finished) {
	debug("finishing",finished);
	this.running = false;
	this.emit("end",finished);
};

/**
 * adds a single url to the queue
 * @public
 * @param {string} url - url to add
 * @param {string} mime - optional mime type that is to be expected
 * @return {bool} - if successfully added
 **/
Project.prototype.addUrl = function(url, mime) {
	let urlObj = this.getUrlObj( url );
	if ( urlObj.getQueued() ) return false;
	let res = this.getResourceByUrl(url);
	if (mime) res.expectedMime = mime;
	this.queue.push(res);
	urlObj.setQueued();
	if (!this.running) {
		this.running = true;
		this.processNext();
	}
	return true;
};

/**
 * called internally to create a new resource object
 * @param {string} url
 * @return {RESOURCE}
 **/
Project.prototype.getResourceByUrl = function( url ) {
	let res = new Resource();
	res.linkedUrl = url;
	res.project = this;
	return res;
};

Project.tmpFiles = 0;
/**
 * creates an incremental temp file name
 * @return {string} file name
 **/
Project.prototype.getTmpFileName = function() {
	Project.tmpFiles += 1;
	let fname = 'telescopy-tmp-'+Project.tmpFiles;
	return Path.join( this.tempDir, fname );
};

/**
 * called from resource to add a new set of URLs that was found
 * @param {Set} set - array with: url, local-path, mime, referer
 **/
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
		if (res.expectedMime === 'text/html') {
			ths.queue.push(res);
		} else {
			ths.queue.unshift(res);
		}
		urlObj.setQueued();
		added += 1;
	});
	debug( "added %s / %s resource urls", added, set.size );
};

/**
 * called during start to clean existing files
 * @return {Promise}
 **/
Project.prototype.cleanLocalFiles = function() {
	var ths = this;
	return new Promise(function(resolve, reject) {
        rimraf(ths.localPath,function(err){
            if (err) reject(err);
            else resolve();
        });
	});
};

/**
 * called during start to clean temp dir
 * @return {Promise}
 **/
Project.prototype.cleanTempFiles = function() {
	var ths = this;
	return new Promise(function(resolve, reject) {
        rimraf(ths.tempDir,function(err){
            if (err) reject(err);
            else resolve();
        });
	});
};

/**
 * called during start to prepare local and temp dir
 * @return {Promise}
 **/
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

/**
 * can be called to get current url statistic
 * @public
 * @return {Object}
 **/
Project.prototype.getUrlStats = function(){
	return this.state.getUrlStats();
};

/**
 * can be called to create an analysis of urls in filter
 * warning: may be performance intensive
 * @public
 * @return {Object}
 **/
Project.prototype.getUrlFilterAnalysis = function(){
	return this.state.getUrlFilterAnalysis();
};

/**
 * called from resource to ask if this local file should be skipped
 * @param {string} local file path
 * @return {boolean} should skip
 **/
Project.prototype.skipFile = function(filePath) {
	if (!this.skipExistingFiles) return false;
	if (this.skipExistingFilesExclusion) {
		let fileExt = Path.extname( filePath );
		let mime = this.mime.lookup( fileExt );
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

/**
 * retrieve url state object from project state
 * will be created if does not exist
 * @param {string} url
 * @return {PROJECT_URL}
 **/
Project.prototype.getUrlObj = function (url) {
	return this.state.getUrlObj( url );
};

/**
 * create the right transform stream and updater based on mime
 * @param {string} mime
 * @param {RESOURCE} resource - resource object that the updater needs to be tied to
 * @return {TransformStream}
 **/
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

/**
 * create a wait time to the next resource
 * @return {int} time in ms
 **/
Project.prototype.getWaitTime = function () {
	if (!this.randWaitTime) {
		return this.baseWaitTime;
	}
	return this.baseWaitTime + Math.random() * this.randWaitTime;
};

/**
 * call to clean up
 **/
Project.prototype.destroy = function () {
	this.httpAgent.destroy();
	this.httpsAgent.destroy();
};
