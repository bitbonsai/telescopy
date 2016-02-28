"use strict";
const Util = require("./Util");
const URL = require("url");
const FS = require("fs");
const mkdirp = require("mkdirp");
const mime = require("mime");
const async = require("async");
const CP = require("child_process");
const debug = require("debug")("tcopy-resource");
const Path = require("path");
const MIME = require("mime");
const Crypto = require("crypto");

function Resource() {
	this.project = null;

	this.linkedUrl = '';
	this.canonicalUrl = '';
	this.redirectUrl = '';
	this.baseUrl = '';

	this.localPath = '';
	this.expectedLocalPath = '';	//from link on other resource
	this.tempFile = '';

	this.downloaded = false;
	this.parsedResources = new Set();
	this.remoteHeaders = null;
	this.mime = '';
	this.expectedMime = '';

	this.retries = 0;
}

/*
 * get the url that we should use as basis to make urls absolute
 * this is the url that we have opened
 */
Resource.prototype.getOpenUrl = function(){
	return this.redirectUrl ? this.redirectUrl : this.linkedUrl;
};

/**
 * used to make absolute urls, overridden from base-tag
 */
Resource.prototype.getBaseUrl = function() {
	return this.baseUrl ? this.baseUrl : this.getOpenUrl();
};

Resource.prototype.setRedirectUrl = function( url ){
	this.redirectUrl = url;
	if (this.project.linkRedirects) {
		this.addUrlToProject( url );
	}
};

Resource.prototype.setCanonicalUrl = function( url ){
	this.canonicalUrl = url;
	if (this.project.linkRedirects) {
		this.addUrlToProject( url );
	}
};

Resource.prototype.addUrlToProject = function( url ){
	this.project.getUrlObj(url).queued = true;
};

Resource.prototype.getUrls = function(){
	var u = [ this.linkedUrl ];
	if (this.redirectUrl) u.push( this.redirectUrl );
	if (this.canonicalUrl) u.push( this.canonicalUrl );
	return u;
};

/**
 * get the best possible url
 */
Resource.prototype.getOfficialUrl = function(){
	return this.canonicalUrl ? this.canonicalUrl
			: this.redirectUrl ? this.redirectUrl
			: this.linkedUrl;
};

