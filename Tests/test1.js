"use strict";
const Telescopy = require("../index.js");
const exec = require("child_process").execSync;
const StaticServer = require("static-server");
const Path = require("path");

/*
 * Tests basic functionality, html and css links
 */

var remote = Path.normalize(__dirname+"/Fixtures/Remote1");
var mirror = Path.normalize(__dirname+"/../Data/Mirror1");
var temp = Path.normalize(__dirname+"/../Data/Temp1");
var server;
var prepare = function() {
	server = new StaticServer({
		rootPath : remote,
		port : 8080,
		followSymlink : true,
		index : 'index.html'
	});
	server.start(runTest);
};

var finish = function() {
	var remoteFiles = exec("du -a "+remote).toString();
	var mirrorFiles = exec("du -a "+mirror).toString();
	console.log("\nREMOTE\n",remoteFiles);
	console.log("\nMIRROR\n",mirrorFiles);
	server.stop();
	process.exit(0);
};

var runTest = function(){
	var project = new Telescopy({
		remote : 'http://localhost:8080/',
		local : mirror,
		cleanLocal : true
	});
	project.on("finishresource",function(err,res){
		console.log("Resource Finished", err ? err : '', res.getUrls(), res.bytes, res.bps);
	});
	project.on("error",function(err){
		console.log(err, err.stack ? err.stack.split("\n") : '');
	});
	project.on("end",function(){
		console.log( project.getUrlStats() );
		console.log( project.getUrlFilterAnalysis() );
		finish();
	});
	project.start();
	setTimeout(function(){
		project.addUrl('http://localhost:8080/contact3.html');
	},100);
};

prepare();