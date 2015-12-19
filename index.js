"use strict";
const Project = require("./Source/Project");
const runningProjects = {};
var id = 1;

const methods = {};
methods.newProject = function(options) {
	var p = new Project(options);
	var k = "p"+id;
	runningProjects[ k ] = p;
	p.id = k;
	return p;
};

methods.getRunningProject = function(id) {
	return runningProjects[ id ];
};

methods.loadProject = function(options) {
	return methods.newProject( options );
};

module.exports = methods;