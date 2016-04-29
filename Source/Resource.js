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
const Crypto = require("crypto");
const BandwidthStream = require("./BandwidthStream");

module.exports = Resource;

/**
 * the resource procedure
 * oversees download, transformation and saving of a file
 * @constructor
 **/
function Resource() {
	this.project = null;

	this.linkedUrl = '';
	this.canonicalUrl = '';
	this.redirectUrl = '';
	this.baseUrl = '';

	this.referer = '';

	this.localPath = '';
	this.expectedLocalPath = '';	//from link on other resource
	this.tempFile = '';

	this.downloaded = false;
	this.parsedResources = new Set();
	this.remoteHeaders = null;
	this.mime = '';
	this.expectedMime = '';

	this.retries = 0;
	this.bytesDownloaded = 0;
	this.downloadSpeed = 0;
	this.bytesExisting = 0;
}

/**
 * get the url that we should use as basis to make urls absolute
 * this is the url that we have opened
 * @return {string} url
 */
Resource.prototype.getOpenUrl = function(){
	return this.redirectUrl ? this.redirectUrl : this.linkedUrl;
};

/**
 * used to make absolute urls, overridden from base-tag
 * @return {string} url
 */
Resource.prototype.getBaseUrl = function() {
	return this.baseUrl ? this.baseUrl : this.getOpenUrl();
};

/**
 * marks a redirect by the server
 * @param {string} url
 **/
Resource.prototype.setRedirectUrl = function( url ){
	this.redirectUrl = url;
	if (this.project.linkRedirects) {
		this.addUrlToProject( url );
	}
};

/**
 * marks a found canonical url meta info
 * must be added to the project as encountered
 * @param {string} url
 **/
Resource.prototype.setCanonicalUrl = function( url ){
	this.canonicalUrl = url;
	if (this.project.linkRedirects) {
		this.addUrlToProject( url );
	}
};

/**
 * adds an url-alias for the same resource to the project
 * @param {string} url
 **/
Resource.prototype.addUrlToProject = function( url ){
	this.project.getUrlObj(url).queued = true;	//use setter to avoid aggregate increase since its the same resource
};

/**
 * retrieve all urls linked to this resource
 * @return {array} urls
 **/
Resource.prototype.getUrls = function(){
	var u = [ this.linkedUrl ];
	if (this.redirectUrl) u.push( this.redirectUrl );
	if (this.canonicalUrl) u.push( this.canonicalUrl );
	return u;
};

/**
 * get the best possible url
 * @return {string} url
 */
Resource.prototype.getOfficialUrl = function(){
	return this.canonicalUrl ? this.canonicalUrl
			: this.redirectUrl ? this.redirectUrl
			: this.linkedUrl;
};

/**
 * init the process
 * @return {Promise}
 **/
