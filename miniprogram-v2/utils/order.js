function requestId() {
  return `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function idempotencyKey() {
  return `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function call(action, payload = {}, options = {}) {
  const data = { action, payload, requestId: requestId() };
  if (options.idempotencyKey) data.idempotencyKey = options.idempotencyKey;
  const response = await wx.cloud.callFunction({ name: 'order', data });
  const result = response && response.result;
  if (!result || result.success !== true) {
    const error = result && result.error;
    const failure = new Error((error && error.message) || '服务订单处理失败，请稍后重试');
    failure.code = (error && error.code) || 'INTERNAL_ERROR';
    throw failure;
  }
  return result.data;
}

module.exports = { call, idempotencyKey };
