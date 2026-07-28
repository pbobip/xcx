function requestId() {
  return `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function call(action, payload = {}, options = {}) {
  const data = { action, payload, requestId: requestId() };
  if (options.idempotencyKey) data.idempotencyKey = options.idempotencyKey;
  const response = await wx.cloud.callFunction({ name: 'payment', data });
  const result = response && response.result;
  if (!result || result.success !== true) {
    const error = result && result.error;
    const failure = new Error((error && error.message) || '支付处理失败，请稍后重试');
    failure.code = (error && error.code) || 'INTERNAL_ERROR';
    throw failure;
  }
  return result.data;
}

function requestWechatPayment(params) {
  return new Promise((resolve, reject) => {
    wx.requestPayment(Object.assign({}, params, {
      success: resolve,
      fail: reject
    }));
  });
}

module.exports = { call, requestWechatPayment };
