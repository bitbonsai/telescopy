"use strict";
const Telescopy = require("../index.js");
const exec = require("child_process").execSync;
const Path = require("path");
const HTTP = require("http");

/*
 * Tests timout until headers received, and retries
 */

var mirror = Path.normalize(__dirname+"/../Data/Mirror1");
var temp = Path.normalize(__dirname+"/../Data/Temp1");
var server;
var prepare = function() {
	server = HTTP.createServer();
	var wait = 1000;
	var times = 2;
	var t = 0;
	server.on("request",function(req,res){
		setTimeout(function(){
			res.end("your data","utf8");
		},(t++ < times ? wait : 0));
	});
	server.listen(8080, runTest);
};

var finish = function() {
	server.close();
};

var runTest = function(){
	var project = new Telescopy({
		remote : 'http://localhost:8080/',
		local : mirror,
		cleanLocal : true,
		tempDir : temp,
		timeoutToHeaders : 500,
		maxRetries : 3
	});
	project.on("end",finish);
	project.start();
};

prepare();