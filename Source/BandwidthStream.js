"use strict";
const Stream = require("stream");
const Util = require("util");


function BandwidthStream( options ) {
	Stream.Transform.call(this, {});
	this.size = 0;
	this.start = 0;
}
Util.inherits( BandwidthStream, Stream.Transform );

BandwidthStream.prototype._transform = function (chunk, encoding, cb) {
	if (this.start === 0) {
		this.start = Date.now();
	}
	this.size += chunk.length;
	this.push(chunk,encoding);
	cb();
};

BandwidthStream.prototype._flush = function(cb) {
	let data = {
		size : this.size,
		duration : this.start ? Date.now() - this.start : 1
	};
	if (data.duration < 1 || isNaN(data.duration) || !isFinite(data.duration)) {
		data.duration = 1;
	}
	this.emit("bandwidth",data);
	cb();
};


module.exports = BandwidthStream;