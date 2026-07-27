const test = require('node:test');
const assert = require('node:assert/strict');

function clone(value) {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function createMemoryCloud(seed, openid = 'openid-customer-a') {
  const data = Object.fromEntries(
    Object.entries(seed).map(([name, records]) => [name, records.map(clone)])
  );
  let nextId = 1;

  function matches(record, query) {
    return Object.entries(query || {}).every(([key, value]) => record[key] === value);
  }

  function collection(name) {
    if (!data[name]) data[name] = [];
    return {
      where(query) {
        let limit = Infinity;
        return {
          limit(count) {
            limit = count;
            return this;
          },
          async get() {
            return { data: data[name].filter((record) => matches(record, query)).slice(0, limit).map(clone) };
          }
        };
      },
      doc(id) {
        return {
          async get() {
            return { data: clone(data[name].find((record) => record._id === id) || null) };
          }
        };
      },
      async add({ data: record }) {
        const _id = `${name}-${nextId++}`;
        data[name].push(Object.assign({ _id }, clone(record)));
        return { _id };
      }
    };
  }

  const database = {
    collection,
    async runTransaction(callback) {
      return callback({ collection });
    }
  };

  return {
    database() {
      return database;
    },
    getWXContext() {
      return { OPENID: openid };
    },
    updateRecord(name, id, update) {
      const record = (data[name] || []).find((item) => item._id === id);
      Object.assign(record, clone(update));
    }
  };
}

function service(overrides = {}) {
  return Object.assign({
    _id: 'service-val-pro',
    code: 'VAL_PRO',
    name: '钻石段位技术陪',
    gameId: 'game-valorant',
    serviceTypeId: 'type-companion',
    categoryIds: ['category-game-valorant'],
    unit: 'ROUND',
    unitLabel: '局',
    priceCents: 3500,
    minQuantity: 1,
    maxQuantity: 99,
    status: 'ACTIVE',
    platforms: ['PC'],
    regions: [{ code: 'CN', name: '无畏契约国服', status: 'ACTIVE' }],
    orderFields: [],
    fulfillmentStandard: '按订单约定完成服务',
    purchaseNotice: '仅限成年人下单',
    descriptionBlocks: [],
    version: 3,
    isTest: true
  }, overrides);
}

function customer() {
  return {
    _id: 'user-a',
    openid: 'openid-customer-a',
    status: 'ACTIVE',
    platformUserNo: 'BBX-TEST-A'
  };
}

function requiredOrderFields() {
  return [
    { key: 'platform', label: '游戏平台', type: 'SINGLE', required: true, options: [{ value: 'PC', label: '电脑端' }] },
    { key: 'region', label: '游戏区服', type: 'SINGLE', required: true, options: [{ value: 'CN', label: '无畏契约国服' }] },
    { key: 'gameId', label: '游戏文字 ID', type: 'TEXT', required: true, validation: { minLength: 1, maxLength: 40, rejectSensitiveCredentials: true } },
    { key: 'serviceMode', label: '服务时间', type: 'SINGLE', required: true, options: [{ value: 'IMMEDIATE', label: '立即服务' }, { value: 'RESERVATION', label: '预约时间' }] },
    { key: 'scheduledAt', label: '预约时间', type: 'DATETIME', required: false, validation: { requiredWhen: { field: 'serviceMode', equals: 'RESERVATION' } } },
    { key: 'customerNote', label: '点单备注', type: 'TEXT', required: false, validation: { maxLength: 200, rejectSensitiveCredentials: true } },
    { key: 'adultConfirmed', label: '成年确认', type: 'SINGLE', required: true, options: [{ value: 'CONFIRMED', label: '本人已成年' }] }
  ];
}

function validCreatePayload(overrides = {}) {
  return Object.assign({
    serviceId: 'service-val-pro',
    quantity: 2,
    orderValues: {
      platform: 'PC',
      region: 'CN',
      gameId: 'CloudPlayer',
      serviceMode: 'IMMEDIATE',
      scheduledAt: '',
      customerNote: '希望轻松交流',
      adultConfirmed: 'CONFIRMED'
    }
  }, overrides);
}

test('顾客报价由云端套餐单价和数量计算，不接受客户端金额', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({ users: [customer()], services: [service()] });
  const main = createOrderHandler({ cloud });

  const result = await main({
    action: 'quote',
    payload: {
      serviceId: 'service-val-pro',
      quantity: 2,
      payableAmountCents: 1
    },
    requestId: 'quote-1'
  });

  assert.deepEqual(result, {
    success: true,
    data: {
      quote: {
        serviceId: 'service-val-pro',
        serviceCode: 'VAL_PRO',
        serviceName: '钻石段位技术陪',
        unit: 'ROUND',
        unitLabel: '局',
        quantity: 2,
        unitPriceCents: 3500,
        originalAmountCents: 7000,
        discountAmountCents: 0,
        payableAmountCents: 7000
      }
    },
    requestId: 'quote-1'
  });
});

