"use strict";
const Util = require("./Util");
const ParserHtml = require("html-parser");
const DataStructures = require("datastructures-js");
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
	this.expectedLocalPath = '';
}

Resource.prototype.process = function () {
	var ths = this;
	var p = Promise.resolve(ths.project.fetch( this.remoteUrl ));
	p = p.then(function(fetchStream){
		return new Promise(function(resolve, reject) {
			fetchStream.on("meta",function(meta){
				debug("meta",meta);
				ths.remoteUrl = meta.finalUrl;	//in case of redirects
				ths.remoteHeaders = meta.responseHeaders;
				if (meta.status >= 400) {
					debug("WARN 404");
					reject(meta);
				} else {
					resolve(fetchStream);
				}
			});
			fetchStream.on("error",reject);
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
	},function(err){
		console.log("unable to download",err);
		//delete local file?
		return false;
	}).then(function(different){
		if (!ths.localPath) {
			ths.localPath = ths.calculateLocalPathFromUrl( ths.remoteUrl, ths.guessMime() );
		}
		if (different) {
			ths.project.addResourceUrls( ths.parsedResources );
			return ths.overrideFromTmpFile();
		}
	});
	return p;
};

Resource.prototype.download = function(fetchStream) {
	var ths = this;
	return new Promise(function(resolve, reject) {
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
		transformStream.on("end", resolve);
		fetchStream.resume();
	});
};

Resource.prototype.isTempFileDifferent = function () {
	var ths = this;
	return new Promise(function(resolve, reject) {
		async.parallel([
			function(cb){
				let hash = new Crypto.Hash("sha1");
				FS.createReadStream( ths.localPath ).pipe(hash).on("end",cb);
			},
			function(cb){
				let hash = new Crypto.Hash("sha1");
				FS.createReadStream( ths.tmpName ).pipe(hash).on("end",cb);
			}
		],function(err,res){
			if (err) reject(err);
			else resolve( res[0] === res[1] );
		})
	});
};

Resource.prototype.overrideFromTmpFile = function () {
	var ths = this;
	return new Promise(function(resolve, reject) {
		async.series([
			function(cb){
				let dirname = Path.dirname(ths.localPath);
				FS.mkdir(dirname,function(err){
					if (err && err.code === 'EEXIST') cb();
					else cb(err);
				});
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
	let absolute = this.makeUrlAbsolute( url, this.remoteUrl );
	let localFile = this.calculateLocalPathFromUrl( absolute, type );
	let localUrl = this.calculateLocalUrl( localFile );
	this.parsedResources.add([ absolute, localFile, type ]);
	return localUrl;
};

Resource.prototype.guessMime = function () {
	let fromUrl = mime.lookup( this.remoteUrl );
	let type = this.remoteHeaders['content-type'];
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

Resource.prototype.getBaseUrl = function () {
	if (this.baseUrl) {
		return this.baseUrl;
	}
	if (this.parentResource) {
		return this.parentResource.getBaseUrl();
	}
	return this.project.httpEntry;
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
	let path = parsedUrl.pathname.length > 1 ? parsedUrl.pathname : 'index';
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

Resource.prototype.calculateLocalUrl = function ( localFile ) {
	let baseUrl = this.getBaseUrl();
	let basePath = this.project.localPath;
	debug("calc localUrl from "+JSON.stringify([baseUrl,basePath,localFile]));
	return localFile.substr( basePath.length );
};

module.exports = Resource;