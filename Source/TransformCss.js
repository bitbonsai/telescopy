"use strict";
const Stream = require("stream");
const Util = require("util");
const debug = require("debug")("tcopy-transform-css");


function TransformerCss(opts) {
	Stream.Transform.call(this, {});
	this.buffer = '';
	this.onImport = opts.onImport || TransformerCss.dummyFn;
	this.onUrl = opts.onUrl || TransformerCss.dummyFn;

}
Util.inherits( TransformerCss, Stream.Transform );

TransformerCss.delimiter = "}";
TransformerCss.dummyFn = function(url){ return url; };

TransformerCss.prototype._transform = function (chunk, encoding, cb) {
	if (encoding === "buffer") {
		chunk = chunk.toString();
	}
	this.buffer += chunk;
	var push = '';
	let nlpos = this.buffer.lastIndexOf( TransformerCss.delimiter );
	if (nlpos > -1) {
		push = this.buffer.substr(0, nlpos+1);
		this.buffer =  this.buffer.substr(nlpos+1);
	}
	var ths = this;
	if (push.length > 0) {
		push = this.replaceUrls(push);
	}
	this.push(push);
	cb();
};
TransformerCss.prototype._flush = function(cb) {
	this.buffer = this.replaceUrls( this.buffer );
	this.push( this.buffer );
	cb();
};

TransformerCss.prototype.replaceUrls = function (buffer) {
	var ths = this;
	return buffer.replace(/(:\s*url\s*\(\s*(['"])?(.+?)\2\s*\))|(@import\s*(['"])(.+?)\5)/ig,
			function(all,n1,n2,url,n4,n5,imp){
		if (!url && !imp) return all;
		if (url) {
			url = ths.onUrl(url);
			if (!n2) n2 = '';
			return `:url(${n2}${url}${n2})`;
		}
		if (imp) {
			imp = ths.onImport(imp);
			if (!n4) n4 = '"';
			return `@import ${n5}${imp}${n5}`;
		}
	});
};

module.exports = TransformerCss;