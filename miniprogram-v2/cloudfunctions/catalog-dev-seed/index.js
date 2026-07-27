const cloud = require('wx-server-sdk');
const { createCatalogDevSeedHandler } = require('./handler');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = createCatalogDevSeedHandler({ cloud });
