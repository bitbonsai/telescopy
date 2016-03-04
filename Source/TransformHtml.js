"use strict";
const Stream = require("stream");
const Util = require("util");
const ParserHtml = require("htmlparser2");
const debug = require("debug")("tcopy-transform-html");
const Dequeue = require("dequeue");
const TransformCss = require("./TransformCss");

function TransformerHtml( options ) {
	Stream.Transform.call(this, {});

	var ths = this;
	this.outputQueue = [];
	var inStyle = false;
	var styleBuffer = '';

	this.parser = new ParserHtml.Parser({
		onopentag : function(name, attributes) {
			debug("onopentag",name);
			if (name === 'style') inStyle = true;
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
			let hook = inStyle ? 'style' : 'text';
			let p = ths.hook( hook, text )
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
			if (name === 'style') {
				inStyle = false;
				ths.outputQueue.push( ths.hook('style', styleBuffer) );
				styleBuffer = '';
			}
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
		},
		oncdatastart : function(){
			debug("cdatastart",arguments);
		},
		oncdataend : function() {
			debug("cdataend",arguments);
		},
		oncomment : function() {
			debug("oncomment",arguments);
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
		'text' : options.textHooks ? options.textHooks : [],
		'style' : options.styleHooks ? options.styleHooks : []
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
	//now the output queue is populated
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
		debug(err, err.stack ? err.stack.split("\n") : '');
		cb();
	});
};

TransformerHtml.prototype._flush = function () {
	this.parser.end();
};



module.exports = TransformerHtml;