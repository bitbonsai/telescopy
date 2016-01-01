"use strict";
const Util = require("./Util");
const URL = require("url");
const FS = require("fs");
const mime = require("mime");
const TransformerHtml = require("./TransformHtml");
const TransformerCss = require("./TransformCss");
const async = require("async");
const CP = require("child_process");
const debug = require("debug")("tcopy-resource");
const Stream = require("stream");
const Path = require("path");
const MIME = require("mime");
const Crypto = require("crypto");

function Resource() {
	this.project = null;
	this.remoteUrl = '';
	this.localPath = '';
	this.tempFile = '';
	this.downloaded = false;
	this.parsedResources = new Set();
	this.remoteHeaders = null;
	this.mime = '';
	this.baseUrl = '';
	this.expectedMime = '';
	this.expectedLocalPath = '';	//from canonical url
	this.retries = 0;
}

Resource.prototype.process = function () {
	var ths = this;
	return Promise.resolve(ths.project.fetch( this.remoteUrl ))
	.then(function(fetchStream){
		return new Promise(function(resolve, reject) {
			var timer;
			fetchStream.on("meta",function(meta){
				debug("meta",meta);
				ths.remoteUrl = meta.finalUrl;	//in case of redirects
				ths.remoteHeaders = meta.responseHeaders;
				if (meta.status >= 400) {
					debug("WARN "+meta.status);
					reject(meta);
				} else {
					resolve(fetchStream);
				}
				clearTimeout( timer );
			});
			fetchStream.on("error",reject);
			timer = setTimeout(function(){
				fetchStream.emit("error","timeout");
				fetchStream.destroy();
			},ths.project.timeoutToHeaders);
		});
	}).then(function(fetchStream){
		if (ths.localPath && ths.project.skipExistingFiles) {	//we already have a local copy
			return true;
		}
		return ths.download(fetchStream);
	}).then(function(){
		if (ths.localPath && ths.tempFile) {
			return ths.isTempFileDifferent();
		} else {
			return true;
		}
	}).then(function(different){
		if (!ths.localPath) {
			if (ths.expectedLocalPath) {
				ths.localPath = ths.expectedLocalPath;
			} else {
				ths.localPath = ths.getLocalPath();
			}
		}
		if (different) {
			ths.project.addResourceUrls( ths.parsedResources );
			return ths.overrideFromTmpFile();
		}
	});
};

Resource.prototype.download = function(fetchStream) {
	var ths = this;
	return new Promise(function(resolve, reject) {
		var timer;
		if (!ths.remoteUrl) {
			return reject("cannot download, no remote url");
		}
		if (!ths.tempFile) {
			ths.tempFile = ths.project.getTmpFileName();
		}
		var saveStream = FS.createWriteStream( ths.tempFile );
		var transformStream;
		var guessedMime = ths.guessMime();
		debug("guessed Mime: ",guessedMime);
		switch (guessedMime) {
			case 'html':
			case 'text/html':
				transformStream = new TransformerHtml( ths.updateHtmlAttributes.bind(ths) );
			break;

			case 'text/css':
				transformStream = new TransformerCss({
					onUrl : ths.updateCssUrl.bind(ths),
					onImport : ths.updateCssUrl.bind(ths)
				});
			break;

			default:
				transformStream = new Stream.PassThrough();
			break;
		}

		fetchStream
			.pipe( transformStream )
			.pipe( saveStream );
			
		transformStream.on("end", function(){
			clearTimeout(timer);
			resolve();
		});
		fetchStream.on("error",reject);
		fetchStream.resume();
		timer = setTimeout(function(){
			fetchStream.emit("error","timeout");
			fetchStream.destroy();
		},ths.project.timeoutToDownload);
	});
};

Resource.prototype.isTempFileDifferent = function () {
	var ths = this;new Promise(function(resolve, reject) {
		async.parallel([
			function(cb){
				let hash = new Crypto.Hash("sha1");
				FS.createReadStream( ths.localPath ).pipe(hash).on("end",cb);
			},
			function(cb){
				let hash = new Crypto.Hash("sha1");
				FS.createReadStream( ths.tempFile ).pipe(hash).on("end",cb);
			}
		],function(err,res){
			if (err) reject(err);
			else resolve( res[0] === res[1] );
		});
	});
};

Resource.prototype.overrideFromTmpFile = function () {
	var ths = this;
	return new Promise(function(resolve, reject) {
		async.series([
			function(cb){
				let dirname = Path.dirname(ths.localPath);
				CP.exec(`mkdir -p ${dirname}`,null,cb);
			},
			function(cb){
				CP.exec(`mv ${ths.tempFile} ${ths.localPath}`,null,cb)
			}
		],function(err){
			if (err) reject(err);
			else resolve();
		});
	});
};

