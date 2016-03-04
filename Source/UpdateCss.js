"use strict";
const MIME = require("mime");
const methods = {};

methods.updateUrl = function ( url ) {
	let mime = MIME.lookup( url, 'image/png' );
	return this.processResourceLink( url, mime );
};
methods.updateImport = function ( url ) {
	let mime = MIME.lookup( url, 'text/css' );
	return this.processResourceLink( url, mime );
};

var getOptions = function(resource) {
	return {
		urlHooks : [ methods.updateUrl.bind(resource) ],
		importHooks : [ methods.updateImport.bind(resource) ]
	};
};

module.exports = getOptions;