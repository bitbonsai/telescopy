"use strict";
const Telescopy = require("../index.js");
const exec = require("child_process").execSync;
const Path = require("path");

var mirror = Path.normalize(__dirname+"/../Data/Mirror1");
var res = 0;
var project = new Telescopy({
	remote : 'http://xmh57jrzrnw6insl.onion/',
	local : mirror,
	cleanLocal : true,
	tempDir : mirror+"/temp/",
	proxy : "socks5://192.168.1.27:9005"
});
project.on("finishresource",function(err,res){
	console.log("Resource Finished", err ? err : '', res.getUrls(), res.bytes, res.bps);
	res += 1;
	if (res > 10) {
		project.stop();
	}
});
project.on("error",function(err){
	console.log(err, err.stack ? err.stack.split("\n") : '');
});
project.on("end",function(){
	console.log( project.getUrlStats() );
	console.log( project.getUrlFilterAnalysis() );
	process.exit();
});
project.start();