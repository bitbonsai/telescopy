"use strict";
const Fetch = require("fetch");
const methods = {};

methods.retrieveWebResource = function( url, options ) {
	return new Promise(function(resolve, reject) {
		Fetch.fetchUrl( url, options, function( err, meta, body ){
			if (err) return reject(err);
			else resolve({
				meta : meta,
				body : body
			});
		});
	});
};


module.exports = methods;