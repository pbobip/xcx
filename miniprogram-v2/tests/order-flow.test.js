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
    if (query && query.$or) return query.$or.some(q => matches(record, q));
    return Object.entries(query || {}).every(([key, value]) => {
      if (value && typeof value === 'object' && value.$in) return value.$in.includes(record[key]);
      if (value && typeof value === 'object' && value.$neq !== undefined) return record[key] !== value.$neq;
      return record[key] === value;
    });
  }

  function collection(name) {
    if (!data[name]) data[name] = [];
    return {
      where(query) {
        let limit = Infinity;
        let skip = 0;
        let order = [];
        return {
          limit(count) { limit = count; return this; },
          skip(count) { skip = count; return this; },
          orderBy(field, dir) { order.push({field, dir}); return this; },
          async count() {
            return { total: data[name].filter((record) => matches(record, query)).length };
          },
          async get() {
            let filtered = data[name].filter((record) => matches(record, query));
            for (let i = order.length - 1; i >= 0; i--) {
              const { field, dir } = order[i];
              filtered.sort((a, b) => {
                if (a[field] < b[field]) return dir === 'desc' ? 1 : -1;
                if (a[field] > b[field]) return dir === 'desc' ? -1 : 1;
                return 0;
              });
            }
            return { data: filtered.slice(skip, skip + limit).map(clone) };
          }
        };
      },
      doc(id) {
        return {
          async get() {
            return { data: clone(data[name].find((record) => record._id === id) || null) };
          },
          async update({ data: updateData }) {
            const record = data[name].find((record) => record._id === id);
            if (!record) return { stats: { updated: 0 } };
            Object.assign(record, clone(updateData));
            return { stats: { updated: 1 } };
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
    command: {
      in: (arr) => ({ $in: arr }),
      neq: (val) => ({ $neq: val }),
      or: (arr) => ({ $or: arr })
    },
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

function couponTemplate(overrides = {}) {
  return Object.assign({
    _id: 'template-threshold',
    code: 'OVER_50_MINUS_10',
    name: '满 50 减 10 元',
    type: 'THRESHOLD',
    discountCents: 1000,
    thresholdCents: 5000,
    gameIds: [],
    categoryIds: [],
    serviceIds: [],
    validFrom: new Date('2026-07-01T00:00:00.000Z'),
    validTo: new Date('2026-08-31T23:59:59.000Z'),
    status: 'ACTIVE'
  }, overrides);
}

function customerCoupon(id, template, overrides = {}) {
  return Object.assign({
    _id: id,
    userId: 'user-a',
    templateId: template._id,
    status: 'AVAILABLE',
    validFrom: template.validFrom,
    validTo: template.validTo
  }, overrides);
}

function createCouponOrderFixture(options = {}) {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const template = options.template || couponTemplate();
  const coupons = options.coupons || [customerCoupon('coupon-own', template)];
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service({ orderFields: requiredOrderFields() })],
    coupon_templates: [template],
    user_coupons: coupons,
    orders: [],
    order_logs: []
  });
  let orderSequence = 0;
  const main = createOrderHandler({
    cloud,
    now: options.now || (() => new Date('2026-07-28T00:00:00.000Z')),
    createOrderNo: () => `BBX-COUPON-${++orderSequence}`
  });
  return { cloud, main, template };
}

test('顾客只能查看自己的未使用优惠券并获得模板快照', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    coupon_templates: [{
      _id: 'template-newcomer',
      code: 'NEWCOMER_10',
      name: '新人立减 10 元',
      type: 'FIXED',
      discountCents: 1000,
      thresholdCents: 0,
      gameIds: [],
      categoryIds: [],
      serviceIds: [],
      status: 'ACTIVE'
    }],
    user_coupons: [
      {
        _id: 'coupon-a',
        userId: 'user-a',
        templateId: 'template-newcomer',
        status: 'AVAILABLE',
        validFrom: new Date('2026-07-01T00:00:00.000Z'),
        validTo: new Date('2026-08-01T00:00:00.000Z')
      },
      {
        _id: 'coupon-b',
        userId: 'user-b',
        templateId: 'template-newcomer',
        status: 'AVAILABLE',
        validFrom: new Date('2026-07-01T00:00:00.000Z'),
        validTo: new Date('2026-08-01T00:00:00.000Z')
      }
    ]
  });
  const main = createOrderHandler({
    cloud,
    now: () => new Date('2026-07-28T00:00:00.000Z')
  });

  const result = await main({
    action: 'coupon.mine.list',
    payload: { status: 'unused', limit: 10 }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.coupons.length, 1);
  assert.equal(result.data.coupons[0].id, 'coupon-a');
  assert.deepEqual(result.data.coupons[0].template, {
    id: 'template-newcomer',
    code: 'NEWCOMER_10',
    name: '新人立减 10 元',
    type: 'FIXED',
    discountCents: 1000,
    thresholdCents: 0,
    gameIds: [],
    categoryIds: [],
    serviceIds: []
  });
  assert.equal(result.data.nextCursor, null);
});

