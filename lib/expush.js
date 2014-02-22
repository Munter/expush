/*
 * expush
 * https://github.com/Munter/expush
 *
 * Copyright (c) 2014 Peter Müller
 * Licensed under the MIT license.
 */

'use strict';

var fs = require('fs'),
    app = require('express')(),
    spdy = require('spdy'),
    async = require('async'),
    AssetGraph = require('assetgraph'),
    query = AssetGraph.query,
    mime = require('mime'),
    root = process.cwd(),
    assetGraph = new AssetGraph({root: root + '/'});

// Self signed certs
var options = {
  key: fs.readFileSync(__dirname + '/../keys/server.key'),
  cert: fs.readFileSync(__dirname + '/../keys/server.crt'),
  ca: fs.readFileSync(__dirname + '/../keys/server.csr')
};

function sendAsset(asset, req, res, next) {
    var contentType = mime.types[asset.extension.substr(1) || 'application/octet-stream'];
    res.setHeader('Content-Type', contentType);
    var etag = '"' + asset.md5Hex + '"';
    res.setHeader('ETag', etag);
    var ifNoneMatchHeaderValue = req.headers['if-none-match'];
    if (ifNoneMatchHeaderValue && ifNoneMatchHeaderValue.indexOf(etag) !== -1) {
        return res.send(304);
    }

    if (req.isSpdy && contentType === 'text/html') {
        async.eachLimit(assetGraph.collectAssetsPreOrder(asset, {
            type: query.not(['HtmlAnchor', 'JavaScriptSourceMappingUrl', 'JavaScriptSourceUrl']),
            to: {
                url: query.not(/^https?:/)
            }
        }), 1, function (foundAsset, cb) {
            if (foundAsset === asset || foundAsset.fileName !== 'base.css') {
                return setImmediate(cb);
            }
            var headers = {
                    'cache-control': 'max-age=0, must-revalidate',
                    'content-type': mime.types[foundAsset.extension.substr(1) || 'application/octet-stream'],
                    etag: '"' + foundAsset.md5Hex + '"'
                },
                path = foundAsset.url.replace(assetGraph.root, '/'),
                stream = res.push(path, headers);

            stream
                .on('error', function (err) {
                    console.error(path, 'push stream emitted error:', err.stack);
                    cb();
                })
                .on('finish', cb);

            ['error', 'acknowledge', 'finish', '_chunkDone'].forEach(function (eventName) {
                stream.on(eventName, function () {
                    console.log(path, 'event', eventName, arguments);
                });
            });
/*
                    var chunkSize = 1000,
                        delayBetweenChunks = 1,
                        i = 0;
                    (function sendNextChunkOrEnd() {
                        if (i < foundAsset.rawSrc.length) {
                            var endOffset = Math.min(foundAsset.rawSrc.length, i + chunkSize),
                                chunk = foundAsset.rawSrc.slice(i, endOffset);
                            console.log(path + ' sending bytes ' + i + '--' + endOffset);
                            stream.write(chunk);
                            i += chunkSize;
                            setTimeout(sendNextChunkOrEnd, delayBetweenChunks);
                        } else {
        console.log("ENDING", path);
                            stream.end();
                        }
                    }());

*/
            stream.end(foundAsset.rawSrc);
        }, function (err) {
            if (err) {
                // Should not happen, because we don't ever pass an error to the async.eachLimit callback
                throw err;
            }
            res.end(asset.rawSrc);
        });
    }
}

// Logging
['warn', 'error', 'info'].forEach(function (eventName) {
    assetGraph.on(eventName, function (obj) {
        console.log(eventName, obj.message);
    });
});

// Debug
['addAsset', 'removeAsset', 'addRelation', 'removeRelation'].forEach(function (eventName) {
    assetGraph.on(eventName, function (obj) {
        console.log(eventName, obj.toString());
    });
});

console.log('Pupulating assets...');

assetGraph
    .registerRequireJsConfig({preventPopulationOfJavaScriptAssetsUntilConfigHasBeenFound: true})
    .loadAssets(['*.html'])
    .populate({
        from: {type: 'Html'},
        followRelations: {
            type: 'HtmlScript',
            to: {url: /^file:/}
        }
    })
    .assumeRequireJsConfigHasBeenFound()
    .populate({
        followRelations: {
            to: {
                url: query.not(/^https?/)
            }
        }
    })
    .run(function () {
        app.use(function (req, res, next) {
            var url = assetGraph.root + req.url.replace(/^\//, '');

            if (/\/$/.test(url)) {
                url += 'index.html';
            }

            res.on('finish', function() {
                console.log(req.method, url);
            });

            var asset = assetGraph.findAssets({url: url})[0];
            if (asset) {
                sendAsset(asset, req, res, next);
            } else {
                // TODO: Proxy
                res.send(404);
            }
        });
/*
        console.log('Express on port http://localhost:8080');
        app.listen(8080);
*/
        console.log('Spdy on port http://localhost:9000');
        spdy.createServer(options, app).listen(9000);
    });

/*
exports.awesome = function() {
  return 'awesome';
};
*/