test('顾客创建未付款服务订单并保存不可变下单快照', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service({ orderFields: requiredOrderFields() })],
    orders: [],
    order_logs: []
  });
  const now = new Date('2026-07-27T08:00:00.000Z');
  const main = createOrderHandler({
    cloud,
    now: () => now,
    createOrderNo: () => 'BBX-20260727-000001'
  });

  const result = await main({
    action: 'create',
    payload: Object.assign(validCreatePayload(), { payableAmountCents: 1 }),
    idempotencyKey: 'checkout-attempt-1',
    requestId: 'create-1'
  });

  assert.equal(result.success, true);
  assert.equal(result.data.reused, false);
  assert.deepEqual(result.data.order, {
    id: 'orders-1',
    orderNo: 'BBX-20260727-000001',
    serviceId: 'service-val-pro',
    quantity: 2,
    unitPriceCents: 3500,
    originalAmountCents: 7000,
    discountAmountCents: 0,
    payableAmountCents: 7000,
    paidAmountCents: 0,
    paymentStatus: 'UNPAID',
    fulfillmentStatus: 'NOT_STARTED',
    afterSalesStatus: 'NONE',
    serviceMode: 'IMMEDIATE',
    scheduledAt: null,
    createdAt: now,
    version: 1,
    snapshot: {
      service: {
        id: 'service-val-pro',
        code: 'VAL_PRO',
        name: '钻石段位技术陪',
        gameId: 'game-valorant',
        serviceTypeId: 'type-companion',
        categoryIds: ['category-game-valorant'],
        unit: 'ROUND',
        unitLabel: '局',
        descriptionBlocks: []
      },
      pricing: {
        quantity: 2,
        unitPriceCents: 3500,
        originalAmountCents: 7000,
        discountAmountCents: 0,
        payableAmountCents: 7000
      },
      orderFields: requiredOrderFields(),
      orderValues: validCreatePayload().orderValues,
      fulfillmentStandard: '按订单约定完成服务',
      purchaseNotice: '仅限成年人下单',
      agreement: {
        type: 'SERVICE_RULES',
        version: 'development-v1',
        title: '开发占位服务规则',
        content: '本人已成年，并已阅读换人、售后、退款与账号安全规则。',
        isDevelopmentPlaceholder: true
      }
    }
  });
});

test('相同顾客以同一幂等键重复创建时返回原服务订单', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service({ orderFields: requiredOrderFields() })],
    orders: [],
    order_logs: []
  });
  const main = createOrderHandler({
    cloud,
    now: () => new Date('2026-07-27T08:00:00.000Z'),
    createOrderNo: () => 'BBX-20260727-000001'
  });
  const event = {
    action: 'create',
    payload: validCreatePayload(),
    idempotencyKey: 'checkout-retry-1',
    requestId: 'create-retry'
  };

  const first = await main(event);
  const repeated = await main(event);

  assert.equal(first.success, true);
  assert.equal(repeated.success, true);
  assert.equal(repeated.data.reused, true);
  assert.equal(repeated.data.order.id, first.data.order.id);
  assert.equal(repeated.data.order.orderNo, first.data.order.orderNo);
});

