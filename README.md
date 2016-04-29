# telesCOPY

**Status: BETA**

A horribly named website mirroring package. I wrote it because I found using wget to be severly limiting. This addresses the following issues:

 * designed to be used by a program, not directly by a human on the CLI
 * perfect filtering options
 * able to cancel and still use what has been downloaded so far (wget only converts links at the end, not done when canceled)
 * allows for re-download of single resources

Some other features:

 * fast (all streaming), but only one thread
 * low memory overhead
 * keeps stats of allowed and denied URIs and how often they appeared
 * keeps track of downloaded bits and bps
 * socks5 proxy support

It is **not** a JS-aware scraper that uses phantomjs or similar tech.

## Usage

### Quick Example Config

This is a simple config that will suffice for most projects.
Most options can be saved in json, but not all!

```javascript
var config = {
  "remote" : "https://www.example.com",		//starting url
  "local" : "./Data/Mirror",				//folder to save to
  "cleanLocal" : true,						//clean local folder from any existing files first
  "linkRedirects" : true,					//symlinks for redirects
  "urlFilter" : [{							//rules are applied in order until one match/nomatch condition fits
    "type" : "path",
	"test" : "/\.css/",
	"match" : true							//allow all css files, regardless of domain
  },{
	"type" : "host",
	"value" : "www.example.com",			
	"nomatch" : false						//otherwise limit us to this domain
  },{
	"type" : "query",
	"key" : "showcomments",
	"match" : false							//ignore links with this query-key, regardless of value
  },{
	"type" : "path",
	"test" : "/\\/(blog)|(forum)\\//i",
	"match": false							//ignore links matching this path regex
  },true]									//get everything else
};

var project = new Telescopy(project);
project.start();
```

For a more complete example see bin/run.js

### Options

```javascript
options.local = './mirror/'; //
```
| key | type | description |
| --- | --- | --- |
| local | string, mandatory | The local path to save to. Will be created if not existing |
| remote | string, optional | The URL to start the download from. If not given, start() will only prepare the procedure. You need to call **addUrl()** then. |
| cleanLocal | boolean, default: false | If true, anything in the local directory and temp dir will be deleted before starting. |
| tempDir | string, default: local+/tmp/ | The TMP-directory to use. Resources are downloaded there before being moved to their final destination. Will be cleaned first, according to cleanLocal, so should be empty. Will be created, if neccessary. |
| skipExistingFiles | bool, default: false | If true, existing files will not be checked again. If false, they will be downloaded and parsed, and overridden if the content differs. |
| skipExistingFilesExclusion | object, optional | If set, it will be checked for mime-keys. If true, this file will not be skipped. Example: { "text/html" : true } to not skip redownloading existing html files. |
| maxRetries | int, default: 3 | The maximum number a resource is re-queued if there is a timeout during download. |
| timeoutToHeaders | int, default: 6000 | millisec until we must have received the headers from the servers before it counts as a timeout |
| timeoutToDownload | int, default: 12000 | millisec until the full download must be complete before it counts as a timeout |
| linkRedirects | bool, default: false | ow to handle redirects and canonical urls. If true, symlinks are created from redirect-urls and canonical urls to the path the resource was first encountered. If false, other urls are ignored, and the resource may be downloaded multiple times in different locations |
| defaultIndex | string, default: index | The expected index-path. Added when paths end in '/' |
| userAgent | string, optional | http user agent set for all requests |
| proxy | string, optional | Set a proxy-URL. Currently only socks5 is supported. Can be a local tor node, e.g. "socks5://localhost:9050" to access onion urls |
| baseWaitTime | int, default: 0 | Sets a base wait time in ms between requests. Can be randomized by adding randWaitTime |
| randWaitTime | int, default: 0 | Sets a random wait time in ms, which is added to the base wait time. Example: if you want between 1 and 3 sec wait time, use baseWaitTime: 1000, randWaitTime: 2000 |
| aggressiveUrlSanitation | bool, default: false | Enables a more thorough sanitation or urls that can be required due to intentional link mangling. Removes non-printable and entities (as "%A0") from the pathname. |
| filterByUrl | function, optional | (object: parsedUrl) Hook for filtering URLs. Must return true if the URL should be downloaded or false if not. This is the most low-level option for filtering urls. If no filter is given (not filterByUrl nor urlFilter), this defaults to download everything with the same host as the entry-url. |
| urlFilter | array, optional | Declarative filter list, prefered method for filtering. See below for full details |
| mimeDefinitions | object, optional | {mime : [ending]} list passed to the mime-package. Mime-lookup determins the local file name and servers might reply with non-standard mime-types. |

