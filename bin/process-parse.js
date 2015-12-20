"use strict";
const FS = require("fs");
const Fetch = require("fetch");
const Stream = require("stream");
const Util = require("util");
const ParserHtml = require("htmlparser2");

function Transformer(opts) {
	Stream.Transform.call(this, opts);
	var ths = this;
	this.parser = new ParserHtml.Parser({
		onopentag : function(name, attributes) {
			let attrStr = '';
			for (let k in attributes) {
				attrStr += ` ${k}="${attributes[k]}"`;
			}
			let fin = Transformer.selfClosing[name] ? '/>' : '>';
			let str = `<${name}${attrStr}${fin}`;
			ths.push(str);
			console.log("onopentag",arguments);
		},
		onopentagname : function(name) {
			return;
			if (openTag) {
				if (Transformer.selfClosing[openTag]) {
					ths.push(" />");
				} else {
					ths.push(`>`);
				}
				openTag = false;
			}
			console.log("onopentagname",arguments);
			ths.push(`<${name}`);
			openTag = name;
		},
		onattribute : function(key, value) {
			return;
			console.log("onattribute",arguments);
			if (value.length > 0) {
				ths.push(` ${key}="${value}"`);
			} else {
				ths.push(` ${key}`);
			}
			openTag = true;
		},
		ontext : function(text) {
			console.log("ontext",arguments);
			ths.push(text);
		},
		onclosetag : function(name) {
			console.log("onclosetag",arguments);
			if (Transformer.selfClosing[name]) {
				//ths.push(" />");
			} else {
				ths.push(`</${name}>`);
			}
		},
		onprocessinginstruction : function(name, data) {
			console.log("onprocessinginstruction",arguments);
			ths.push(`<${data}>`);
		},
		oncomment : function(data) {
			console.log("oncomment",arguments);
			//ths.push(data);
		},
		oncommentend : function() {
			console.log("oncommentend",arguments);
		},
		oncdatastart : function() {
			console.log("oncdatastart",arguments);
		},
		oncdataend : function() {
			console.log("oncdataend",arguments);
		},
		onerror : function(err) {
			console.log("onerror",arguments);
		},
		onreset : function() {
			console.log("onreset",arguments);
		},
		onend : function() {
			console.log("onend",arguments);
		}
	},{
		decodeEntities : true,
		recognizeCDATA : true,
		lowerCaseTags : true,
		xmlMode : false,
		lowerCaseAttributeNames : false,
		recognizeSelfClosing : true
	});
}
Util.inherits( Transformer, Stream.Transform );

Transformer.selfClosing = {};
'area, base, br, col, embed, hr, img, input, keygen, link, menuitem, meta, param, source, track, wbr'
.split(", ").forEach(function(e){
	Transformer.selfClosing[e] = true;
});

Transformer.prototype._transform = function (chunk, encoding, cb) {
	this.parser.write(chunk);
	cb();
};

Transformer.prototype._flush = function () {
	this.parser.end();
};


var foo = new Transformer();
var read = FS.createReadStream(__dirname+"/../Data/test1.html");
var write = FS.createWriteStream(__dirname+"/../Data/test1_done.html");
read.pipe(foo)
	.pipe(write);

