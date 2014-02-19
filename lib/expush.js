/*
 * expush
 * https://github.com/Munter/expush
 *
 * Copyright (c) 2014 Peter Müller
 * Licensed under the MIT license.
 */

'use strict';

var app = require('express')(),
    AssetGraph = require('assetgraph'),
    query = AssetGraph.query,
    mime = require('mime'),
    root = process.cwd(),
    assetGraph = new AssetGraph({root: root + '/'});

function pushAsset(asset, req, res, next) {
    var md5Param = req.param('md5');
    if (md5Param === asset.md5Hex) {
        res.setHeader('Cache-Control', 'max-age=99999999');
    } else {
        res.setHeader('Cache-Control', 'max-age=0; must-revalidate');
    }
    res.setHeader('Content-Type', mime.types[asset.extension.substr(1) || 'application/octet-stream']);
    res.send(asset.rawSrc);
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
        console.log('Listening on port http://localhost:3000');
        app.listen(3000);
    });

/*
exports.awesome = function() {
  return 'awesome';
};
*/
