"use strict";
const Fetch = require("fetch");
const FS = require("fs");
const Path = require("path");
const StaticServer = require("static-server");

const file = Path.normalize(__dirname+"/../Tests/Fixtures/Remote1/media/icon1.png");
const remote = Path.normalize(__dirname+"/../Tests/Fixtures/Remote1");
const url = 'http://localhost:8080/media/icon1.png';

var server;
var showfile = function() {
	console.log("FS");
	var rs = FS.createReadStream(file);
	rs.on("data",function(chunk){
		console.log(chunk);
	});
	rs.on("end",showhttp);
};

var showhttp = function() {
	console.log("HTTP");
	var get = new Fetch.FetchStream(url, {
		encoding : ''
	});
	get.on("data",function(chunk){
		console.log(chunk);
	});
	get.on("end",end);
};

var prepare = function() {
	server = new StaticServer({
		rootPath : remote,
		port : 8080,
		followSymlink : true,
		index : 'index.html'
	});
	server.start(showfile);
};

var end = function(){
	server.stop();
};
prepare();