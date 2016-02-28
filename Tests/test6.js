"use strict";
const Telescopy = require("../index.js");
const exec = require("child_process").execSync;
const StaticServer = require("static-server");
const Path = require("path");

/*
 * Tests complex relative links and local paths
 */

var remote = Path.normalize(__dirname+"/Fixtures/Remote6");
var mirror = Path.normalize(__dirname+"/../Data/Mirror6");
var temp = Path.normalize(__dirname+"/../Data/Temp1");
var server;
var prepare = function() {
	server = new StaticServer({
		rootPath : remote,
		port : 8080,
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
};

var runTest = function(){
	var project = Telescopy.newProject({
		remote : 'http://localhost:8080/catperson/',
		local : mirror,
		cleanLocal : true,
		tempDir : temp
	});
	project.on('end',finish);
	project.start();
};

prepare();