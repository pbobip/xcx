const cloud = require('wx-server-sdk');
const { createAuthHandler } = require('./handler');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = createAuthHandler({ cloud });
