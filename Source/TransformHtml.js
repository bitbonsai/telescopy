"use strict";
const Stream = require("stream");
const Util = require("util");
const ParserHtml = require("htmlparser2");
const debug = require("debug")("tcopy-transform-html");

function TransformerHtml(fnUpdateAttribute) {
	Stream.Transform.call(this, {});
	var ths = this;
	this.parser = new ParserHtml.Parser({
		onopentag : function(name, attributes) {
			let attrStr = '';
			attributes = ths.updateAttributes(name, attributes);
			for (let k in attributes) {
				attrStr += ` ${k}="${attributes[k]}"`;
			}
			let fin = TransformerHtml.selfClosing[name] ? '/>' : '>';
			let str = `<${name}${attrStr}${fin}`;
			ths.push(str);
			debug("onopentag",arguments);
		},
		ontext : function(text) {
			debug("ontext",arguments);
			ths.push(text);
		},
		onclosetag : function(name) {
			debug("onclosetag",arguments);
			if (!TransformerHtml.selfClosing[name]) {
				ths.push(`</${name}>`);
			}
		},
		onprocessinginstruction : function(name, data) {
			debug("onprocessinginstruction",arguments);
			ths.push(`<${data}>`);
		},
		onend : function() {
			ths.emit("end");
		}
	},{
		decodeEntities : true,
		recognizeCDATA : true,
		lowerCaseTags : true,
		xmlMode : false,
		lowerCaseAttributeNames : false,
		recognizeSelfClosing : true
	});
	this.updateAttributes = fnUpdateAttribute ? fnUpdateAttribute : function(tag,attributes){ return attributes; };
}
Util.inherits( TransformerHtml, Stream.Transform );

TransformerHtml.selfClosing = {};
'area, base, br, col, embed, hr, img, input, keygen, link, menuitem, meta, param, source, track, wbr'
.split(", ").forEach(function(e){
	TransformerHtml.selfClosing[e] = true;
});

TransformerHtml.prototype._transform = function (chunk, encoding, cb) {
	this.parser.write(chunk);
	cb();
};

TransformerHtml.prototype._flush = function () {
	this.parser.end();
};



module.exports = TransformerHtml;