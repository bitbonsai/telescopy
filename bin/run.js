"use strict";
const Telescopy = require("../index.js");
const FS = require("fs");

/*
 * takes a json as arg and runs it as project settings
 */

 const jsonFile = process.argv[ process.argv.length - 1 ];
 const json = FS.readFileSync( jsonFile );
 const options = JSON.parse( json );

var project;
var checker;
var runTest = function(){
	options.onFinish = function(){
		console.log( project.getUrlStats() );
		console.log( project.getUrlFilterAnalysis() );
		process.exit();
	};
	project = Telescopy.newProject( options );
	project.start();
	var check = function() {
		let stats = project.getUrlStats();
		console.log( "~~~ STATS ~~~ ", stats );
		if (stats.queued === 0) {
			clearTimeout(checker);
		}
	};
	checker = setInterval(check,4000);
};

var shutdown = function(){
	console.log("Shutdown started");
	clearTimeout(checker);
	project.stop();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

runTest();