#### urlFilter Options

Declarative filter list, prefered method for filtering. Must give an array of objects, each with enough of the following keys:

 * type (key of a parsed url, see: https://nodejs.org/api/url.html#url_url_parsing)
 * key (needed if type = query to specify the query-key)
 * comparison (operator, defaults to '===')
 * value (which value to compare against, alternative to test)
 * test (regular expression to test against)
 * match (if results match: true to allow, false to deny)
 * nomatch (only if match is not set. if test does not match: true to allow, false to deny)

If the type/key specified is undefined, the test is skipped. If neither match or nomatch are set, it defaults to match=true.
If all tests are skipped, the url is rejected. You can set true as the last filter to change this.

This is an alternative to filterByUrl and is ignored if the other is set.

**Examples:**
```javascript
{   //whitelist domain and subdomains
  "type":"host",
  "nomatch":false,
  "test":"/^([a-z]+\\.)?mydomain\\.com$/"
}

{   //blacklist anything that has the get-parameter query with a value lower than 20160101
  "type":"query",
  "key":"date",
  "comparison":"<=",
  "value":20160101,
  "match":false
}
```


### Events

#### end (`boolean: finished`)

Called when the queue is empty or when paused has been called and the procedure stopped.

#### startresource (`Resource: res`)

Called before a resource is started. Useful for logging.

#### finishresource (`Error: err, Resource: res`)

When a resource has completed processing or proessing was aborted.
If an error exists, resource may be requeued or marked as skipped.

#### error (`Error: err`)

At an unexpected error condition, usually at the end of a promise chain.

### API

The public API methods. Use other methods with care.

#### new Telescopy(options)
Creates a new project.

#### project.start()
Starts the procedure if the option *remote* was set. Otherwise it just prepares the project and you need to call addUrl()

#### project.stop()
Stops the procedure. After finishing the current resource the *end*-event will be called.

#### project.addUrl(url)
Adds a single URL to the queue. Will start the procedure, if it is not already running.
Returns true, if the URL was added. Will not add the URL if it is already queued or has already been processed.

#### project.getUrlStats()
Compiles a quick update on the progress of the project.
Returns an object with:
 * allowed - number of urls allowed by the filter
 * denied - number of urls denies by the filter
 * skipped - number of resources skipped because of errors
 * downloaded - number of urls downloaded (is bigger than allowed because it contains redirected urls and canonical urls)
 * queued - number of urls queued to download

#### project.getUrlFilterAnalysis()
Compile a complete analysis of the url filter.
Returns an object with allowedUrls[] and deniedUrls[].
Each entry containing the URL itself and the number of times it was referenced, sorted decending.
This helps in improving the filter settings.


## Examples

 See Tests-Folder to usage examples.


## TODO

 * find better way to compress querystring than base64 (must be deterministic)
 * traffic stats, by mime
 * allow processResourceLink() call to skip url filter (allow filtering based on context, not url)
 * add index link or getter for homepage file based on httpEntry
 * fix encoding bug
 * include 404 and other error status codes in stats
 * save project state and use for resuming
 * custom handling of http status codes via config
 * use etags to limit bandwidth usage
 * redirect handling via meta html tag


