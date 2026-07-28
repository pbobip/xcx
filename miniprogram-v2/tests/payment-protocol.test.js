const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function keyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

function signedResponse(privateKey, serial, body) {
  const timestamp = '1700000001';
  const nonce = 'wechat-response-nonce';
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
    privateKey
  ).toString('base64');
  const headers = new Map([
    ['wechatpay-timestamp', timestamp],
    ['wechatpay-nonce', nonce],
    ['wechatpay-signature', signature],
    ['wechatpay-serial', serial]
  ]);
  return {
    status: 200,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    async text() { return body; }
  };
}

function encryptedResource(apiV3Key, plaintext) {
  const nonce = 'notify-nonce';
  const associatedData = 'transaction';
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ]).toString('base64');
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext,
    nonce,
    associated_data: associatedData
  };
}

test('正式微信支付 Adapter 签名预支付请求、验证响应并生成小程序支付参数', async () => {
  const merchant = keyPair();
  const wechat = keyPair();
  const publicKeyId = 'PUB_KEY_ID_01111111111111111111111111111111';
  const requests = [];
  const nonces = ['merchant-request-nonce', 'miniprogram-payment-nonce'];
  const { createWechatPayClient } = require('../cloudfunctions/payment/wechat-pay');
  const client = createWechatPayClient({
    config: {
      appid: 'wx373cd5ed5680a30d',
      mchid: '1900000109',
      merchantSerialNo: '7777777777777777777777777777777777777777',
      merchantPrivateKey: merchant.privateKey,
      wechatPayPublicKeyId: publicKeyId,
      wechatPayPublicKey: wechat.publicKey,
      apiV3Key: '0123456789abcdef0123456789abcdef',
      paymentNotifyUrl: 'https://example.com/payment/notify',
      refundNotifyUrl: 'https://example.com/refund/notify'
    },
    now: () => new Date(1700000000000),
    createNonce: () => nonces.shift(),
    request: async (url, options) => {
      requests.push({ url, options });
      return signedResponse(wechat.privateKey, publicKeyId, '{"prepay_id":"wx-prepay-001"}');
    }
  });

  const result = await client.createJsapiPayment({
    description: '钻石段位技术陪',
    outTradeNo: 'BBX202607280001',
    amountCents: 2500,
    openid: 'openid-customer-a',
    expiresAt: new Date('2026-07-28T16:30:00.000Z')
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi');
  const requestBody = JSON.parse(requests[0].options.body);
  assert.deepEqual(requestBody, {
    appid: 'wx373cd5ed5680a30d',
    mchid: '1900000109',
    description: '钻石段位技术陪',
    out_trade_no: 'BBX202607280001',
    time_expire: '2026-07-28T16:30:00+00:00',
    notify_url: 'https://example.com/payment/notify',
    amount: { total: 2500, currency: 'CNY' },
    payer: { openid: 'openid-customer-a' }
  });

  const authorization = requests[0].options.headers.Authorization;
  const signature = /signature="([^"]+)"/.exec(authorization)[1];
  const canonicalRequest = [
    'POST',
    '/v3/pay/transactions/jsapi',
    '1700000000',
    'merchant-request-nonce',
    requests[0].options.body,
    ''
  ].join('\n');
  assert.equal(
    crypto.verify('RSA-SHA256', Buffer.from(canonicalRequest), merchant.publicKey, Buffer.from(signature, 'base64')),
    true
  );
  assert.deepEqual(result, {
    prepayId: 'wx-prepay-001',
    paymentParams: {
      timeStamp: '1700000000',
      nonceStr: 'miniprogram-payment-nonce',
      package: 'prepay_id=wx-prepay-001',
      signType: 'RSA',
      paySign: result.paymentParams.paySign
    }
  });
  const miniprogramMessage = [
    'wx373cd5ed5680a30d',
    '1700000000',
    'miniprogram-payment-nonce',
    'prepay_id=wx-prepay-001',
    ''
  ].join('\n');
  assert.equal(
    crypto.verify('RSA-SHA256', Buffer.from(miniprogramMessage), merchant.publicKey, Buffer.from(result.paymentParams.paySign, 'base64')),
    true
  );
});

