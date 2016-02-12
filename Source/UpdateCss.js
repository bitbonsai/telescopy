"use strict";
const MIME = require("mime");
const methods = {};

methods.updateUrl = function ( url ) {
	let mime = MIME.lookup( url );
	return this.processResourceLink( url, mime );
};

var getOptions = function(resource) {
	return {
		urlHooks : [ methods.updateUrl.bind(resource) ],
		importHooks : [ methods.updateUrl.bind(resource) ]
	};
};

module.exports = getOptions;