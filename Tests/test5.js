"use strict";
const URL = require("url");
const Filter = require("../Source/Filter.js");

const filters = [
    {
        type : 'host',
        value : 'example.com',
        nomatch : false
    },{
        type : 'path',
        test : /\/css/,
        match : true
    },{
        type : 'query',
        key : 'date',
        comparison : '<',
        value : 20160101,
        match : false
    },
    true
];
const testSet = [
    'http://example.com',
    'http://fonts.googleapis.com/css?family=Averia+Serif+Libre|Kite+One|Imprima',
    'https://example.com/css/style.css',
    'http://example.com/index.php?date=20151002',
    'http://example.com/index.php?date=20160115'
];

var filter = new Filter(filters);

testSet.forEach(function(url){
    console.log("starting on",url);
    var parsed = URL.parse(url,true,true);
    let result = filter.run( parsed );
    console.log("result\t\t",result);
});