test('我的优惠券按未使用已使用和已过期分类', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const template = couponTemplate({ type: 'FIXED', thresholdCents: 0 });
  const cloud = createMemoryCloud({
    users: [customer()],
    coupon_templates: [template],
    user_coupons: [
      customerCoupon('coupon-unused', template),
      customerCoupon('coupon-used', template, { status: 'USED' }),
      customerCoupon('coupon-expired', template, {
        validFrom: new Date('2026-06-01T00:00:00.000Z'),
        validTo: new Date('2026-07-01T00:00:00.000Z')
      })
    ]
  });
  const main = createOrderHandler({
    cloud,
    now: () => new Date('2026-07-28T00:00:00.000Z')
  });

  const unused = await main({
    action: 'coupon.mine.list',
    payload: { status: 'unused' }
  });
  const used = await main({
    action: 'coupon.mine.list',
    payload: { status: 'used' }
  });
  const expired = await main({
    action: 'coupon.mine.list',
    payload: { status: 'expired' }
  });

  assert.deepEqual(unused.data.coupons.map((item) => item.id), ['coupon-unused']);
  assert.deepEqual(used.data.coupons.map((item) => item.id), ['coupon-used']);
  assert.deepEqual(expired.data.coupons.map((item) => item.id), ['coupon-expired']);
});

test('尚未生效优惠券在未使用分类中显示不可用原因', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const template = couponTemplate({
    validFrom: new Date('2026-07-10T00:00:00.000Z'),
    validTo: new Date('2026-08-15T23:59:59.000Z')
  });
  const cloud = createMemoryCloud({
    users: [customer()],
    coupon_templates: [template],
    user_coupons: [customerCoupon('coupon-future', template, {
      validFrom: new Date('2026-07-20T00:00:00.000Z'),
      validTo: new Date('2026-08-31T23:59:59.000Z')
    })]
  });
  const main = createOrderHandler({
    cloud,
    now: () => new Date('2026-07-15T00:00:00.000Z')
  });

  const result = await main({
    action: 'coupon.mine.list',
    payload: { status: 'unused' }
  });

  assert.equal(result.success, true);
  assert.deepEqual({
    status: result.data.coupons[0].status,
    available: result.data.coupons[0].available,
    unavailableReason: result.data.coupons[0].unavailableReason
  }, {
    status: 'AVAILABLE',
    available: false,
    unavailableReason: '优惠券尚未生效'
  });
});

test('优惠券展示有效期采用模板与顾客券期限的交集', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const template = couponTemplate({
    validFrom: new Date('2026-07-10T00:00:00.000Z'),
    validTo: new Date('2026-08-15T23:59:59.000Z')
  });
  const cloud = createMemoryCloud({
    users: [customer()],
    coupon_templates: [template],
    user_coupons: [customerCoupon('coupon-range', template, {
      validFrom: new Date('2026-07-20T00:00:00.000Z'),
      validTo: new Date('2026-08-31T23:59:59.000Z')
    })]
  });
  const main = createOrderHandler({
    cloud,
    now: () => new Date('2026-07-28T00:00:00.000Z')
  });

  const result = await main({
    action: 'coupon.mine.list',
    payload: { status: 'unused' }
  });

  assert.deepEqual({
    validFrom: result.data.coupons[0].validFrom,
    validTo: result.data.coupons[0].validTo
  }, {
    validFrom: new Date('2026-07-20T00:00:00.000Z'),
    validTo: new Date('2026-08-15T23:59:59.000Z')
  });
});

