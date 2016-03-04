"use strict";
const Stream = require("stream");
const Util = require("util");
const debug = require("debug")("tcopy-transform-css");


function TransformerCss( options ) {
	Stream.Transform.call(this, {});
	this.buffer = '';
	this.hooks = {
		'import' : options.importHooks ? options.importHooks : [],
		'url' : options.urlHooks ? options.urlHooks : []
	};
	this.boundHook = this.hook.bind(this);
}
Util.inherits( TransformerCss, Stream.Transform );

TransformerCss.delimiter = "}";
TransformerCss.dummyFn = function(url){ return url; };

TransformerCss.prototype.addHook = function (name, hook) {
	this.hooks[name].push( hook );
	return this;
};

TransformerCss.prototype.hook = function (name, args) {
	var p = Promise.resolve(args);
	this.hooks[name].forEach(function(hook){
		p = p.then(hook);
	});
	return p;
};

TransformerCss.prototype._transform = function (chunk, encoding, cb) {
	if (encoding === "buffer") {
		chunk = chunk.toString();
	}
	debug("chunk",chunk.length);
	this.buffer += chunk;
	var push = '';
	let nlpos = this.buffer.lastIndexOf( TransformerCss.delimiter );
	if (nlpos > -1) {
		push = this.buffer.substr(0, nlpos+1);
		this.buffer =  this.buffer.substr(nlpos+1);
	}
	var ths = this;
	if (push.length > 0) {
		this.replaceUrls(push)
		.then(function(replaced){
			ths.push(replaced);
			cb();
		},function(err){
			throw new Error("this should never happen!");
			ths.push('');
			cb();
		});
	} else {
		this.push(push);
		cb();
	}
};

TransformerCss.prototype._flush = function(cb) {
	var ths = this;
	this.replaceUrls( this.buffer )
	.then(function(buff){
		ths.push( buff );
		cb();
	}).catch(function(err){
		debug(err);
		cb();
	});
};

TransformerCss.prototype.replaceUrls = function (buffer) {
	return TransformerCss.replaceUrls( buffer, this.boundHook );
};

TransformerCss.replaceUrls = function (buffer, hookFn) {
	var placeholders = [];
	var placeholderCount = 0;
	var addPlaceholder = function(hook, arg){
		let ph = "#~#"+(placeholderCount++)+"#~#";
		placeholders.push( hookFn( hook, arg ) );
		return ph;
	};
	var firstPass = buffer.replace(/(:\s*url\s*\(\s*(['"])?(.+?)\2\s*\))|(@import\s*(['"])(.+?)\5)/ig,
		function(all,n1,n2,url,n4,n5,imp){
			if (!url && !imp) return all;
			if (url) {
				if (!n2) n2 = '';
				url = addPlaceholder('url',url);
				return `:url(${n2}${url}${n2})`;
			}
			if (imp) {
				imp = addPlaceholder('import',imp);
				if (!n4) n4 = '"';
				return `@import ${n5}${imp}${n5}`;
			}
		}
	);
	debug("replace-urls",buffer,firstPass,placeholders);
	if (placeholders.count === 0) {
		return Promise.resolve(buffer);
	}
	return Promise.all(placeholders)
	.then(function(placeholders){
		let secondPass = firstPass;
		for (let i=0; i<placeholders.length; i++) {
			let ph = "#~#"+i+"#~#";
			secondPass = secondPass.replace(ph, placeholders[i]);
		}
		return secondPass;
	}).catch(function(err){
		debug(err, err.stack ? err.stack.split("\n") : '');
	});
};

module.exports = TransformerCss;