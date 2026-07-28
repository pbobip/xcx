function value(env, name) {
  const result = env[name];
  if (typeof result !== 'string' || !result.trim()) {
    throw new Error(`缺少微信支付云端安全配置：${name}`);
  }
  return result.trim();
}

function pem(env, name) {
  return value(env, name).replace(/\\n/g, '\n');
}

function loadWechatPayConfig(env = process.env) {
  return {
    appid: env.WECHAT_PAY_APPID || 'wx373cd5ed5680a30d',
    mchid: value(env, 'WECHAT_PAY_MCHID'),
    merchantSerialNo: value(env, 'WECHAT_PAY_MERCHANT_SERIAL_NO'),
    merchantPrivateKey: pem(env, 'WECHAT_PAY_PRIVATE_KEY'),
    apiV3Key: value(env, 'WECHAT_PAY_API_V3_KEY'),
    wechatPayPublicKeyId: value(env, 'WECHAT_PAY_PUBLIC_KEY_ID'),
    wechatPayPublicKey: pem(env, 'WECHAT_PAY_PUBLIC_KEY'),
    paymentNotifyUrl: value(env, 'WECHAT_PAY_NOTIFY_URL'),
    refundNotifyUrl: value(env, 'WECHAT_REFUND_NOTIFY_URL')
  };
}

module.exports = { loadWechatPayConfig };
