/*
 * expush
 * https://github.com/Munter/expush
 *
 * Copyright (c) 2014 Peter Müller
 * Licensed under the MIT license.
 */

'use strict';

var fs = require('fs');
var app = require('express')();
var spdy = require('spdy');
var async = require('async');
var AssetGraph = require('assetgraph');
var query = AssetGraph.query;
var mime = require('mime');
var root = process.cwd();
var chalk = require('chalk');
var assetGraph = new AssetGraph({root: root + '/'});

// Self signed certs
var options = {
  key: fs.readFileSync(__dirname + '/../keys/server.key'),
  cert: fs.readFileSync(__dirname + '/../keys/server.crt'),
  ca: fs.readFileSync(__dirname + '/../keys/server.csr')
};

function sendAsset(asset, req, res, next) {
    var contentType = mime.types[asset.extension.substr(1) || 'application/octet-stream'];
    var etag = '"' + asset.md5Hex + '"';
    var ifNoneMatchHeaderValue = req.headers['if-none-match'];

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
        }), (foundAsset, cb) => {
            if (!foundAsset.isLoaded || foundAsset === asset || !foundAsset.url) {
                return setImmediate(cb);
            }

            var headers = {
//                    'cache-control': 'max-age=0, must-revalidate',
                    'content-type': mime.types[foundAsset.extension.substr(1) || 'application/octet-stream'],
                    etag: '"' + foundAsset.md5Hex + '"'
                };

            var path = foundAsset.url.replace(assetGraph.root, '/');
            var stream = res.push(path, headers);
            var hasEnded = false;

            stream
                .on('error', err => {
                    err.message = path + ': push stream emitted error - ' + err.message;
                    console.error(err);
                    if (!hasEnded) {
                        hasEnded = true;
                        cb();
                    }
                })
                .on('acknowledge', () => {
                    stream.end(foundAsset.rawSrc);
                })
                .on('finish', () => {
                    console.log(chalk.green('PUSH'), path);
                    stream.destroySoon();
                    if (!hasEnded) {
                        hasEnded = true;
                        cb();
                    }
                });
        }, err => {
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
['warn', 'error', 'info'].forEach(eventName => {
    assetGraph.on(eventName, obj => {
        console.log(eventName, obj.message);
    });
});

// Debug
['addAsset', 'removeAsset', 'addRelation', 'removeRelation'].forEach(eventName => {
    assetGraph.on(eventName, obj => {
        //console.log(eventName, obj.toString());
    });
});

console.log('Pupulating assets...');

var query = assetGraph.query;

var followRelationsQueryObj = query.or({
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
    .run((errors, assetGraph) => {
        app.use((req, res, next) => {
            var url = assetGraph.root + req.url.replace(/^\//, '');

            if (/\/$/.test(url)) {
                url += 'index.html';
            }

            res.once('finish', () => {
                var status = res.statusCode;
                var color = 'green';

                if (status > 399) {
                    color = 'red';
                } else if (status > 299) {
                    color = 'yellow';
                }

                console.log(req.method, chalk[color](status), req.url);
            });

            var asset = assetGraph.findAssets({url})[0];
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