test('顾客查看当前套餐优惠券时同时得到可用结果和不可用原因', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const commonTemplate = {
    type: 'FIXED',
    discountCents: 1000,
    thresholdCents: 0,
    gameIds: [],
    categoryIds: [],
    serviceIds: [],
    validFrom: new Date('2026-07-01T00:00:00.000Z'),
    validTo: new Date('2026-08-31T23:59:59.000Z'),
    status: 'ACTIVE'
  };
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service()],
    coupon_templates: [
      Object.assign({ _id: 'template-all', code: 'ALL_10', name: '全场立减 10 元' }, commonTemplate),
      Object.assign({
        _id: 'template-other-service',
        code: 'OTHER_10',
        name: '指定套餐立减 10 元'
      }, commonTemplate, { serviceIds: ['service-other'] })
    ],
    user_coupons: [
      {
        _id: 'coupon-available', userId: 'user-a', templateId: 'template-all',
        status: 'AVAILABLE', validFrom: new Date('2026-07-01T00:00:00.000Z'),
        validTo: new Date('2026-08-31T23:59:59.000Z')
      },
      {
        _id: 'coupon-wrong-service', userId: 'user-a', templateId: 'template-other-service',
        status: 'AVAILABLE', validFrom: new Date('2026-07-01T00:00:00.000Z'),
        validTo: new Date('2026-08-31T23:59:59.000Z')
      },
      {
        _id: 'coupon-expired', userId: 'user-a', templateId: 'template-all',
        status: 'AVAILABLE', validFrom: new Date('2026-07-01T00:00:00.000Z'),
        validTo: new Date('2026-07-20T23:59:59.000Z')
      }
    ]
  });
  const main = createOrderHandler({
    cloud,
    now: () => new Date('2026-07-28T00:00:00.000Z')
  });

  const result = await main({
    action: 'coupon.available.list',
    payload: { serviceId: 'service-val-pro', quantity: 1 }
  });

  assert.equal(result.success, true);
  const coupons = Object.fromEntries(result.data.coupons.map((item) => [item.id, item]));
  assert.deepEqual({
    available: coupons['coupon-available'].available,
    discountAmountCents: coupons['coupon-available'].discountAmountCents,
    payableAmountCents: coupons['coupon-available'].payableAmountCents
  }, {
    available: true,
    discountAmountCents: 1000,
    payableAmountCents: 2500
  });
  assert.equal(coupons['coupon-wrong-service'].unavailableReason, '不适用于当前服务套餐');
  assert.equal(coupons['coupon-expired'].unavailableReason, '优惠券已过期');
});

test('顾客选择满减券后由服务端校验门槛并计算优惠报价', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    services: [service()],
    coupon_templates: [{
      _id: 'template-threshold',
      code: 'OVER_50_MINUS_10',
      name: '满 50 减 10 元',
      type: 'THRESHOLD',
      discountCents: 1000,
      thresholdCents: 5000,
      gameIds: ['game-valorant'],
      categoryIds: [],
      serviceIds: [],
      validFrom: new Date('2026-07-01T00:00:00.000Z'),
      validTo: new Date('2026-08-31T23:59:59.000Z'),
      status: 'ACTIVE'
    }],
    user_coupons: [{
      _id: 'coupon-threshold',
      userId: 'user-a',
      templateId: 'template-threshold',
      status: 'AVAILABLE',
      validFrom: new Date('2026-07-01T00:00:00.000Z'),
      validTo: new Date('2026-08-31T23:59:59.000Z')
    }]
  });
  const main = createOrderHandler({
    cloud,
    now: () => new Date('2026-07-28T00:00:00.000Z')
  });

  const result = await main({
    action: 'quote',
    payload: {
      serviceId: 'service-val-pro',
      quantity: 2,
      userCouponId: 'coupon-threshold'
    }
  });

  assert.equal(result.success, true);
  assert.deepEqual({
    userCouponId: result.data.quote.userCouponId,
    originalAmountCents: result.data.quote.originalAmountCents,
    discountAmountCents: result.data.quote.discountAmountCents,
    payableAmountCents: result.data.quote.payableAmountCents
  }, {
    userCouponId: 'coupon-threshold',
    originalAmountCents: 7000,
    discountAmountCents: 1000,
    payableAmountCents: 6000
  });

  const belowThreshold = await main({
    action: 'quote',
    payload: {
      serviceId: 'service-val-pro',
      quantity: 1,
      userCouponId: 'coupon-threshold'
    }
  });

  assert.equal(belowThreshold.success, false);
  assert.equal(belowThreshold.error.code, 'COUPON_NOT_APPLICABLE');
  assert.equal(belowThreshold.error.message, '订单金额未满 50 元');
});

