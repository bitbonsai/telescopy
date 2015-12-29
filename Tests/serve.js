"use strict";
const StaticServer = require("static-server");
const Path = require("path");

var remote = Path.normalize(__dirname+"/Fixtures/Remote1");
var mirror = Path.normalize(__dirname+"/../Data/Mirror1");

var server = new StaticServer({
	rootPath : mirror,
	port : 8080,
	index : 'index.html',
	followSymlink: true
});
server.start();
server.on("request",function(req,res){
	console.log("REQUEST",req.path);
});
server.on("symbolicLink",function(ref){
	console.log("link",ref);
});