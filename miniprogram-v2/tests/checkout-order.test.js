const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function success(data) {
  return { success: true, data, requestId: '' };
}

function checkoutService(overrides = {}) {
  return Object.assign({
    id: 'service-val-pro',
    code: 'VAL_PRO',
    name: '钻石段位技术陪',
    priceCents: 3500,
    minQuantity: 1,
    maxQuantity: 99,
    unit: 'ROUND',
    unitLabel: '局',
    purchasable: true,
    platforms: ['PC'],
    regions: [{ code: 'CN', name: '无畏契约国服', status: 'ACTIVE' }],
    orderFields: [],
    fulfillmentStandard: '按订单约定完成服务',
    purchaseNotice: '仅限成年人下单'
  }, overrides);
}

function loadCheckout(responder) {
  const calls = [];
  const storage = new Map(Object.entries({
    bbx_current_user: {
      id: 'user-a',
      platformUserNo: 'BBX-TEST-A',
      nickname: '微信用户',
      avatarFileId: null
    },
    bbx_selected_service: {
      id: 'service-val-pro',
      code: 'VAL_PRO',
      source: 'service-detail'
    }
  }));
  global.wx = {
    cloud: {
      async callFunction(params) {
        calls.push({ type: 'callFunction', name: params.name, data: params.data });
        return { result: await responder(params.name, params.data) };
      }
    },
    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : '';
    },
    setStorageSync(key, value) {
      storage.set(key, value);
    },
    removeStorageSync(key) {
      storage.delete(key);
    },
    navigateTo({ url }) {
      calls.push({ type: 'navigateTo', url });
    },
    redirectTo({ url }) {
      calls.push({ type: 'redirectTo', url });
    },
    switchTab({ url }) {
      calls.push({ type: 'switchTab', url });
    },
    showToast() {}
  };
  global.getCurrentPages = () => [{}, {}];
  let definition;
  global.Page = (page) => {
    definition = page;
  };
  const absolutePath = path.join(root, 'pages/checkout/checkout.js');
  delete require.cache[require.resolve(absolutePath)];
  require(absolutePath);
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) {
      Object.assign(this.data, update);
    }
  });
  return { page, calls, storage };
}

test('确认订单数量变化后展示云函数重新计算的当前套餐金额', async () => {
  const result = loadCheckout((name, data) => {
    if (name === 'catalog') {
      assert.equal(data.action, 'service.detail');
      return success({ service: checkoutService() });
    }
    assert.equal(name, 'order');
    assert.equal(data.action, 'quote');
    const quantity = data.payload.quantity;
    return success({
      quote: {
        serviceId: 'service-val-pro',
        quantity,
        unitPriceCents: 3500,
        payableAmountCents: quantity === 1 ? 3500 : 7100
      }
    });
  });

  await result.page.onLoad();
  await result.page.onStep({ currentTarget: { dataset: { step: 1 } } });

  assert.equal(result.page.data.qty, 2);
  assert.equal(result.page.data.total, 71);
  assert.equal(
    result.calls.filter((call) => call.name === 'order' && call.data.action === 'quote').length,
    2
  );
});

test('确认订单提交当前表单并保存云端创建的真实服务订单', async () => {
  const result = loadCheckout((name, data) => {
    if (name === 'catalog') return success({ service: checkoutService() });
    if (data.action === 'quote') {
      return success({
        quote: {
          serviceId: 'service-val-pro',
          quantity: data.payload.quantity,
          unitPriceCents: 3500,
          payableAmountCents: 3500
        }
      });
    }
    assert.equal(name, 'order');
    assert.equal(data.action, 'create');
    assert.match(data.idempotencyKey, /^checkout-/);
    assert.deepEqual(data.payload, {
      serviceId: 'service-val-pro',
      quantity: 1,
      orderValues: {
        platform: 'PC',
        region: 'CN',
        gameId: 'CloudPlayer',
        serviceMode: 'IMMEDIATE',
        scheduledAt: '',
        customerNote: '希望轻松交流',
        adultConfirmed: 'CONFIRMED'
      }
    });
    return success({
      reused: false,
      order: {
        id: 'order-cloud-1',
        orderNo: 'BBX-20260727-000001',
        serviceId: 'service-val-pro',
        quantity: 1,
        unitPriceCents: 3500,
        payableAmountCents: 3500,
        paymentStatus: 'UNPAID',
        fulfillmentStatus: 'NOT_STARTED',
        afterSalesStatus: 'NONE',
        snapshot: {
          service: { name: '钻石段位技术陪', unitLabel: '局' },
          fulfillmentStandard: '按订单约定完成服务'
        }
      }
    });
  });

  await result.page.onLoad();
  result.page.onServerChange({ detail: { value: 0 } });
  result.page.onIdInput({ detail: { value: 'CloudPlayer' } });
  result.page.onNoteInput({ detail: { value: '希望轻松交流' } });
  result.page.toggleAdult();
  await result.page.onPay();

  assert.equal(result.page.data.paying, false);
  assert.equal(result.storage.get('bbx_last_order').orderNo, 'BBX-20260727-000001');
  assert.deepEqual(result.calls.at(-1), {
    type: 'redirectTo',
    url: '/pages/payment-result/payment-result'
  });
});

test('确认订单按套餐配置允许省略非必填的区服和游戏文字 ID', async () => {
  const orderFields = [
    { key: 'platform', label: '游戏平台', type: 'SINGLE', required: true },
    { key: 'region', label: '游戏区服', type: 'SINGLE', required: false },
    { key: 'gameId', label: '游戏文字 ID', type: 'TEXT', required: false },
    { key: 'serviceMode', label: '服务时间', type: 'SINGLE', required: true },
    { key: 'scheduledAt', label: '预约时间', type: 'DATETIME', required: false },
    { key: 'customerNote', label: '点单备注', type: 'TEXT', required: false },
    { key: 'adultConfirmed', label: '成年确认', type: 'SINGLE', required: true }
  ];
  const result = loadCheckout((name, data) => {
    if (name === 'catalog') {
      return success({ service: checkoutService({ orderFields }) });
    }
    if (data.action === 'quote') {
      return success({ quote: { payableAmountCents: 3500 } });
    }
    assert.equal(data.action, 'create');
    assert.equal(data.payload.orderValues.region, '');
    assert.equal(data.payload.orderValues.gameId, '');
    return success({
      reused: false,
      order: {
        id: 'order-cloud-optional',
        orderNo: 'BBX-20260727-OPTIONAL',
        quantity: 1,
        unitPriceCents: 3500,
        payableAmountCents: 3500,
        snapshot: {
          service: { name: '钻石段位技术陪', unitLabel: '局' },
          fulfillmentStandard: '按订单约定完成服务'
        }
      }
    });
  });

  await result.page.onLoad();
  result.page.toggleAdult();
  await result.page.onPay();

  assert.equal(
    result.calls.some((call) => call.name === 'order' && call.data.action === 'create'),
    true
  );
  assert.equal(result.page.data.error, '');
});