test('满减券门槛必须配置为非负整数分', async () => {
  const template = couponTemplate({ thresholdCents: -1 });
  const { main } = createCouponOrderFixture({ template });

  const result = await main({
    action: 'quote',
    payload: {
      serviceId: 'service-val-pro',
      quantity: 1,
      userCouponId: 'coupon-own'
    }
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'COUPON_NOT_APPLICABLE');
  assert.equal(result.error.message, '优惠券门槛配置无效');
});

test('顾客建单时原子锁券并固化优惠券价格快照', async () => {
  const { main } = createCouponOrderFixture();

  const result = await main({
    action: 'create',
    payload: validCreatePayload({ userCouponId: 'coupon-own' }),
    idempotencyKey: 'coupon-order-lock'
  });
  const unused = await main({
    action: 'coupon.mine.list',
    payload: { status: 'unused' }
  });

  assert.equal(result.success, true);
  assert.deepEqual({
    userCouponId: result.data.order.userCouponId,
    discountAmountCents: result.data.order.discountAmountCents,
    payableAmountCents: result.data.order.payableAmountCents
  }, {
    userCouponId: 'coupon-own',
    discountAmountCents: 1000,
    payableAmountCents: 6000
  });
  assert.deepEqual(result.data.order.snapshot.pricing.coupon, {
    id: 'template-threshold',
    code: 'OVER_50_MINUS_10',
    name: '满 50 减 10 元',
    type: 'THRESHOLD',
    discountCents: 1000,
    thresholdCents: 5000,
    gameIds: [],
    categoryIds: [],
    serviceIds: [],
    validFrom: new Date('2026-07-01T00:00:00.000Z'),
    validTo: new Date('2026-08-31T23:59:59.000Z')
  });
  assert.deepEqual(unused.data.coupons.map((item) => ({ id: item.id, status: item.status })), [
    { id: 'coupon-own', status: 'LOCKED' }
  ]);
});

test('相同优惠券建单请求重试时复用原服务订单', async () => {
  const { main } = createCouponOrderFixture();
  const event = {
    action: 'create',
    payload: validCreatePayload({ userCouponId: 'coupon-own' }),
    idempotencyKey: 'coupon-order-idempotent'
  };

  const first = await main(event);
  const retry = await main(event);

  assert.equal(retry.success, true);
  assert.equal(retry.data.reused, true);
  assert.equal(retry.data.order.id, first.data.order.id);
});

test('已锁定优惠券不能绑定第二张服务订单', async () => {
  const { main } = createCouponOrderFixture();
  const payload = validCreatePayload({ userCouponId: 'coupon-own' });

  await main({ action: 'create', payload, idempotencyKey: 'coupon-order-first' });
  const repeated = await main({
    action: 'create', payload, idempotencyKey: 'coupon-order-second'
  });

  assert.equal(repeated.success, false);
  assert.equal(repeated.error.code, 'COUPON_ALREADY_USED');
});

test('顾客不能使用他人的优惠券创建服务订单', async () => {
  const template = couponTemplate();
  const foreignCoupon = customerCoupon('coupon-foreign', template, { userId: 'user-b' });
  const { main } = createCouponOrderFixture({ template, coupons: [foreignCoupon] });

  const result = await main({
    action: 'create',
    payload: validCreatePayload({ userCouponId: 'coupon-foreign' }),
    idempotencyKey: 'coupon-order-foreign'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'COUPON_NOT_APPLICABLE');
});

test('同一建单幂等键更换优惠券时拒绝复用原服务订单', async () => {
  const template = couponTemplate();
  const coupons = [
    customerCoupon('coupon-first', template),
    customerCoupon('coupon-second', template)
  ];
  const { main } = createCouponOrderFixture({ template, coupons });

  await main({
    action: 'create',
    payload: validCreatePayload({ userCouponId: 'coupon-first' }),
    idempotencyKey: 'coupon-order-same-key'
  });
  const changed = await main({
    action: 'create',
    payload: validCreatePayload({ userCouponId: 'coupon-second' }),
    idempotencyKey: 'coupon-order-same-key'
  });

  assert.equal(changed.success, false);
  assert.equal(changed.error.code, 'DUPLICATE_REQUEST');
});

function returnableCouponTemplate() {
  return couponTemplate({
    _id: 'template-fixed',
    code: 'FIXED_10',
    name: '无门槛立减 10 元',
    type: 'FIXED',
    thresholdCents: 0,
  });
}

test('未付款服务订单关闭时原子退回仍有效的优惠券', async () => {
  const template = returnableCouponTemplate();
  const coupons = [customerCoupon('coupon-returnable', template)];
  const { main } = createCouponOrderFixture({ template, coupons });
  const payload = validCreatePayload({
    quantity: 1,
    userCouponId: 'coupon-returnable'
  });

  const first = await main({
    action: 'create', payload, idempotencyKey: 'coupon-return-first'
  });
  const cancelled = await main({
    action: 'cancel',
    payload: { orderId: first.data.order.id, reason: '顾客取消', version: 1 }
  });
  const unused = await main({
    action: 'coupon.mine.list', payload: { status: 'unused' }
  });

  assert.equal(cancelled.success, true);
  assert.deepEqual(unused.data.coupons.map((item) => ({ id: item.id, status: item.status })), [
    { id: 'coupon-returnable', status: 'AVAILABLE' }
  ]);
});

test('退回的有效优惠券可以用于新的服务订单', async () => {
  const template = returnableCouponTemplate();
  const coupons = [customerCoupon('coupon-returnable', template)];
  const { main } = createCouponOrderFixture({ template, coupons });
  const payload = validCreatePayload({ quantity: 1, userCouponId: 'coupon-returnable' });

  const first = await main({ action: 'create', payload, idempotencyKey: 'coupon-return-first' });
  await main({
    action: 'cancel',
    payload: { orderId: first.data.order.id, reason: '顾客取消', version: 1 }
  });
  const afterReturn = await main({
    action: 'create', payload, idempotencyKey: 'coupon-return-second'
  });

  assert.equal(afterReturn.success, true);
  assert.equal(afterReturn.data.order.userCouponId, 'coupon-returnable');
  assert.equal(afterReturn.data.order.payableAmountCents, 2500);
});

test('未付款服务订单关闭时将已过期优惠券归入已过期', async () => {
  const template = returnableCouponTemplate();
  const coupons = [customerCoupon('coupon-returnable', template)];
  let timestamp = new Date('2026-07-28T00:00:00.000Z');
  const { main } = createCouponOrderFixture({
    template,
    coupons,
    now: () => timestamp
  });
  const payload = validCreatePayload({ quantity: 1, userCouponId: 'coupon-returnable' });

  const first = await main({ action: 'create', payload, idempotencyKey: 'coupon-expiry' });

  timestamp = new Date('2026-09-01T00:00:00.000Z');
  const cancelledAfterExpiry = await main({
    action: 'cancel',
    payload: { orderId: first.data.order.id, reason: '顾客取消', version: 1 }
  });
  const expiredCoupons = await main({
    action: 'coupon.mine.list',
    payload: { status: 'expired', limit: 10 }
  });

  assert.equal(cancelledAfterExpiry.success, true);
  assert.deepEqual(expiredCoupons.data.coupons.map((item) => ({
    id: item.id,
    status: item.status
  })), [{ id: 'coupon-returnable', status: 'EXPIRED' }]);
});

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
    userCouponId: null,
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

function createMockOrders(userId) {
  const now = new Date();
  return [
    { _id: 'o1', userId, paymentStatus: 'UNPAID', fulfillmentStatus: 'NOT_STARTED', afterSalesStatus: 'NONE', createdAt: new Date(now - 10000), snapshot: { service: { name: 'A' } }, orderNo: 'N1' },
    { _id: 'o2', userId, paymentStatus: 'PAID', fulfillmentStatus: 'PENDING_ASSIGNMENT', afterSalesStatus: 'NONE', createdAt: new Date(now - 8000), snapshot: { service: { name: 'B' } }, orderNo: 'N2' },
    { _id: 'o3', userId, paymentStatus: 'PAID', fulfillmentStatus: 'WAITING_START', afterSalesStatus: 'NONE', createdAt: new Date(now - 6000), snapshot: { service: { name: 'C' } }, orderNo: 'N3' },
    { _id: 'o4', userId, paymentStatus: 'PAID', fulfillmentStatus: 'IN_SERVICE', afterSalesStatus: 'NONE', createdAt: new Date(now - 4000), snapshot: { service: { name: 'D' } }, orderNo: 'N4' },
    { _id: 'o5', userId, paymentStatus: 'PAID', fulfillmentStatus: 'WAITING_CONFIRMATION', afterSalesStatus: 'NONE', createdAt: new Date(now - 2000), snapshot: { service: { name: 'E' } }, orderNo: 'N5' },
    { _id: 'o6', userId, paymentStatus: 'PAID', fulfillmentStatus: 'COMPLETED', afterSalesStatus: 'NONE', createdAt: now, snapshot: { service: { name: 'F' } }, orderNo: 'N6' }
  ];
}

test('获取订单状态统计', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer(), { _id: 'user-b', openid: 'openid-b', status: 'ACTIVE' }],
    orders: createMockOrders('user-a')
  });
  const mainA = createOrderHandler({ cloud });
  const resultA = await mainA({ action: 'summary', requestId: 's1' });
  assert.deepEqual(resultA.data.counts, { all: 6, unpaid: 1, waiting: 2, inProgress: 2, completed: 1 });

  const cloudB = createMemoryCloud({
    users: [{ _id: 'user-b', openid: 'openid-customer-b', status: 'ACTIVE' }],
    orders: createMockOrders('user-a')
  }, 'openid-customer-b');
  const mainB = createOrderHandler({ cloud: cloudB });
  const resultB = await mainB({ action: 'summary', requestId: 's2' });
  assert.deepEqual(resultB.data.counts, { all: 0, unpaid: 0, waiting: 0, inProgress: 0, completed: 0 });
});

