"use strict";
const Telescopy = require("../index.js");
const exec = require("child_process").execSync;
const Path = require("path");
const HTTP = require("http");
const FS = require("fs");

var mirror = Path.normalize(__dirname+"/../Data/Mirror4");
var temp = Path.normalize(__dirname+"/../Data/Temp4");
var remote = Path.normalize(__dirname+"/Fixtures/Remote4");
var server;
var prepare = function() {
	server = HTTP.createServer();
	var wait = 1000;
	var times = 2;
	var t = 0;
	server.on("request",function(req,res){
		console.log(req.url);
		if (req.url === '/') {
			req.url = '/index.html';
		}
		if (req.url === '/page.html') {
			res.writeHead(301,{
				'Location': 'http://localhost:8080/page1.html'
			});
			res.end();
		} else if (req.url === '/favicon.ico') {
			res.end("","utf8",404);
		} else {
			try {
				let path = Path.join( remote, req.url );
				let stream = FS.createReadStream(path);
				res.writeHead(200,{
					'Content-Type': 'text/html'
				});
				stream.pipe(res);
			} catch(e){
				res.end("","utf8",404);
			}
		}
	});
	server.listen(8080, runTest);
};
process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err);
  console.log(err.stack.split("\n"));
});

var finish = function() {
	server.close();
};

var runTest = function(){
	var project = Telescopy.newProject({
		remote : 'http://localhost:8080/',
		local : mirror,
		cleanLocal : true,
		tempDir : temp,
		onFinish : function(){
			console.log( project.getUrlStats() );
			console.log( project.getUrlFilterAnalysis() );
			finish();
		},
		timeoutToHeaders : 500,
		linkRedirects : true,
		maxRetries : 3
	});
	project.start();
};

prepare();