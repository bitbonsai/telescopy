# telesCOPY

**Status: BETA**

A horribly named website mirroring package. I wrote it because I found using wget to be severly limiting. This addresses the following issues:

 * designed to be used by a program, not directly by a human on the CLI
 * perfect filtering options
 * able to cancel and still use what has been downloaded so far (wget only converts links at the end, not done when canceled)
 * allows for re-download of single resources


## Usage

### Options

#### options.local `string`, `mandatory`
The local path to save to. Will be created if not existing.

#### options.remote `string`, `optional`
The URL to start the download from. If not given, the procedure will not start until **addUrl()** is called.

#### options.cleanLocal `boolean`, `optional`, `default: false`
If true, anything in the local directory will be deleted before starting.

#### options.tempDir `string`, `optional`, `default: /tmp/telescopy`
The TMP-directory to use. Resources are downloaded there before being moved to their final destination.

#### options.skipExistingFiles `boolean`, `optional`, `default: false`
If true, existing files will not be overridden. If false, they will only be overridden if the content differs.

#### options.onFinish `function`, `optional`
A callback to call when the procedure is finished.

#### options.maxRetries `integer`, `optional`, `default: 3`
The maximum number a resource is re-queued if there is a timeout during download.

#### options.timeoutToHeaders `integer`, `optional`, `default: 6000`
Time until we must have received the headers from the servers before it counts as a timeout.

#### options.timeoutToDownload `integer`, `optional`, `default: 12000`
Time until the full download must be complete before it counts as a timeout.

#### options.linkRedirects `boolean`, `optional`, `default: false`
How to handle redirects and canonical urls.

If true, symlinks are created from redirect-urls and canonical urls to the path the resource was first encountered.

If false, other urls are ignored, and the resource may be downloaded multiple times in different locations.

#### options.defaultIndex `string`, `optional`, `default: index`
The expected index-path. Added when paths end in '/'.

#### options.userAgent `string`, `optional`, `default: 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:40.0) Gecko/20100101 Firefox/40.1'`
The user-agent set for all requests.

#### options.filterByUrl `function`, `optional`, `@param {Object} parsedUrl`
Hook for filtering URLs. Must return true if the URL should be downloaded or false if not.
This is the most low-level option for filtering urls. If no filter is given, this defaults to download everything with the same host as the entry-url.

#### options.urlFilter `array<Filter>`, `optional`
Declarative filter list, in order of execution. Each filter can have these attributes:

 * type (key of a parsed url)
 * key (needed if type = query to specify which query-key)
 * comparison (operator, defaults to '===')
 * value (which value to compare against, alternative to test)
 * test (regular expression to test against)
 * match (if results in true: true for allow, false for deny)
 * nomatch (if test does not match, equivalent to match)

 If the type/key specified is undefined, the test is skipped. If neither match or nomatch are set, it defaults to match=true.
 If all tests are skipped, the url is rejected.

 This is an alternative to filterByUrl and is ignored if the other is set.


### API

The public API methods. Use other methods with care.

#### Telescopy.newProject(options)
Creates a new project.

#### project.start()
Starts the procedure

#### project.stop()
Stops the procedure. After finishing the current resource.
.onFinish(false) will be called.

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

 * improve options to updat existing mirror
 * allow parsing of inline styles
 * allow hooking new html parser functions and disabling default ones
 * hide/avoid error when symlink already exists
 * stats: add count of existing files and keep updated
 * find better way to compress querystring than base64 (must be predictable)
 * export and import settings to folder and do not delete on cleanLocal, then allow loading project from local path alone
 