Resource.prototype.process = function () {
	var ths = this;
	return Promise.resolve(ths.project.fetch( this.linkedUrl ))
	/*
	 * get headers
	 */
	.then(function(fetchStream){
		return new Promise(function(resolve, reject) {
			var timer;
			fetchStream.on("meta",function(meta){
				debug("meta",meta);
				ths.remoteHeaders = meta.responseHeaders;
				if (ths.linkedUrl !== meta.finalUrl) {
					ths.redirectUrl = meta.finalUrl;
					ths.setRedirectUrl( meta.finalUrl );
				}
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
	})
	/*
	 * download or skip
	 */
	.then(function(fetchStream){
		if (ths.localPath && ths.project.skipExistingFiles) {	//we already have a local copy - NOT IMPLEMENTED YET
			return true;
		}
		return ths.download(fetchStream);
	})
	/*
	 * check if we need to proceed
	 */
	.then(function(){
		if (ths.localPath && ths.tempFile) {	// NOT IMPLEMENTED YET
			return ths.isTempFileDifferent();
		} else {
			return true;
		}
	})
	/*
	 * move file into position, link if neccessary, finish up
	 */
	.then(function(different){

		if (ths.project.linkRedirects) {
			let mime = ths.guessMime();
			if (ths.canonicalUrl && ths.canonicalUrl !== ths.linkedUrl) {
				let canonicalPath = ths.calculateLocalPathFromUrl( ths.canonicalUrl, mime );
				Util.createSymlink( canonicalPath, ths.getLocalPath() );
			}
			if (ths.redirectUrl && ths.redirectUrl !== ths.linkedUrl) {
				let redirPath = ths.calculateLocalPathFromUrl( ths.redirectUrl, mime );
				Util.createSymlink( redirPath, ths.getLocalPath() );
			}
		} //else the other urls are ignored and downloaded seperately if needed

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
		if (!ths.linkedUrl) {
			return reject("cannot download, no remote url");
		}
		if (!ths.tempFile) {
			ths.tempFile = ths.project.getTmpFileName();
		}
		var saveStream = FS.createWriteStream( ths.tempFile );
		var transformStream;
		var guessedMime = ths.guessMime();
		debug("guessed Mime: ",guessedMime);

		transformStream = ths.project.getTransformStream( guessedMime, ths );

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

Resource.prototype.overrideFromTmpFile = function(){
	var ths = this;
	return new Promise(function(resolve, reject) {
		async.series([
			function(cb){
				let dirname = Path.dirname( ths.getLocalPath() );
                mkdirp(dirname,cb);
			},
			function(cb){
                FS.rename( ths.tempFile, ths.getLocalPath(), cb );
			}
		],function(err){
			if (err) reject(err);
			else resolve();
		});
	});
};

/**
 * @param string url
 * @param string type
 * @return string local url
 **/
Resource.prototype.processResourceLink = function (url, type) {
	debug("processResourceLink",url,type);
	let absolute = Util.normalizeUrl( this.makeUrlAbsolute( url ) );
	debugger;
	if (this.project.queryUrlFilter( absolute )) {	//link to local or remote
		let localFile = this.getLocalPath();
		let linkFile = this.calculateLocalPathFromUrl( absolute, type );
		let localUrl = this.calculateLocalUrl( linkFile, localFile );
		if (this.project.skipFile( linkFile ) === false) {	//queue or skip
			this.parsedResources.add([ absolute, linkFile, type ]);
		}
		return localUrl;
	} else {
		return absolute;
	}
};

Resource.prototype.guessMime = function () {
	if (this.expectedMime) return this.expectedMime;
	let fromUrl = mime.lookup( this.linkedUrl );
	let fromHeader = this.remoteHeaders ? this.remoteHeaders['content-type'] : null;
	if (fromHeader) {
		let cpos = fromHeader.indexOf(";");
		if (cpos) {
			fromHeader = fromHeader.substring(0,cpos);
		}
	}
	return Util.guessMime( fromHeader, fromUrl );
};

Resource.prototype.makeUrlAbsolute = function( url ) {
	let baseUrl = this.getBaseUrl();
	//debug("make absolute",baseUrl,url);
	return URL.resolve( baseUrl, url );
};

Resource.prototype.getLocalPath = function() {
	if (!this._localPath) {
		this._localPath = this.expectedLocalPath ? this.expectedLocalPath
				: this.calculateLocalPathFromUrl( this.linkedUrl, this.guessMime() );
		debug("calculate local path: "+this._localPath);
	}
	return this._localPath;
};

/**
 * create an absolute local path based on the project and the absolute url
 */
Resource.prototype.calculateLocalPathFromUrl = function ( url, mime ) {
	let basePath = this.project.localPath;
	let parsedUrl = URL.parse( url, true, false );
	var queryString = '';
	if (parsedUrl.search) {	//add query as base64
		queryString = new Buffer(parsedUrl.search).toString("base64");
	}
	let ext = MIME.extension( mime );
	let ending = "." + (ext ? ext : 'html');
	let path = parsedUrl.pathname && parsedUrl.pathname.length > 1
				? parsedUrl.pathname : '/';
	if (path[path.length - 1] === '/') {
		path += this.project.defaultIndex;
	}
	let pathExt = Path.extname(path);
	if (pathExt) {
		path = path.substr(0, path.length - pathExt.length);
	}
	path += queryString;
	path += ending;
	let full = Path.join( basePath, parsedUrl.hostname, path);
	//debug("calculated local path to be "+full);
	return full;
};

/**
 * create a relative url between two local files
 */
Resource.prototype.calculateLocalUrl = function ( link, base ) {
	let linkParsed = URL.parse( link, false, false );
	let baseParsed = URL.parse( base, false, false );
	let relPath = Path.relative( Path.dirname(baseParsed.path), Path.dirname(linkParsed.path) );
	let relLink = Path.join( relPath, Path.basename( linkParsed.path ) );
	let search = linkParsed.search ? linkParsed.search : '';
	let hash = linkParsed.hash ? linkParsed.hash : '';
	//debug("calc localUrl from "+JSON.stringify([link,base,relLink]));
	return relLink + search + hash;
};

module.exports = Resource;