Resource.prototype.process = function () {
	var ths = this;
	return Promise.resolve(ths.project.fetch( this.linkedUrl, this.referer ))
	/*
	 * get headers
	 */
	.then(function(fetchStream){
		return new Promise(function(resolve, reject) {
			var timer;
			fetchStream.on("meta",function(meta){
				debug("meta",meta);
				ths.remoteHeaders = meta.responseHeaders;
				if (ths.linkedUrl !== meta.finalUrl) {	//have redirect
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
		if (ths.localPath && ths.project.skipExistingFiles) {	//we already have a local copy - NOT IMPLEMENTED YET 0.13.1
			return true;
		}
		return ths.download(fetchStream);
	})
	/*
	 * check if we need to proceed
	 */
	.then(function(){
		if (ths.localPath && ths.tempFile) {	// NOT IMPLEMENTED YET 0.13.1
			return ths.isTempFileDifferent();
		} else {
			return true;
		}
	})
	/*
	 * move file into position, link if neccessary, finish up
	 */
	.then(function(different){
		if (different) {
			ths.project.addResourceUrls( ths.parsedResources );
			return ths.overrideFromTmpFile();
		}
	})

	.then(function(){
		if (ths.project.linkRedirects) {
			let mime = ths.guessMime();
			if (ths.canonicalUrl && ths.canonicalUrl !== ths.linkedUrl) {
				let canonicalPath = ths.calculateLocalPathFromUrl( ths.canonicalUrl, mime );
				Util.createSymlink( canonicalPath, ths.getLocalPath() );
			}
			if (ths.redirectUrl && ths.redirectUrl !== ths.linkedUrl && (!ths.canonicalUrl || ths.canonicalUrl !== ths.redirectUrl)) {
				let redirPath = ths.calculateLocalPathFromUrl( ths.redirectUrl, mime );
				Util.createSymlink( redirPath, ths.getLocalPath() );
			}
		} //else the other urls are ignored and downloaded seperately if needed

	});
};

/**
 * stream management to download to temp file
 * @param {ReadStream} fetchStream
 * @return {Promise}
 **/
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
		var guessedMime = ths.guessMime();
		debug("guessed Mime: ",guessedMime);

		var transformStream = ths.project.getTransformStream( guessedMime, ths );

		var bandwidthStream = new BandwidthStream();
		bandwidthStream.on("bandwidth",function(data){
			ths.bytes = data.size;
			ths.bps = data.size / data.duration;
		});

		fetchStream
			.pipe( bandwidthStream )
			.pipe( transformStream )
			.pipe( saveStream );

		transformStream.on("end", function(){
			clearTimeout(timer);
			resolve();
		});
		fetchStream.on("error",reject);
		fetchStream.resume();	//finally unpause to start DL
		timer = setTimeout(function(){
			fetchStream.emit("error","timeout");
			fetchStream.destroy();
		},ths.project.timeoutToDownload);
	});
};

/**
 * diff hash of tmpfile and existing file
 * @return {Promise}
 **/
Resource.prototype.isTempFileDifferent = function () {
	var ths = this;
	return new Promise(function(resolve, reject) {
		async.parallel([
			function(cb){
				let hash = new Crypto.Hash("sha1");
				let sizeCheck = new BandwidthStream();
				sizeCheck.on("bandwidth",function(data){
					ths.bytesExisting = data.size;
				});
				FS.createReadStream( ths.localPath ).pipe(sizeCheck).pipe(hash).on("end",cb);
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

/**
 * move temp file to final destination
 * @return {Promise}
 **/
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
 * called from updater to process a link
 * must return localized version and add it to the queue
 * or must return original version if we will not download it
 * @param {string} url
 * @param {string} type
 * @return {string} local url or old url
 **/
Resource.prototype.processResourceLink = function (url, type) {
	debug("processResourceLink",url,type);
	let absolute = Util.normalizeUrl( this.makeUrlAbsolute( url ), this.project.aggressiveUrlSanitation );
	if (this.project.getUrlObj( absolute ).getAllowed()) {	//link to local or remote
		let localFile = this.getLocalPath();
		let linkFile = this.calculateLocalPathFromUrl( absolute, type );
		let localUrl = this.calculateLocalUrl( linkFile, localFile );
		if (this.project.skipFile( linkFile ) === false) {	//queue or skip
			this.parsedResources.add([ absolute, linkFile, type, this.linkedUrl ]);
		}
		return localUrl;
	} else {
		return absolute;
	}
};

/**
 * get mime for this resource
 * usually the expected one must be used or we would change the already determined filename
 * @return {string} mime
 **/
Resource.prototype.guessMime = function () {
	if (this.expectedMime) return this.expectedMime;
	let fromUrl = this.project.mime.lookup( this.linkedUrl );
	let fromHeader = this.remoteHeaders ? this.remoteHeaders['content-type'] : null;
	if (fromHeader) {
		let cpos = fromHeader.indexOf(";");
		if (cpos) {
			fromHeader = fromHeader.substring(0,cpos);
		}
	}
	return Util.guessMime( fromHeader, fromUrl );
};

/**
 * create absolute url from relative link
 * @param {string} url
 * @return {string} url
 **/
Resource.prototype.makeUrlAbsolute = function( url ) {
	let baseUrl = this.getBaseUrl();
	//debug("make absolute",baseUrl,url);
	return URL.resolve( baseUrl, url );
};

/**
 * cache and get local path, generate if neccessary
 * @return {string} path
 **/
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
 * @param {string} url
 * @param {string} mime
 * @return {string} path
 */
Resource.prototype.calculateLocalPathFromUrl = function ( url, mime ) {
	let basePath = this.project.localPath;
	let parsedUrl = URL.parse( url, true, false );
	var queryString = '';
	if (parsedUrl.search) {	//add query as base64
		queryString = new Buffer(parsedUrl.search).toString("base64");
		if (queryString.length > 32) {	//workaround against too long file names
			queryString = Crypto.createHash('sha512').update(queryString).digest("base64");
		}
	}
	let ext = mime ? this.project.mime.extension( mime ) : Path.extname(url).substr(1);
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
 * @param {string} link
 * @param {string} base
 * @return {string} url
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
