"use strict";
const Stream = require("stream");
const Util = require("util");
const ParserHtml = require("htmlparser2");
const debug = require("debug")("tcopy-transform-html");
const Dequeue = require("dequeue");

function TransformerHtml( options ) {
	Stream.Transform.call(this, {});

	var ths = this;
	this.outputQueue = [];

	this.parser = new ParserHtml.Parser({
		onopentag : function(name, attributes) {
			let args = {
				tag : name.toLowerCase(),
				attributes : {},
				delete : false
			};
			for (let a in attributes) {
				args.attributes[ a.toLowerCase() ] = attributes[a];
			}
			let p = ths.hook('attributes',args)
			.then(function(args){
				if (args.delete) {
					return '';
				}
				let attributes = args.attributes;
				debug("onopentag",name);
				let attrStr = '';
				for (let k in attributes) {
					attrStr += ` ${k}="${attributes[k]}"`;
				}
				let fin = TransformerHtml.selfClosing[name] ? '/>' : '>';
				let str = `<${name}${attrStr}${fin}`;
				return str;
			},function(err){
				debug("caught in onopentag",err);
				return '';
			});
			ths.outputQueue.push(p);
		},
		ontext : function(text) {
			let p = ths.hook('text',text)
			.then(function(text){
				return text;
			},function(err){
				debug("caught in ontext",err);
				return '';
			});
			ths.outputQueue.push(p);
		},
		onclosetag : function(name) {
			debug("onclosetag",arguments);
			if (!TransformerHtml.selfClosing[name]) {
				ths.outputQueue.push( `</${name}>` );
			}
		},
		onprocessinginstruction : function(name, data) {
			debug("onprocessinginstruction",arguments);
			ths.outputQueue.push( `<${data}>` );
		},
		onend : function() {
			ths.push(null);
		}
	},{
		decodeEntities : true,
		recognizeCDATA : true,
		lowerCaseTags : true,
		xmlMode : false,
		lowerCaseAttributeNames : false,
		recognizeSelfClosing : true
	});
	this.hooks = {
		'attributes' : options.attributeHooks ? options.attributeHooks : [],
		'text' : options.textHooks ? options.textHooks : []
	};
	this.lastCb = null;
}
Util.inherits( TransformerHtml, Stream.Transform );

TransformerHtml.selfClosing = {};
'area, base, br, col, embed, hr, img, input, keygen, link, menuitem, meta, param, source, track, wbr'
.split(", ").forEach(function(e){
	TransformerHtml.selfClosing[e] = true;
});

TransformerHtml.prototype.addHook = function (name, hook) {
	this.hooks[name].push( hook );
	return this;
};

TransformerHtml.prototype.hook = function (name, args) {
	var p = Promise.resolve(args);
	this.hooks[name].forEach(function(hook){
		p = p.then(hook);
	});
	return p;
};

TransformerHtml.prototype._transform = function (chunk, encoding, cb) {
	this.parser.write(chunk);
	//not the output queue is populated
	var ths = this;
	Promise.all(this.outputQueue)
	.then(function(res){
		ths.outputQueue = [];
		res.forEach(function(chunk){
			ths.push(chunk);
		});
		cb();
	}).catch(function(err){
		ths.outputQueue = [];
		console.log(err, err.stack ? err.stack.split("\n") : '');
		cb();
	});
};

TransformerHtml.prototype._flush = function () {
	this.parser.end();
};



module.exports = TransformerHtml;