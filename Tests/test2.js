"use strict";
const Telescopy = require("../index.js");
const exec = require("child_process").execSync;
const StaticServer = require("static-server");
const Path = require("path");

var remote = Path.normalize(__dirname+"/Fixtures/Remote1");
var mirror = Path.normalize(__dirname+"/../Data/Mirror2");
var temp = Path.normalize(__dirname+"/../Data/Temp2");

var finish = function() {
	var mirrorFiles = exec("du -a "+mirror).toString();
	console.log("\nMIRROR\n",mirrorFiles);
};

var runTest = function(){
	var project = Telescopy.newProject({
		remote : 'http://www.delilahdirk.com/',
		local : mirror,
		cleanLocal : true,
		tempDir : temp,
		onFinish : finish
	});
	project.start();
};

runTest();