const crypto = require('node:crypto');

const WECHAT_PAY_BASE_URL = 'https://api.mch.weixin.qq.com';

function required(config, key) {
  const value = config && config[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少微信支付安全配置：${key}`);
  }
  return value;
}

function validateConfig(config) {
  [
    'appid',
    'mchid',
    'merchantSerialNo',
    'merchantPrivateKey',
    'wechatPayPublicKeyId',
    'wechatPayPublicKey',
    'apiV3Key',
    'paymentNotifyUrl',
    'refundNotifyUrl'
  ].forEach((key) => required(config, key));
  if (Buffer.byteLength(config.apiV3Key, 'utf8') !== 32) {
    throw new Error('微信支付 APIv3 密钥必须为 32 字节');
  }
}

function timestampSeconds(value) {
  return String(Math.floor(value.getTime() / 1000));
}

function rfc3339(value) {
  return value.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

function sign(privateKey, message) {
  return crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64');
}

function verify(publicKey, message, signature) {
  try {
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(message),
      publicKey,
      Buffer.from(signature, 'base64')
    );
  } catch (_) {
    return false;
  }
}

function authorization(config, method, pathWithQuery, timestamp, nonce, body) {
  const message = `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = sign(config.merchantPrivateKey, message);
  return 'WECHATPAY2-SHA256-RSA2048 ' + [
    `mchid="${config.mchid}"`,
    `nonce_str="${nonce}"`,
    `signature="${signature}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${config.merchantSerialNo}"`
  ].join(',');
}

async function responseBody(response) {
  const rawBody = await response.text();
  if (!rawBody) return { rawBody, data: {} };
  try {
    return { rawBody, data: JSON.parse(rawBody) };
  } catch (_) {
    throw new Error('微信支付返回了无法解析的响应');
  }
}

function verifyResponse(config, response, rawBody) {
  const timestamp = response.headers.get('wechatpay-timestamp');
  const nonce = response.headers.get('wechatpay-nonce');
  const signature = response.headers.get('wechatpay-signature');
  const serial = response.headers.get('wechatpay-serial');
  if (!timestamp || !nonce || !signature || !serial) {
    throw new Error('微信支付响应缺少验签头');
  }
  if (serial !== config.wechatPayPublicKeyId) {
    throw new Error('微信支付响应公钥 ID 不匹配');
  }
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  if (!verify(config.wechatPayPublicKey, message, signature)) {
    throw new Error('微信支付响应验签失败');
  }
}

function defaultNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function header(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const target = name.toLowerCase();
  const matched = Object.keys(headers).find((key) => key.toLowerCase() === target);
  return matched ? String(headers[matched]) : '';
}

function decryptResource(apiV3Key, resource) {
  if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error('微信支付通知使用了不支持的加密算法');
  }
  const encrypted = Buffer.from(resource.ciphertext || '', 'base64');
  if (encrypted.length <= 16) throw new Error('微信支付通知密文无效');
  const data = encrypted.subarray(0, encrypted.length - 16);
  const authTag = encrypted.subarray(encrypted.length - 16);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key, 'utf8'),
    Buffer.from(resource.nonce || '', 'utf8')
  );
  decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
  decipher.setAuthTag(authTag);
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (_) {
    throw new Error('微信支付通知解密失败');
  }
  try {
    return JSON.parse(plaintext);
  } catch (_) {
    throw new Error('微信支付通知明文无法解析');
  }
}