test('分页查询订单列表', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: createMockOrders('user-a')
  });
  const main = createOrderHandler({ cloud });

  const result1 = await main({ action: 'list', payload: { tab: 'all', limit: 2 } });
  assert.equal(result1.data.orders.length, 2);
  assert.equal(result1.data.orders[0].id, 'o6'); // 降序
  assert.equal(result1.data.orders[1].id, 'o5');
  assert.equal(result1.data.nextCursor, 'o5');

  const result2 = await main({ action: 'list', payload: { tab: 'waiting', limit: 10 } });
  assert.equal(result2.data.orders.length, 2);
  assert.equal(result2.data.orders[0].id, 'o3');
  assert.equal(result2.data.orders[1].id, 'o2');
});

test('查询订单详情与操作时间线', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: createMockOrders('user-a'),
    order_logs: [
      { orderId: 'o1', customerVisible: true, action: 'CREATE', customerMessage: '创建', createdAt: new Date(1) },
      { orderId: 'o1', customerVisible: false, action: 'INTERNAL', customerMessage: '', createdAt: new Date(2) },
      { orderId: 'o1', customerVisible: true, action: 'REMIND', customerMessage: '提醒付款', createdAt: new Date(3) }
    ]
  });
  const main = createOrderHandler({ cloud });

  const result = await main({ action: 'detail', payload: { orderId: 'o1' } });
  assert.equal(result.data.order.id, 'o1');
  assert.equal(result.data.timeline.length, 2);
  assert.equal(result.data.timeline[0].action, 'REMIND'); // 降序
  assert.deepEqual(result.data.actions, ['contact', 'cancel', 'pay']);
});