test('正式微信支付 Adapter 使用原始 Body 验签并解密支付通知', () => {
  const merchant = keyPair();
  const wechat = keyPair();
  const publicKeyId = 'PUB_KEY_ID_01111111111111111111111111111111';
  const apiV3Key = '0123456789abcdef0123456789abcdef';
  const transaction = {
    mchid: '1900000109',
    appid: 'wx373cd5ed5680a30d',
    out_trade_no: 'BBX202607280001',
    transaction_id: '4200000000202607280001',
    trade_state: 'SUCCESS',
    success_time: '2026-07-28T16:01:00+08:00',
    amount: { total: 2500, payer_total: 2500, currency: 'CNY', payer_currency: 'CNY' },
    payer: { openid: 'openid-customer-a' }
  };
  const rawBody = JSON.stringify({
    id: 'EV-TRANSACTION-001',
    create_time: '2026-07-28T16:01:01+08:00',
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource: encryptedResource(apiV3Key, transaction),
    summary: '支付成功'
  });
  const timestamp = '1700000000';
  const nonce = 'wechat-notify-nonce';
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${nonce}\n${rawBody}\n`),
    wechat.privateKey
  ).toString('base64');
  const { createWechatPayClient } = require('../cloudfunctions/payment/wechat-pay');
  const client = createWechatPayClient({
    config: {
      appid: 'wx373cd5ed5680a30d',
      mchid: '1900000109',
      merchantSerialNo: '7777777777777777777777777777777777777777',
      merchantPrivateKey: merchant.privateKey,
      wechatPayPublicKeyId: publicKeyId,
      wechatPayPublicKey: wechat.publicKey,
      apiV3Key,
      paymentNotifyUrl: 'https://example.com/payment/notify',
      refundNotifyUrl: 'https://example.com/refund/notify'
    },
    now: () => new Date(1700000000000),
    request: async () => { throw new Error('本测试不应发送 HTTP 请求'); }
  });

  const result = client.parseNotification({
    headers: {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signature,
      'wechatpay-serial': publicKeyId
    },
    rawBody
  });

  assert.equal(result.id, 'EV-TRANSACTION-001');
  assert.equal(result.eventType, 'TRANSACTION.SUCCESS');
  assert.deepEqual(result.resource, transaction);
});

test('正式微信支付 Adapter 拒绝 Body 被篡改的通知', () => {
  const merchant = keyPair();
  const wechat = keyPair();
  const publicKeyId = 'PUB_KEY_ID_01111111111111111111111111111111';
  const timestamp = '1700000000';
  const nonce = 'wechat-notify-nonce';
  const signedBody = '{"id":"EV-ORIGINAL"}';
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${nonce}\n${signedBody}\n`),
    wechat.privateKey
  ).toString('base64');
  const { createWechatPayClient } = require('../cloudfunctions/payment/wechat-pay');
  const client = createWechatPayClient({
    config: {
      appid: 'wx373cd5ed5680a30d', mchid: '1900000109',
      merchantSerialNo: '7777777777777777777777777777777777777777',
      merchantPrivateKey: merchant.privateKey,
      wechatPayPublicKeyId: publicKeyId, wechatPayPublicKey: wechat.publicKey,
      apiV3Key: '0123456789abcdef0123456789abcdef',
      paymentNotifyUrl: 'https://example.com/payment/notify',
      refundNotifyUrl: 'https://example.com/refund/notify'
    },
    now: () => new Date(1700000000000),
    request: async () => { throw new Error('本测试不应发送 HTTP 请求'); }
  });

  assert.throws(() => client.parseNotification({
    headers: {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signature,
      'wechatpay-serial': publicKeyId
    },
    rawBody: '{"id":"EV-TAMPERED"}'
  }), /验签失败/);
});

