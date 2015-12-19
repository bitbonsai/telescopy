"use strict";
var Resource = require("../Source/Resource");

var res = new Resource();
res.remoteUrl = 'https://raw.githubusercontent.com/feross/standard/master/.travis.yml';
res.download()
.then(function(){
	res.guessMime();
},function(err){
	console.log(err);
	if (err.stack){
		console.log(err.stack.split("\n"));
	}
});