function createWechatPayClient({
  config,
  request = globalThis.fetch,
  now = () => new Date(),
  createNonce = defaultNonce
}) {
  validateConfig(config);
  if (typeof request !== 'function') throw new Error('缺少微信支付 HTTP 请求实现');

  async function apiRequest(method, pathWithQuery, payload) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = timestampSeconds(now());
    const nonce = createNonce();
    const response = await request(`${WECHAT_PAY_BASE_URL}${pathWithQuery}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization(config, method, pathWithQuery, timestamp, nonce, body)
      },
      body: body || undefined
    });
    const result = await responseBody(response);
    verifyResponse(config, response, result.rawBody);
    if (response.status < 200 || response.status >= 300) {
      const error = new Error(result.data.message || '微信支付请求失败');
      error.code = result.data.code || 'WECHAT_PAY_ERROR';
      error.status = response.status;
      throw error;
    }
    return result.data;
  }

  async function createJsapiPayment(input) {
    const data = await apiRequest('POST', '/v3/pay/transactions/jsapi', {
      appid: config.appid,
      mchid: config.mchid,
      description: input.description,
      out_trade_no: input.outTradeNo,
      time_expire: rfc3339(input.expiresAt),
      notify_url: config.paymentNotifyUrl,
      amount: { total: input.amountCents, currency: 'CNY' },
      payer: { openid: input.openid }
    });
    if (!data.prepay_id) throw new Error('微信支付预支付响应缺少 prepay_id');
    const timeStamp = timestampSeconds(now());
    const nonceStr = createNonce();
    const packageValue = `prepay_id=${data.prepay_id}`;
    const message = `${config.appid}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
    return {
      prepayId: data.prepay_id,
      paymentParams: {
        timeStamp,
        nonceStr,
        package: packageValue,
        signType: 'RSA',
        paySign: sign(config.merchantPrivateKey, message)
      }
    };
  }

  function parseNotification({ headers, rawBody }) {
    if (typeof rawBody !== 'string' || !rawBody) throw new Error('微信支付通知缺少原始 Body');
    const timestamp = header(headers, 'wechatpay-timestamp');
    const nonce = header(headers, 'wechatpay-nonce');
    const signature = header(headers, 'wechatpay-signature');
    const serial = header(headers, 'wechatpay-serial');
    if (!timestamp || !nonce || !signature || !serial) {
      throw new Error('微信支付通知缺少验签头');
    }
    if (serial !== config.wechatPayPublicKeyId) {
      throw new Error('微信支付通知公钥 ID 不匹配');
    }
    const notificationTime = Number(timestamp) * 1000;
    if (!Number.isFinite(notificationTime) || Math.abs(now().getTime() - notificationTime) > 300000) {
      throw new Error('微信支付通知时间戳已过期');
    }
    if (!verify(
      config.wechatPayPublicKey,
      `${timestamp}\n${nonce}\n${rawBody}\n`,
      signature
    )) {
      throw new Error('微信支付通知验签失败');
    }
    let envelope;
    try {
      envelope = JSON.parse(rawBody);
    } catch (_) {
      throw new Error('微信支付通知 Body 无法解析');
    }
    return {
      id: envelope.id,
      createTime: envelope.create_time,
      eventType: envelope.event_type,
      summary: envelope.summary || '',
      resource: decryptResource(config.apiV3Key, envelope.resource)
    };
  }

  async function queryTransaction(outTradeNo) {
    const tradeNo = encodeURIComponent(outTradeNo);
    const mchid = encodeURIComponent(config.mchid);
    return apiRequest(
      'GET',
      `/v3/pay/transactions/out-trade-no/${tradeNo}?mchid=${mchid}`
    );
  }

  async function closeTransaction(outTradeNo) {
    const tradeNo = encodeURIComponent(outTradeNo);
    await apiRequest(
      'POST',
      `/v3/pay/transactions/out-trade-no/${tradeNo}/close`,
      { mchid: config.mchid }
    );
  }

  async function createRefund(input) {
    return apiRequest('POST', '/v3/refund/domestic/refunds', {
      out_trade_no: input.outTradeNo,
      out_refund_no: input.outRefundNo,
      reason: input.reason,
      notify_url: config.refundNotifyUrl,
      amount: {
        refund: input.amountCents,
        total: input.totalAmountCents,
        currency: 'CNY'
      }
    });
  }

  async function queryRefund(outRefundNo) {
    return apiRequest(
      'GET',
      `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`
    );
  }

  async function downloadTradeBill(billDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) throw new Error('交易账单日期格式无效');
    const metadata = await apiRequest(
      'GET',
      `/v3/bill/tradebill?bill_date=${billDate}&bill_type=ALL`
    );
    if (
      metadata.hash_type !== 'SHA1' ||
      typeof metadata.hash_value !== 'string' ||
      typeof metadata.download_url !== 'string'
    ) {
      throw new Error('微信支付交易账单下载信息无效');
    }
    const response = await request(metadata.download_url, {
      method: 'GET',
      headers: { Accept: 'text/plain' }
    });
    const content = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw new Error('微信支付交易账单下载失败');
    }
    const actualHash = crypto.createHash('sha1').update(Buffer.from(content)).digest('hex');
    if (actualHash.toLowerCase() !== metadata.hash_value.toLowerCase()) {
      throw new Error('微信支付交易账单 SHA1 校验失败');
    }
    return {
      hashType: metadata.hash_type,
      hashValue: metadata.hash_value,
      content
    };
  }

  return {
    createJsapiPayment,
    parseNotification,
    queryTransaction,
    closeTransaction,
    createRefund,
    queryRefund,
    downloadTradeBill
  };
}

module.exports = { createWechatPayClient };
