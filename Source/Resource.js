"use strict";
const Util = require("./Util");
const ParserHtml = require("html-parser");
const DataStructures = require("datastructures-js");
const URL = require("url");
const mime = require("mime");

function Resource() {
	this.project = null;
	this.remoteUrl = '';
	this.localPath = '';
	this.downloaded = false;
	this.parsed = new Set();
	this.remoteHeaders = null;
	this.mime = '';
	this.body = '';
	this.alias = '';
	this.baseUrl = '/';
}

Resource.prototype.download = function () {
	var ths = this;
	return new Promise(function(resolve, reject) {
		if (!ths.remoteUrl) {
			return reject("cannot download, no remote url");
		}
		Util.retrieveWebResource( ths.remoteUrl, {})
		.then(function(data){
			ths.remoteHeaders = data.meta.responseHeaders;
			ths.body = data.body;
			ths.mime = ths.guessMime();
			resolve(ths);
		},reject);
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
	console.log( fromUrl, type );
	return type ? type : fromUrl;
};


Resource.prototype.parseUrisFromHtml = function() {
	var stack = DataStructures.stack();
	var extracted = new Set();
	var pop = function(){
		let elem = stack.pop();
		//console.log("popping",elem);
		if (elem.tag === 'a' && elem.href) {
			extracted.add([ elem.href, 'html' ]);
		} else if (elem.tag === 'link' && elem.rel === 'stylesheet' && elem.href) {
			extracted.add([ elem.href, 'css' ]);
		} else if (elem.tag === 'img' && elem.src) {
			extracted.add([ elem.src, 'image' ]);
		} else if (elem.tag === 'script' && elem.src) {
			extracted.add([ elem.src, 'js' ]);
		} else if (elem.tag === 'base' && elem.href) {
			this.baseUrl = elem.href;	//override base url
		}
	};
	ParserHtml.parse( this.body, {
		openElement : function(name){
			//console.log('open: %s', name);
			stack.push( { tag : name } );
		},
		closeElement : function(name) {
			let top = stack.peek();
			//console.log('close: %s', name,top);
			if (top && name === top.tag) {
				pop();
			}
		},
		attribute : function(name, value) {
			//console.log('attribute: %s=%s', name, value);
			let elem = stack.peek();
			elem[name] = value;

		},
		closeOpenedElement: function(name, token, unary) {
			//console.log('token: %s, unary: %s', token, unary);
			if (unary) {
				pop();
			}
		},
		comment: function(value) { console.log('comment: %s', value); },
		cdata: function(value) {
			//console.log('cdata: %s', value);
			let current = stack.peek();
			if (!current) return;
			if (current.tag === 'script') {
				let ext = methods.analyseJsForUris( value );
				ext.forEach(function(v){ extracted.add(v); });
			}
		},
		docType: function(value) {
			//console.log('doctype: %s', value);
		},
		text: function(value) {
			//console.log('text: %s', value);
			let current = stack.peek();
			if (!current) return;
			if (current.tag === 'style') {
				let ext = methods.analyseCssForImport( value );
				ext.forEach(function(v){ extracted.add(v); });
			}
		}
	});
	return this.makeSetAbsolute( extracted );
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

methods.analyseCssForImport = function(str) {
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