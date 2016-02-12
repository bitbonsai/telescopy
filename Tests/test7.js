"use strict";
const Util = require("../Source/Util");
const MIME = require("mime");

MIME.define({
	'text/xml' : ['xml']
});

const tests = [
	[ 'text/html', null, null ],
	[ 'text/html', 'text/xml', null ],
	[ 'text/html', null, 'text/xml' ],
	[ 'image', 'image/png', null ],
	[ 'text/html', null, 'application/octet-stream' ]
];

tests.forEach(function(test){
	console.log(test);
	let res = Util.guessMime.apply( null, test );
	console.log(" ==> ",res," -> ", MIME.extension(res));
});