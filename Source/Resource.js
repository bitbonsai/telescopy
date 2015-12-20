"use strict";
const Util = require("./Util");
const ParserHtml = require("html-parser");
const DataStructures = require("datastructures-js");
const URL = require("url");
const Fetch = require("fetch");
const FS = require("fs");
const mime = require("mime");
const TransformerHtml = require("./TransformHtml");
const Curli = require("curli");
const async = require("async");
const CP = require("child_process");
const debug = require("debug")("tcopy-resource");
const Stream = require("stream");

function Resource() {
	this.project = null;
	this.remoteUrl = '';
	this.localPath = '';
	this.tempFile = '';
	this.downloaded = false;
	this.parsedResources = new Set();
	this.remoteHeaders = null;
	this.mime = '';
	this.baseUrl = '/';
	this.expectedMime = '';
	this.expectedLocalPath = '';
}

Resource.prototype.process = function () {
	var ths = this;

	var p = Promise.resolve(this.getHeaders());
	p = p.then(function(headers){
		ths.remoteHeaders = headers;
	},function(err){
		console.log("unable to fetch headers for ",ths.remoteUrl,err);
	}).then(function(){
		if (ths.localPath && ths.project.skipExistingFiles) {	//we already have a local copy
			return true;
		}
		return ths.download();
	}).then(function(){
		if (ths.localPath) {
			return ths.isTempFileDifferent();
		} else {
			return true;
		}
	},function(err){
		console.log("unable to download",err,err.stack.split("\n"));
		//delete local file?
		return false;
	}).then(function(different){
		if (different) {
			ths.project.addResourceUrls( ths.parsedResources );
			return ths.overrideFromTmpFile();
		}
	});
	return p;
};

Resource.prototype.download = function () {
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
		switch (ths.guessMime()) {
			case 'html':
			case 'text/html':
				transformStream = new TransformerHtml( ths.updateHtmlAttributes.bind(ths) );
			break;

			default:
				transformStream = new Stream.PassThrough();
			break;
		}
		var remoteStream = new Fetch.FetchStream( ths.remoteUrl, {});
		remoteStream.on("meta",function(meta){
			console.log("remote meta",meta);
			ths.remoteHeaders = meta.responseHeaders;
		});
		remoteStream
			.pipe( transformStream )
			.pipe( saveStream );
		saveStream.on("end", resolve);

	});
};

Resource.prototype.isTempFileDifferent = function () {
	return new Promise(function(resolve, reject) {
		async.parallel([
			function(cb){
				let hash = new Crypto.Hash();
				fs.createReadStream( ths.localPath ).pipe(hash).on("end",cb);
			},
			function(cb){
				let hash = new Crypto.Hash();
				fs.createReadStream( ths.tmpName ).pipe(hash).on("end",cb);
			}
		],function(err,res){
			if (err) reject(err);
			else resolve( res[0] === res[1] );
		})
	});
};

Resource.prototype.overrideFromTmpFile = function () {
	return new Promise(function(resolve, reject) {
		async.series([
			function(cb){
				CP.exec(`mv ${ths.tmpName} ${ths.localPath}`,null,cb)
			},
			function(cb){
				FS.unlink(ths.tmpName,cb);
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
				attributes.href = this.processResourceLink( attributes.href, 'html' );
			}
		break;

		case 'link':
			if (attributes.rel === 'stylesheet' && attributes.href) {
				attributes.href = this.processResourceLink( attributes.href, 'css' );
			}
		break;

		case 'img':
			if (attributes.src) {
				attributes.src = this.processResourceLink( attributes.src, 'image' );
			}
		break;

		case 'script':
			if (attributes.src) {
				attributes.src = this.processResourceLink( attributes.src, 'script' );
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

/**
 * @param string url
 * @param string type
 * @return string local url
 **/
Resource.prototype.processResourceLink = function (url, type) {
	let absolute = this.project.makeUrlAbsolute( url );
	let localUrl = this.getLocalUrl( absolute );
	let localFile = this.getLocalFile( absolute );
	this.parsedResources.add([ absolute, localFile, type ]);
	return localUrl;
};

Resource.prototype.getHeaders = function () {
	var ths = this;
	return new Promise(function(resolve, reject) {
		Curli(ths.remoteUrl,{},function(err,res){
			if (err) reject(err);
			else resolve(res);
		});
	});
};

Resource.prototype.parse = function () {
	var ths = this;
	return new Promise(function(resolve, reject) {
		if (!ths.body) {
			return reject("cannot parse, no body");
		}

		switch (this.mime) {
			case 'text/html':
				ths.parseAsHtml();
				resolve(this);
			break;

			case 'stylesheet/css':
				ths.parseAsCss();
				resolve(this);
			break;

			default:
				reject("no parser");
			break;
		}
	});
};

Resource.prototype.parseAsHtml = function () {
	let uris = Util.parseUrisFromHtml( this.body, this.remoteUrl );
	this.parsed = uris;
};

Resource.prototype.parseAsCss = function() {
	let uris = Util.analyseCssForImport( this.body );
	this.parsed = uris;
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
	debug( "guessingMime", this.expectedMime, fromUrl, type );
	if (this.expectedMime) {
		let reg = new Regex(this.expectedMime,"i");
		if (fromUrl.test(reg)) {
			return fromUrl;
		}
		if (type.test(reg)) {
			return type;
		}
	}
	return type ? type : fromUrl;
};

Resource.prototype.makeUrlAbsolute = function( url ) {
	var baseUrl = this.getBaseUrl();
	return URL.resolve( baseUrl, url );
};

Resource.prototype.makeSetAbsolute = function (set) {
	var set2 = new Set();
	var absolute = this.makeUrlAbsolute;
	set.forEach(function(x){
		x[0] = absolute(x[0]);
		set2.add(x);
	});
	return set2;
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

Resource.prototype.analyseJsForUris = function(str) {
	var extracted = new Set();
	str.replace(/\.src\s*=\s*"([^"]+)"/i,function(all,url){
		extracted.add( [url,'js'] );
	});
	str.replace(/\.src\s*=\s*'([^']+)'/i,function(all,url){
		extracted.add( [url,'js'] );
	});
	return this.makeSetAbsolute( extracted );
};

Resource.prototype.analyseCssForImport = function(str) {
	var extracted = new Set();
	str.replace(/@import "([^"]+)"/,function(all,url){
		extracted.add([ url, 'css' ]);
	});
	str.replace(/@import '([^"]+)'/,function(all,url){
		extracted.add([ url, 'css' ]);
	});
	return this.makeSetAbsolute( extracted );
};

module.exports = Resource;