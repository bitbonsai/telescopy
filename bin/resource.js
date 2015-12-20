"use strict";
const Resource = require("../Source/Resource");
const Project = require("../Source/Project");
var proj = new Project({
	
});
var res = new Resource();
res.project = proj;
res.remoteUrl = 'https://raw.githubusercontent.com/feross/standard/master/.travis.yml';
res.process()
.then(function(res){
	console.log("processing complete",res);
},function(err){
	console.log(err);
	if (err.stack){
		console.log(err.stack.split("\n"));
	}
});