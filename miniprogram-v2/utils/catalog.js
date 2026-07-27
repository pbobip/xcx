function requestId() {
  return `catalog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function call(action, payload = {}) {
  const response = await wx.cloud.callFunction({
    name: 'catalog',
    data: { action, payload, requestId: requestId() }
  });
  const result = response && response.result;
  if (!result || result.success !== true) {
    const error = result && result.error;
    const failure = new Error((error && error.message) || '目录加载失败，请稍后重试');
    failure.code = (error && error.code) || 'INTERNAL_ERROR';
    throw failure;
  }
  return result.data;
}

function formatPrice(priceCents, unitLabel) {
  const cents = Number(priceCents) || 0;
  const amount = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  return `¥${amount}/${unitLabel || '份'}`;
}

function mergeUnique(existing, incoming) {
  const result = existing.slice();
  const ids = new Set(result.map((item) => item.id));
  for (const item of incoming) {
    if (!ids.has(item.id)) {
      ids.add(item.id);
      result.push(item);
    }
  }
  return result;
}

module.exports = { call, formatPrice, mergeUnique };