test('正式微信支付 Adapter 按商户订单号主动查单并验签结果', async () => {
  const merchant = keyPair();
  const wechat = keyPair();
  const publicKeyId = 'PUB_KEY_ID_01111111111111111111111111111111';
  const requests = [];
  const body = JSON.stringify({
    appid: 'wx373cd5ed5680a30d', mchid: '1900000109',
    out_trade_no: 'BBX202607280001', transaction_id: '4200000000202607280001',
    trade_state: 'SUCCESS', amount: { total: 2500, payer_total: 2500, currency: 'CNY' },
    payer: { openid: 'openid-customer-a' }
  });
  const { createWechatPayClient } = require('../cloudfunctions/payment/wechat-pay');
  const client = createWechatPayClient({
    config: {
      appid: 'wx373cd5ed5680a30d', mchid: '1900000109',
      merchantSerialNo: '7777777777777777777777777777777777777777',
      merchantPrivateKey: merchant.privateKey,
      wechatPayPublicKeyId: publicKeyId, wechatPayPublicKey: wechat.publicKey,
      apiV3Key: '0123456789abcdef0123456789abcdef',
      paymentNotifyUrl: 'https://example.com/payment/notify',
      refundNotifyUrl: 'https://example.com/refund/notify'
    },
    now: () => new Date(1700000000000),
    createNonce: () => 'query-nonce',
    request: async (url, options) => {
      requests.push({ url, options });
      return signedResponse(wechat.privateKey, publicKeyId, body);
    }
  });

  const result = await client.queryTransaction('BBX202607280001');

  assert.equal(requests[0].url, 'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/BBX202607280001?mchid=1900000109');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.body, undefined);
  assert.equal(result.trade_state, 'SUCCESS');
  assert.equal(result.transaction_id, '4200000000202607280001');
});

test('正式微信支付 Adapter 关闭微信支付订单时提交商户号', async () => {
  const merchant = keyPair();
  const wechat = keyPair();
  const publicKeyId = 'PUB_KEY_ID_01111111111111111111111111111111';
  const requests = [];
  const { createWechatPayClient } = require('../cloudfunctions/payment/wechat-pay');
  const client = createWechatPayClient({
    config: {
      appid: 'wx373cd5ed5680a30d', mchid: '1900000109',
      merchantSerialNo: '7777777777777777777777777777777777777777',
      merchantPrivateKey: merchant.privateKey,
      wechatPayPublicKeyId: publicKeyId, wechatPayPublicKey: wechat.publicKey,
      apiV3Key: '0123456789abcdef0123456789abcdef',
      paymentNotifyUrl: 'https://example.com/payment/notify',
      refundNotifyUrl: 'https://example.com/refund/notify'
    },
    now: () => new Date(1700000000000),
    createNonce: () => 'close-nonce',
    request: async (url, options) => {
      requests.push({ url, options });
      return signedResponse(wechat.privateKey, publicKeyId, '');
    }
  });

  await client.closeTransaction('BBX202607280001');

  assert.equal(requests[0].url, 'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/BBX202607280001/close');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), { mchid: '1900000109' });
});

test('正式微信支付 Adapter 提交退款金额、原订单金额和退款通知地址', async () => {
  const merchant = keyPair();
  const wechat = keyPair();
  const publicKeyId = 'PUB_KEY_ID_01111111111111111111111111111111';
  const requests = [];
  const responseBody = JSON.stringify({
    refund_id: '5030000000202607280001',
    out_refund_no: 'BBXR202607280001',
    status: 'PROCESSING',
    amount: { refund: 1000, total: 2500, currency: 'CNY' }
  });
  const { createWechatPayClient } = require('../cloudfunctions/payment/wechat-pay');
  const client = createWechatPayClient({
    config: {
      appid: 'wx373cd5ed5680a30d', mchid: '1900000109',
      merchantSerialNo: '7777777777777777777777777777777777777777',
      merchantPrivateKey: merchant.privateKey,
      wechatPayPublicKeyId: publicKeyId, wechatPayPublicKey: wechat.publicKey,
      apiV3Key: '0123456789abcdef0123456789abcdef',
      paymentNotifyUrl: 'https://example.com/payment/notify',
      refundNotifyUrl: 'https://example.com/refund/notify'
    },
    now: () => new Date(1700000000000),
    createNonce: () => 'refund-nonce',
    request: async (url, options) => {
      requests.push({ url, options });
      return signedResponse(wechat.privateKey, publicKeyId, responseBody);
    }
  });

  const result = await client.createRefund({
    outTradeNo: 'BBX202607280001',
    outRefundNo: 'BBXR202607280001',
    reason: '顾客协商部分退款',
    amountCents: 1000,
    totalAmountCents: 2500
  });

  assert.equal(requests[0].url, 'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    out_trade_no: 'BBX202607280001',
    out_refund_no: 'BBXR202607280001',
    reason: '顾客协商部分退款',
    notify_url: 'https://example.com/refund/notify',
    amount: { refund: 1000, total: 2500, currency: 'CNY' }
  });
  assert.equal(result.status, 'PROCESSING');
});

