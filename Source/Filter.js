"use strict";
const debug = require("debug")("tcopy-filter");

const filterTypes = ['host','path','query','port'];
const compareTypes = ['=','==','===','>','<','<=','>=','!=','!=='];
const filterTrue = function(){ return true; };
const filterFalse = function(){ return false; };

const buildFilter = function( filter ) {
    if (filter === true) return filterTrue;
    if (filter === false) return filterFalse;

    if (!filter.type || filterTypes.indexOf(filter.type) === -1) {
        throw new Error("invalid filter type: "+JSON.stringify(filter.type));
    }
    if (filter.type === 'query' && typeof filter.key !== 'string') {
        throw new Error("filter.key must be a string, is "+(typeof filter.key));
    }
    if (typeof filter.match === 'undefined' && typeof filter.nomatch === 'undefined') {
        filter.match = true;
    }
    var numericalComparison = false;
    if (typeof filter.comparison !== 'undefined') {
        if (compareTypes.indexOf(filter.comparison) === -1) {
            throw new Error("invalid comparison operator:"+filter.comparison);
        }
        if (/<|>/.test(filter.comparison)) {
            numericalComparison = true;
        }
    }
    if (filter.comparison === '=') filter.comparison = '===';
    var fnBody = '"use strict";';
    fnBody += `\nif(typeof url['${filter.type}'] === 'undefined') return null;\n`;
    fnBody += `let value = url['${filter.type}'];\n`;
    if (filter.key) {
        fnBody += `if(typeof value['${filter.key}'] === 'undefined') return null;\n`;
        fnBody += `value = value['${filter.key}']\n`;
    }
    if (filter.test) {
        fnBody += 'let testResult = '+filter.test+".test(value);\n"
    } else {
        if (typeof filter.value !== 'undefined') {
            let comp = filter.comparison || '===';
            if (!numericalComparison) {
                fnBody += `let testResult = (value ${comp} '${filter.value}');\n`;
            } else {
                fnBody += `let testResult = (1*value ${comp} 1*${filter.value});\n`;
            }
        } else {
            fnBody += `let testResult = true;\n`;
        }
    }
    if (typeof filter.match !== 'undefined') {
        fnBody += `if(testResult===true) return ${filter.match};\n`;
    } else {
        fnBody += `if(testResult===false) return ${filter.nomatch};\n`;
    }
    fnBody += 'return null;';
    debug("BuiltFunction\n"+fnBody+"\n");
    return new Function('url',fnBody);
};

function Filter( filters ) {
    this.filters = filters.map( buildFilter );
}

Filter.prototype.run = function(urlPart) {
    for (let i=0, ii=this.filters.length; i<ii; i++) {
        let fn = this.filters[i];
        let res = fn(urlPart);
        if (res !== null) {
            return res;
        }
    }
    debug("WARNING: no filter matched for "+JSON.stringify(urlPart));
    return false;
};

module.exports = Filter;