Resource.prototype.updateHtmlAttributes = function (tag, attributes) {
	switch (tag) {
		case 'a':
			if (attributes.href) {
				attributes.href = this.processResourceLink( attributes.href, 'text/html' );
			}
		break;

		case 'link':
			if (attributes.rel === 'canonical' && attributes.href) {
				let absolute = this.makeUrlAbsolute( attributes.href, this.remoteUrl );
				this.expectedLocalPath = this.calculateLocalPathFromUrl( absolute, 'text/html' );	//use canonical to override local path
				return false;
			}
			if (attributes.rel === 'stylesheet' && attributes.href) {
				attributes.href = this.processResourceLink( attributes.href, 'text/css' );
			}
		break;

		case 'img':
			if (attributes.src) {
				attributes.src = this.processResourceLink( attributes.src, MIME.lookup(attributes.src) );
			}
		break;

		case 'script':
			if (attributes.src) {
				attributes.src = this.processResourceLink( attributes.src, 'application/javascript' );
			}
		break;

		case 'base':
			if (attributes.href) {
				this.baseUrl = attributes.href;
				return false;	//delete it
			}
		break;

		case 'form':
			if (attributes.action) {
				attributes.action = this.processResourceLink( attributes.action, 'text/html' );
			}
		break;

		case 'button':
			if (attributes.formaction) {
				attributes.formaction = this.processResourceLink( attributes.formaction, 'text/html' );
			}
		break;

		case 'meta':
			if (attributes['http-equiv'] === 'refresh' && attributes.content) {
				let ths = this;
				attributes.content.replace(/^(\d+);url=(.+)$/i,function(all,time,url){
					url = ths.processResourceLink( url, 'text/html' );
					return `${time};url=${url}`;
				});
			}
		break;
	}
	return attributes;
};

Resource.prototype.updateCssUrl = function (url) {
	let mime = MIME.lookup(url);
	return this.processResourceLink( url, mime );
};

/**
 * @param string url
 * @param string type
 * @return string local url
 **/
Resource.prototype.processResourceLink = function (url, type) {
	debug("processResourceLink",url,type);
	let absolute = this.makeUrlAbsolute( url, this.getBaseUrl() );
	let parsed = URL.parse( absolute, false, true );
	if (this.project.filterByUrl( parsed )) {
		let localFile = this.getLocalPath();
		let linkFile = this.calculateLocalPathFromUrl( absolute, type );
		let localUrl = this.calculateLocalUrl( linkFile, localFile );
		if (this.project.skipFile( linkFile ) === false) {
			this.parsedResources.add([ absolute, localFile, type ]);
		}
		return localUrl;
	} else {
		return absolute;
	}
};

Resource.prototype.guessMime = function () {
	let fromUrl = mime.lookup( this.remoteUrl );
	let type = this.remoteHeaders ? this.remoteHeaders['content-type'] : null;
	if (type) {
		let cpos = type.indexOf(";");
		if (cpos) {
			type = type.substring(0,cpos);
		}
	}
	debug( "guessingMime", [this.expectedMime, fromUrl, type] );
	if (this.expectedMime) {
		let reg = new RegExp(this.expectedMime,"i");
		if (reg.test(fromUrl)) {
			return fromUrl;
		}
		if (reg.test(type)) {
			return type;
		}
		return this.expectedMime;
	}
	return type ? type : fromUrl;
};

Resource.prototype.makeUrlAbsolute = function( url, baseUrl ) {
	debug("make asbolute",baseUrl,url);
	return URL.resolve( baseUrl, url );
};

Resource.prototype.getBaseUrl = function() {
	if (this.baseUrl) {
		return this.baseUrl;
	}
	return this.remoteUrl;
};

Resource.prototype.getLocalPath = function() {
	if (!this._localPath) {
		this._localPath = this.calculateLocalPathFromUrl( this.remoteUrl, this.guessMime() );
	}
	return this._localPath;
};

Resource.prototype.calculateLocalPathFromUrl = function ( url, mime ) {
	let basePath = this.project.localPath;
	let parsedUrl = URL.parse( url, true, true );
	var queryString = '';
	if (parsedUrl.search) {	//add query as base64
		queryString = new Buffer(parsedUrl.search).toString("base64");
	}
	let ext = MIME.extension( mime );
	let ending = "." + (ext ? ext : 'html');
	let path = parsedUrl.pathname && parsedUrl.pathname.length > 1 ? parsedUrl.pathname : 'index';
	let pathExt = Path.extname(path);
	if (pathExt) {
		path = path.substr(0, path.length - pathExt.length);
	}
	path += queryString;
	path += ending;
	let full = Path.join( basePath, parsedUrl.hostname, path);
	debug("calculated local path to be "+full);
	return full;
};

Resource.prototype.calculateLocalUrl = function ( link, base ) {
	let linkParsed = URL.parse( link, false, false );
	let baseParsed = URL.parse( base, false, false );
	let relPath = Path.relative( Path.dirname(baseParsed.path), Path.dirname(linkParsed.path) );
	let relLink = Path.join( relPath, Path.basename( linkParsed.path ) );
	let search = linkParsed.search ? linkParsed.search : '';
	let hash = linkParsed.hash ? linkParsed.hash : '';
	debug("calc localUrl from "+JSON.stringify([link,base,relLink]));
	return relLink + search + hash;
};

module.exports = Resource;