test('套餐后续暂停或改价不影响同一请求返回原服务订单', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service({ orderFields: requiredOrderFields() })],
    orders: [],
    order_logs: []
  });
  const main = createOrderHandler({
    cloud,
    now: () => new Date('2026-07-27T08:00:00.000Z'),
    createOrderNo: () => 'BBX-20260727-000001'
  });
  const event = {
    action: 'create',
    payload: validCreatePayload(),
    idempotencyKey: 'checkout-after-change',
    requestId: 'retry-after-change'
  };
  const first = await main(event);
  cloud.updateRecord('services', 'service-val-pro', {
    status: 'PAUSED',
    priceCents: 9900,
    orderFields: []
  });

  const repeated = await main(event);

  assert.equal(repeated.success, true);
  assert.equal(repeated.data.reused, true);
  assert.equal(repeated.data.order.id, first.data.order.id);
  assert.equal(repeated.data.order.payableAmountCents, 7000);
});

test('同一幂等键提交不同内容时拒绝创建第二张服务订单', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service({ orderFields: requiredOrderFields() })],
    orders: [],
    order_logs: []
  });
  const main = createOrderHandler({
    cloud,
    createOrderNo: () => 'BBX-20260727-000001'
  });
  await main({
    action: 'create',
    payload: validCreatePayload(),
    idempotencyKey: 'checkout-conflict-1'
  });

  const conflict = await main({
    action: 'create',
    payload: validCreatePayload({ quantity: 3 }),
    idempotencyKey: 'checkout-conflict-1'
  });

  assert.equal(conflict.success, false);
  assert.equal(conflict.error.code, 'DUPLICATE_REQUEST');
});

test('缺少成年确认时不能创建服务订单', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service({ orderFields: requiredOrderFields() })],
    orders: [],
    order_logs: []
  });
  const main = createOrderHandler({ cloud });
  const withoutAdult = validCreatePayload();
  withoutAdult.orderValues.adultConfirmed = '';
  const adultResult = await main({
    action: 'create',
    payload: withoutAdult,
    idempotencyKey: 'missing-adult'
  });
  assert.equal(adultResult.error.code, 'INVALID_ARGUMENT');
  assert.match(adultResult.error.message, /成年确认/);
});

test('预约模式缺少预约时间时不能创建服务订单', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service({ orderFields: requiredOrderFields() })],
    orders: [],
    order_logs: []
  });
  const main = createOrderHandler({ cloud });
  const withoutSchedule = validCreatePayload();
  withoutSchedule.orderValues.serviceMode = 'RESERVATION';

  const scheduleResult = await main({
    action: 'create',
    payload: withoutSchedule,
    idempotencyKey: 'missing-schedule'
  });

  assert.equal(scheduleResult.error.code, 'INVALID_ARGUMENT');
  assert.match(scheduleResult.error.message, /预约时间/);
});

test('游戏文字 ID 或备注包含敏感凭证时拒绝创建服务订单', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service({ orderFields: requiredOrderFields() })],
    orders: [],
    order_logs: []
  });
  const main = createOrderHandler({ cloud });
  const payload = validCreatePayload();
  payload.orderValues.customerNote = '我的验证码是 123456';

  const result = await main({
    action: 'create',
    payload,
    idempotencyKey: 'sensitive-note'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'SENSITIVE_CONTENT');
  assert.doesNotMatch(JSON.stringify(result), /123456/);
});

test('暂停接单套餐不能报价或创建服务订单', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service({ status: 'PAUSED', orderFields: requiredOrderFields() })]
  });
  const main = createOrderHandler({ cloud });

  const result = await main({
    action: 'quote',
    payload: { serviceId: 'service-val-pro', quantity: 1 }
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'SERVICE_PAUSED');
});
