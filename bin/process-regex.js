"use strict";
const FS = require("fs");
const Fetch = require("fetch");
const Stream = require("stream");
const Util = require("util");
const ParserHtml = require("htmlparser2");

function Splitter(size) {
	Stream.Transform.call(this, {});
	this.size = size;
}
Util.inherits( Splitter, Stream.Transform );

Splitter.prototype._transform = function (chunk, encoding, cb) {
	if (encoding === "buffer") {
		chunk = chunk.toString();
	}
	var len = chunk.length;
	var size = this.size;
	var ths = this;
	var push = function() {
		let partLen = Math.min(size,len);
		let part = chunk.substr(0, partLen);
		chunk = chunk.substr(partLen);
		ths.push(part);
		len -= partLen;
		if (len > 0) {
			setTimeout(push,3);
		} else {
			cb();
		}
	};
	push();
};

function Transformer(opts) {
	Stream.Transform.call(this, opts);
	this.htmlBuffer = '';
}
Util.inherits( Transformer, Stream.Transform );

Transformer.prototype._transform = function (chunk, encoding, cb) {
	if (encoding === "buffer") {
		chunk = chunk.toString();
	}
	//console.log("1#chunk",JSON.stringify(chunk));
	this.htmlBuffer += chunk;
	var push = '';
	/*
	while (true) {
		let nlpos = this.htmlBuffer.lastIndexOf(">");
		if (nlpos < 0) break;
		this.htmlBuffer += chunk.substr(0, nlpos+1);
		chunk = chunk.substr(nlpos+1);
		changes = true;
	}
	*/
	let nlpos = this.htmlBuffer.lastIndexOf(">");
	if (nlpos > -1) {
		push = this.htmlBuffer.substr(0, nlpos+1);
		this.htmlBuffer =  this.htmlBuffer.substr(nlpos+1);
	}
	if (push.length > 0) {
		push = push.replace(/\s*(\w+)\s*=\s*((["'])(.*?)\3|([^>\s]*)(?=\s|\/>))(?=[^<]*>)/g,function(all,key,n1,n2,val1,val2){
			console.log("match",arguments);
			if (!key) return all;
			let val = val1 ? val1 : val2;
			if (!val) return all;
			return ` ${key}="${val}"`;
		});
	}
	//console.log("2#pushing", JSON.stringify(push));
	this.push(push);
	//console.log("3#saving", JSON.stringify(this.htmlBuffer));
	cb();
};



var foo = new Transformer();
var split = new Splitter(20);
var read = FS.createReadStream(__dirname+"/../Data/test1.html");
var write = FS.createWriteStream(__dirname+"/../Data/test1_done.html");
read.pipe(split)
	.pipe(foo)
	.pipe(write);