test('取消未支付订单', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: [{ _id: 'o1', userId: 'user-a', orderNo: 'N1', paymentStatus: 'UNPAID', fulfillmentStatus: 'NOT_STARTED', version: 1 }],
    order_logs: []
  });
  const main = createOrderHandler({ cloud });

  const conflict = await main({ action: 'cancel', payload: { orderId: 'o1', version: 9 } });
  assert.equal(conflict.error.code, 'CONFLICT');

  const success = await main({ action: 'cancel', payload: { orderId: 'o1', reason: '不想买了', version: 1 } });
  assert.equal(success.success, true);
  assert.equal(success.data.order.paymentStatus, 'CLOSED');
  assert.equal(success.data.order.fulfillmentStatus, 'CANCELLED');
  assert.equal(success.data.order.version, 2);
});

test('确认完成服务', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: [{ _id: 'o1', userId: 'user-a', orderNo: 'N1', fulfillmentStatus: 'WAITING_CONFIRMATION', afterSalesStatus: 'NONE', version: 1 }],
    order_logs: []
  });
  const main = createOrderHandler({ cloud });

  const success = await main({ action: 'confirm', payload: { orderId: 'o1', version: 1 } });
  assert.equal(success.success, true);
  assert.equal(success.data.order.fulfillmentStatus, 'COMPLETED');
});

test('对服务发起异议', async () => {
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: [{ _id: 'o1', userId: 'user-a', orderNo: 'N1', fulfillmentStatus: 'WAITING_CONFIRMATION', afterSalesStatus: 'NONE', version: 1 }],
    order_logs: []
  });
  const main = createOrderHandler({ cloud });

  const success = await main({ action: 'dispute', payload: { orderId: 'o1', reason: '态度恶劣', description: '一直骂人', version: 1 } });
  assert.equal(success.success, true);
  assert.equal(success.data.order.afterSalesStatus, 'REQUESTED');
});
