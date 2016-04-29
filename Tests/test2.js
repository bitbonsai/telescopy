"use strict";
const Telescopy = require("../index.js");
const exec = require("child_process").execSync;
const StaticServer = require("static-server");
const Path = require("path");

/*
 * Tests update functionality, simulating 2 remote states
 */

var remoteA = Path.normalize(__dirname+"/Fixtures/Remote2a");
var remoteB = Path.normalize(__dirname+"/Fixtures/Remote2b");
var mirror = Path.normalize(__dirname+"/../Data/Mirror2");
var temp = Path.normalize(__dirname+"/../Data/Temp");

var server;
var project;

var prepare = function(remote,next) {
	server = new StaticServer({
		rootPath : remote,
		port : 8080,
		followSymlink : true,
		index : 'index.html'
	});
	server.start(next);
};

var stage1 = function(){
	console.log("### Stage 1 ###");
	project = new Telescopy({
		remote : 'http://localhost:8080/',
		local : mirror,
		cleanLocal : true,
		tempDir : temp
	});
	project.on("end",cleanup1);
	project.start();
};

var stage2 = function(){
	console.log("### Stage 2 ###");
	project = new Telescopy({
		remote : 'http://localhost:8080/',
		local : mirror,
		cleanLocal : false,
		tempDir : temp,
		skipExistingFiles : true,
		skipExistingFilesExclusion : {
			'text/html' : true
		}
	});
	project.on("end",cleanup2);
	project.start();
};

var cleanup1 = function() {
	server.stop();
	project.destroy();
	project = null;
	prepare( remoteB, stage2 );
};

var cleanup2 = function() {
	server.stop();
	project.destroy();
	project = null;
	var remoteFiles = exec("du -a "+remoteB).toString();
	var mirrorFiles = exec("du -a "+mirror).toString();
	console.log("\nREMOTE\n",remoteFiles);
	console.log("\nMIRROR\n",mirrorFiles);
};

prepare( remoteA, stage1 );