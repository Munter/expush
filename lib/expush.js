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

    if (req.isSpdy && contentType === 'text/html') {
        assetGraph.eachAssetPreOrder(asset, {
            type: query.not(['HtmlAnchor', 'JavaScriptSourceMappingUrl', 'JavaScriptSourceUrl']),
            to: {
                url: query.not(/^https?:/)
            }
        }, function (foundAsset) {
            if (foundAsset !== asset) {
                var headers = {
                        'content-type': mime.types[foundAsset.extension.substr(1) || 'application/octet-stream']
                    },
                    path = foundAsset.url.replace(__dirname, '');

                res.push(path, headers, function (err, stream) {
                    if (err) {
                        throw err;
                    }
                    console.log('PUSH', headers['content-type'], foundAsset.url);
                    stream.end(foundAsset.rawSrc);
                });
            }
        });
    }

    res.end(asset.rawSrc);
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

            var asset = assetGraph.findAssets({url: url})[0];
            if (asset) {
                sendAsset(asset, req, res, next);
            } else {
                // TODO: Proxy
                res.send(404);
            }
        });

        console.log('Express on port http://localhost:8080');
        app.listen(8080);

        console.log('Spdy on port http://localhost:8443');
        spdy.createServer(options, app).listen(8443);
    });

/*
exports.awesome = function() {
  return 'awesome';
};
*/
