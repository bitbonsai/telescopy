"use strict";
const debug = require("debug")("tcopy-util");
const methods = {};

methods.guessMime = function( fromHeader, fromUrl ) {
	debug( "guessingMime", [ fromHeader, fromUrl ] );
	if (fromUrl && fromUrl !== 'application/octet-stream') {
		return fromUrl;
	}
	if (fromHeader) return fromHeader;
	return fromUrl;
};


module.exports = methods;