test('正式微信支付 Adapter 按商户退款单号查询退款结果', async () => {
  const merchant = keyPair();
  const wechat = keyPair();
  const publicKeyId = 'PUB_KEY_ID_01111111111111111111111111111111';
  const requests = [];
  const responseBody = JSON.stringify({
    refund_id: '5030000000202607280001', out_refund_no: 'BBXR202607280001',
    status: 'SUCCESS', amount: { refund: 1000, total: 2500, currency: 'CNY' }
  });
  const { createWechatPayClient } = require('../cloudfunctions/payment/wechat-pay');
  const client = createWechatPayClient({
    config: {
      appid: 'wx373cd5ed5680a30d', mchid: '1900000109',
      merchantSerialNo: '7777777777777777777777777777777777777777',
      merchantPrivateKey: merchant.privateKey,
      wechatPayPublicKeyId: publicKeyId, wechatPayPublicKey: wechat.publicKey,
      apiV3Key: '0123456789abcdef0123456789abcdef',
      paymentNotifyUrl: 'https://example.com/payment/notify',
      refundNotifyUrl: 'https://example.com/refund/notify'
    },
    now: () => new Date(1700000000000),
    createNonce: () => 'refund-query-nonce',
    request: async (url, options) => {
      requests.push({ url, options });
      return signedResponse(wechat.privateKey, publicKeyId, responseBody);
    }
  });

  const result = await client.queryRefund('BBXR202607280001');

  assert.equal(requests[0].url, 'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds/BBXR202607280001');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(result.status, 'SUCCESS');
});

test('正式微信支付 Adapter 下载交易账单并在返回前校验 SHA1', async () => {
  const merchant = keyPair();
  const wechat = keyPair();
  const publicKeyId = 'PUB_KEY_ID_01111111111111111111111111111111';
  const bill = '交易时间,微信订单号,商户订单号,订单金额\n`2026-07-27 16:01:00,`4200000000202607270001,`BBX202607270001,`25.00\n';
  const billHash = crypto.createHash('sha1').update(Buffer.from(bill)).digest('hex');
  const metadata = JSON.stringify({
    hash_type: 'SHA1',
    hash_value: billHash,
    download_url: 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=short-lived'
  });
  const requests = [];
  const { createWechatPayClient } = require('../cloudfunctions/payment/wechat-pay');
  const client = createWechatPayClient({
    config: {
      appid: 'wx373cd5ed5680a30d', mchid: '1900000109',
      merchantSerialNo: '7777777777777777777777777777777777777777',
      merchantPrivateKey: merchant.privateKey,
      wechatPayPublicKeyId: publicKeyId, wechatPayPublicKey: wechat.publicKey,
      apiV3Key: '0123456789abcdef0123456789abcdef',
      paymentNotifyUrl: 'https://example.com/payment/notify',
      refundNotifyUrl: 'https://example.com/refund/notify'
    },
    now: () => new Date(1700000000000),
    createNonce: () => 'bill-nonce',
    request: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) return signedResponse(wechat.privateKey, publicKeyId, metadata);
      return {
        status: 200,
        headers: { get: () => null },
        async text() { return bill; }
      };
    }
  });

  const result = await client.downloadTradeBill('2026-07-27');

  assert.equal(requests[0].url, 'https://api.mch.weixin.qq.com/v3/bill/tradebill?bill_date=2026-07-27&bill_type=ALL');
  assert.equal(requests[1].url, 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=short-lived');
  assert.equal(result.hashType, 'SHA1');
  assert.equal(result.hashValue, billHash);
  assert.equal(result.content, bill);
});
