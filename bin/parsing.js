var Util = require("../Source/Util");

var file = __dirname+"/../Data/test1.html";
var fs = require("fs");

var ext = Util.parseUrisFromHtml( fs.readFileSync( file ).toString() );

console.log( ext );