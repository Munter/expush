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
    chalk = require('chalk'),
    assetGraph = new AssetGraph({root: root + '/'});

// Self signed certs
var options = {
  key: fs.readFileSync(__dirname + '/../keys/server.key'),
  cert: fs.readFileSync(__dirname + '/../keys/server.crt'),
  ca: fs.readFileSync(__dirname + '/../keys/server.csr')
};

function sendAsset(asset, req, res, next) {
    var contentType = mime.types[asset.extension.substr(1) || 'application/octet-stream'],
        etag = '"' + asset.md5Hex + '"',
        ifNoneMatchHeaderValue = req.headers['if-none-match'];

    if (ifNoneMatchHeaderValue && ifNoneMatchHeaderValue.indexOf(etag) !== -1) {
        return res.send(304);
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('ETag', etag);

    if (req.isSpdy && contentType === 'text/html') {
        res.write(asset.rawSrc);

        async.each(assetGraph.collectAssetsPreOrder(asset, {
            type: query.not(['HtmlAnchor', 'JavaScriptSourceMappingUrl', 'JavaScriptSourceUrl']),
            to: {
                url: query.not(/^https?:/)
            }
        }), function (foundAsset, cb) {
            if (!foundAsset.isLoaded || foundAsset === asset || !foundAsset.url) {
                return setImmediate(cb);
            }

            var headers = {
//                    'cache-control': 'max-age=0, must-revalidate',
                    'content-type': mime.types[foundAsset.extension.substr(1) || 'application/octet-stream'],
                    etag: '"' + foundAsset.md5Hex + '"'
                },
                path = foundAsset.url.replace(assetGraph.root, '/'),
                stream = res.push(path, headers),
                hasEnded = false;

            stream
                .on('error', function (err) {
                    err.message = path + ': push stream emitted error - ' + err.message;
                    console.error(err);
                    if (!hasEnded) {
                        hasEnded = true;
                        cb();
                    }
                })
                .on('acknowledge', function () {
                    stream.end(foundAsset.rawSrc);
                })
                .on('finish', function () {
                    console.log(chalk.green('PUSH'), path);
                    stream.destroySoon();
                    if (!hasEnded) {
                        hasEnded = true;
                        cb();
                    }
                });
        }, function (err) {
            if (err) {
                // Should not happen, because we don't ever pass an error to the async.eachLimit callback
                throw err;
            }
            res.end();
        });
    } else {
        res.send(asset.rawSrc);
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
        //console.log(eventName, obj.toString());
    });
});

console.log('Pupulating assets...');

var query = assetGraph.query,
    followRelationsQueryObj = query.or({
        to: {type: 'I18n'}
    },
    {
        type: query.not(['JavaScriptInclude', 'JavaScriptExtJsRequire', 'JavaScriptCommonJsRequire', 'HtmlAnchor', 'SvgAnchor', 'JavaScriptSourceMappingUrl', 'JavaScriptSourceUrl']),
        to: {url: query.not(/^https?:/)}
    });

assetGraph
    .registerRequireJsConfig({preventPopulationOfJavaScriptAssetsUntilConfigHasBeenFound: true})
    .loadAssets(['*.html', '*.js'])
    .populate({from: {type: 'Html'}, followRelations: {type: 'HtmlScript', to: {url: /^file:/}}})
    .assumeRequireJsConfigHasBeenFound()
    .populate({followRelations: followRelationsQueryObj})
    .fixBaseAssetsOfUnresolvedOutgoingRelationsFromHtmlFragments({isInitial: true})
    .assumeThatAllHtmlFragmentAssetsWithoutIncomingRelationsAreNotTemplates()
    .populate({followRelations: followRelationsQueryObj, startAssets: {type: 'Html', isFragment: true, isInitial: true}})
    .run(function (errors, assetGraph) {
        app.use(function (req, res, next) {
            var url = assetGraph.root + req.url.replace(/^\//, '');

            if (/\/$/.test(url)) {
                url += 'index.html';
            }

            res.once('finish', function() {
                var status = res.statusCode,
                    color = 'green';

                if (status > 399) {
                    color = 'red';
                } else if (status > 299) {
                    color = 'yellow';
                }

                console.log(req.method, chalk[color](status), req.url);
            });

            var asset = assetGraph.findAssets({url: url})[0];
            if (asset) {
                sendAsset(asset, req, res, next);
            } else {
                // TODO: Proxy
                res.send(404);
            }
        });

        console.log('Express on port http://localhost:4000');
        app.listen(4000);

        console.log('Spdy on port http://localhost:4001');
        spdy.createServer(options, app).listen(4001);
    });

/*
exports.awesome = function() {
  return 'awesome';
};
*/
