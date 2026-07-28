const cloud = require('wx-server-sdk');
const { createWechatPayClient } = require('./wechat-pay');
const {
  createPaymentHandler,
  createPaymentNotificationHandler,
  createRefundNotificationHandler
} = require('./handler');
const { loadWechatPayConfig } = require('./config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const config = loadWechatPayConfig();
const wechatPay = createWechatPayClient({ config });
const paymentMain = createPaymentHandler({ cloud, wechatPay, config });
const paymentNotificationMain = createPaymentNotificationHandler({ cloud, wechatPay, config });
const refundNotificationMain = createRefundNotificationHandler({ cloud, wechatPay, config });

function requestPath(event) {
  return event.path ||
    (event.requestContext && (event.requestContext.path || event.requestContext.httpPath)) ||
    '';
}

function rawBody(event) {
  if (typeof event.rawBody === 'string') return event.rawBody;
  if (typeof event.body !== 'string') return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

exports.main = async function main(event = {}) {
  const path = requestPath(event);
  if (path.endsWith('/payment/notify')) {
    return paymentNotificationMain({ headers: event.headers || {}, rawBody: rawBody(event) });
  }
  if (path.endsWith('/refund/notify')) {
    return refundNotificationMain({ headers: event.headers || {}, rawBody: rawBody(event) });
  }
  return paymentMain(event);
};
