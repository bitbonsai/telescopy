"use strict";
const MIME = require("mime");
const methods = {};
const TransformCss = require("./TransformCss");

methods.updateAttributes = function (args) {
	let attributes = args.attributes;

	if ("style" in attributes) {
		var styleProm = methods.updateStyles.call(this, attributes.style)
		.then(function(style){
			args.attributes.style = style;
		});
	}

	switch (args.tag) {
		case 'a':
		case 'area':
			if (attributes.href) {
				attributes.href = this.processResourceLink( attributes.href, MIME.lookup(attributes.href, 'text/html') );
			}
		break;

		case 'link':
			if (attributes.rel === 'canonical' && attributes.href) {
				let absolute = this.makeUrlAbsolute( attributes.href );
				this.setCanonicalUrl( absolute );
				args.delete = true;
			}
			if (attributes.rel === 'stylesheet' && attributes.href) {
				attributes.href = this.processResourceLink( attributes.href, 'text/css' );
			}
		break;

		case 'img':
			if (attributes.src) {
				attributes.src = this.processResourceLink( attributes.src, MIME.lookup(attributes.src, 'image/jpeg') );
			}
		break;

		case 'script':
			if (attributes.src) {
				let type = attributes.type ? 'application/'+attributes.type : 'application/javascript';
				attributes.src = this.processResourceLink( attributes.src, type );
			}
		break;

		case 'base':
			if (attributes.href) {
				this.baseUrl = attributes.href;
				args.delete = true;
			}
		break;

		case 'form':
			if (attributes.action) {
				attributes.action = this.processResourceLink( attributes.action, 'text/html' );
			}
		break;

		case 'button':
			if (attributes.formaction) {
				attributes.formaction = this.processResourceLink( attributes.formaction, 'text/html' );
			}
		break;

		case 'meta':
			if (attributes['http-equiv'] === 'refresh' && attributes.content) {
				let ths = this;
				attributes.content.replace(/^(\d+);url=(.+)$/i,function(all,time,url){
					url = ths.processResourceLink( url, 'text/html' );
					return `${time};url=${url}`;
				});
			}
		break;

		case 'option':
			if (attributes.value && attributes.value.match(/https?\:/)) {
				attributes.value = this.processResourceLink( attributes.value, 'text/html' );
			}
		break;

	}
	if (styleProm) {
		return styleProm.then(function(){
			return args;
		});
	} else {
		return args;
	}
};

methods.updateStyles = function(text) {
	var ths = this;
	return TransformCss.replaceUrls( text, function( hook, url ){
		let defMime = hook === 'url' ? 'image/png' : 'text/css';
		let mime = MIME.lookup( url, defMime );
		return Promise.resolve( ths.processResourceLink( url, mime ) );
	});
};

var getOptions = function(resource) {
	return {
		attributeHooks : [ methods.updateAttributes.bind(resource) ],
		styleHooks : [ methods.updateStyles.bind(resource) ]
	};
};

module.exports = getOptions;