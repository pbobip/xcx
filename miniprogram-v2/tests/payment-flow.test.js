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
        let order = [];
        return {
          limit(count) { limit = count; return this; },
          orderBy(field, dir) { order.push({ field, dir }); return this; },
          async get() {
            const records = data[name].filter((record) => matches(record, query));
            for (let i = order.length - 1; i >= 0; i--) {
              const { field, dir } = order[i];
              records.sort((a, b) => {
                if (a[field] < b[field]) return dir === 'desc' ? 1 : -1;
                if (a[field] > b[field]) return dir === 'desc' ? -1 : 1;
                return 0;
              });
            }
            return { data: records.slice(0, limit).map(clone) };
          }
        };
      },
      doc(id) {
        return {
          async get() {
            return { data: clone(data[name].find((record) => record._id === id) || null) };
          },
          async update({ data: updateData }) {
            const record = data[name].find((item) => item._id === id);
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
      neq: (value) => ({ $neq: value }),
      or: (queries) => ({ $or: queries })
    },
    async runTransaction(callback) { return callback({ collection }); }
  };
  return {
    database: () => database,
    getWXContext: () => ({ OPENID: openid })
  };
}

function customer(overrides = {}) {
  return Object.assign({
    _id: 'user-a',
    openid: 'openid-customer-a',
    status: 'ACTIVE',
    platformUserNo: 'BBX-TEST-A'
  }, overrides);
}

function adminUser(roleId, overrides = {}) {
  return Object.assign({
    _id: 'admin-a',
    authSubjectId: 'openid-admin',
    displayName: '支付管理员',
    roleIds: [roleId],
    status: 'ACTIVE'
  }, overrides);
}

function adminRole(id, code, permissions) {
  return { _id: id, code, name: code, permissions, status: 'ACTIVE' };
}

function unpaidOrder(overrides = {}) {
  return Object.assign({
    _id: 'order-a',
    orderNo: 'BBX202607280001',
    userId: 'user-a',
    snapshot: { service: { name: '钻石段位技术陪' } },
    payableAmountCents: 2500,
    paidAmountCents: 0,
    refundedAmountCents: 0,
    paymentStatus: 'UNPAID',
    fulfillmentStatus: 'NOT_STARTED',
    afterSalesStatus: 'NONE',
    createdAt: new Date('2026-07-28T15:50:00.000Z'),
    updatedAt: new Date('2026-07-28T15:50:00.000Z'),
    version: 1
  }, overrides);
}

function paidOrder(overrides = {}) {
  return unpaidOrder(Object.assign({
    paymentStatus: 'PAID',
    fulfillmentStatus: 'PENDING_ASSIGNMENT',
    paidAmountCents: 2500,
    paidAt: new Date('2026-07-28T16:01:00.000Z'),
    version: 2
  }, overrides));
}

test('顾客为自己的未付款服务订单创建预支付并复用有效结果', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: [unpaidOrder()],
    payment_records: []
  });
  const adapterCalls = [];
  const wechatPay = {
    async createJsapiPayment(input) {
      adapterCalls.push(input);
      return {
        prepayId: 'wx-prepay-001',
        paymentParams: {
          timeStamp: '1785254400',
          nonceStr: 'nonce-001',
          package: 'prepay_id=wx-prepay-001',
          signType: 'RSA',
          paySign: 'signed-payment-params'
        }
      };
    }
  };
  const { createPaymentHandler } = require('../cloudfunctions/payment/handler');
  const main = createPaymentHandler({
    cloud,
    wechatPay,
    now: () => new Date('2026-07-28T16:00:00.000Z')
  });

  const first = await main({ action: 'prepay.create', payload: { orderId: 'order-a' } });
  const second = await main({ action: 'prepay.create', payload: { orderId: 'order-a' } });

  assert.equal(first.success, true);
  assert.deepEqual(first.data, {
    payment: {
      orderId: 'order-a',
      orderNo: 'BBX202607280001',
      outTradeNo: 'BBX202607280001',
      amountCents: 2500,
      status: 'PREPAY',
      expiresAt: new Date('2026-07-28T16:20:00.000Z')
    },
    paymentParams: {
      timeStamp: '1785254400',
      nonceStr: 'nonce-001',
      package: 'prepay_id=wx-prepay-001',
      signType: 'RSA',
      paySign: 'signed-payment-params'
    }
  });
  assert.deepEqual(second.data, first.data);
  assert.deepEqual(adapterCalls, [{
    description: '钻石段位技术陪',
    outTradeNo: 'BBX202607280001',
    amountCents: 2500,
    openid: 'openid-customer-a',
    expiresAt: new Date('2026-07-28T16:20:00.000Z')
  }]);
});

test('超过服务订单付款期限后不能用同一商户订单号重新创建预支付', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: [unpaidOrder()],
    payment_records: [{
      _id: 'payment-expired', orderId: 'order-a', orderNo: 'BBX202607280001',
      outTradeNo: 'BBX202607280001', amountCents: 2500, status: 'PREPAY',
      expiresAt: new Date('2026-07-28T16:20:00.000Z'), version: 1
    }]
  });
  let adapterCalls = 0;
  const { createPaymentHandler } = require('../cloudfunctions/payment/handler');
  const main = createPaymentHandler({
    cloud,
    wechatPay: { async createJsapiPayment() { adapterCalls += 1; } },
    now: () => new Date('2026-07-28T16:30:00.000Z')
  });

  const result = await main({ action: 'prepay.create', payload: { orderId: 'order-a' } });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'PAYMENT_EXPIRED');
  assert.equal(adapterCalls, 0);
});

test('支付成功通知原子更新服务订单且重复通知不会重复写顾客时间线', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: [unpaidOrder({ userCouponId: 'coupon-a' })],
    payment_records: [],
    user_coupons: [{
      _id: 'coupon-a', userId: 'user-a', templateId: 'template-a',
      status: 'LOCKED', lockedOrderId: 'order-a'
    }],
    order_logs: [],
    messages: []
  });
  const paymentParams = {
    timeStamp: '1785254400', nonceStr: 'nonce-001',
    package: 'prepay_id=wx-prepay-001', signType: 'RSA', paySign: 'signed-payment-params'
  };
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
  const wechatPay = {
    async createJsapiPayment() { return { prepayId: 'wx-prepay-001', paymentParams }; },
    parseNotification() {
      return { id: 'EV-TRANSACTION-001', eventType: 'TRANSACTION.SUCCESS', resource: transaction };
    }
  };
  const { createPaymentHandler, createPaymentNotificationHandler } = require('../cloudfunctions/payment/handler');
  const now = () => new Date('2026-07-28T16:02:00.000Z');
  const paymentMain = createPaymentHandler({ cloud, wechatPay, now });
  await paymentMain({ action: 'prepay.create', payload: { orderId: 'order-a' } });
  const notifyMain = createPaymentNotificationHandler({
    cloud,
    wechatPay,
    config: { appid: 'wx373cd5ed5680a30d', mchid: '1900000109' },
    now
  });

  const first = await notifyMain({ headers: {}, rawBody: 'signed-and-encrypted-body' });
  const duplicate = await notifyMain({ headers: {}, rawBody: 'signed-and-encrypted-body' });
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const orderMain = createOrderHandler({ cloud, now });
  const detail = await orderMain({ action: 'detail', payload: { orderId: 'order-a' } });

  assert.deepEqual(first, {
    statusCode: 204,
    headers: { 'Content-Type': 'application/json' },
    body: ''
  });
  assert.deepEqual(duplicate, first);
  assert.equal(detail.success, true);
  assert.equal(detail.data.order.paymentStatus, 'PAID');
  assert.equal(detail.data.order.fulfillmentStatus, 'PENDING_ASSIGNMENT');
  assert.equal(detail.data.order.paidAmountCents, 2500);
  assert.deepEqual(detail.data.timeline.map((item) => item.action).sort(), [
    'PAYMENT_SUCCESS',
    'PAYMENT_SUCCESS'
  ]);
});

test('支付通知延迟时顾客主动查单可以用微信结果确认付款', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: [unpaidOrder()],
    payment_records: [],
    order_logs: [],
    messages: [],
    user_coupons: []
  });
  const transaction = {
    mchid: '1900000109', appid: 'wx373cd5ed5680a30d',
    out_trade_no: 'BBX202607280001', transaction_id: '4200000000202607280001',
    trade_state: 'SUCCESS', success_time: '2026-07-28T16:01:00+08:00',
    amount: { total: 2500, payer_total: 2500, currency: 'CNY', payer_currency: 'CNY' },
    payer: { openid: 'openid-customer-a' }
  };
  const wechatPay = {
    async createJsapiPayment() {
      return {
        prepayId: 'wx-prepay-001',
        paymentParams: {
          timeStamp: '1785254400', nonceStr: 'nonce-001', package: 'prepay_id=wx-prepay-001',
          signType: 'RSA', paySign: 'signed-payment-params'
        }
      };
    },
    async queryTransaction(outTradeNo) {
      assert.equal(outTradeNo, 'BBX202607280001');
      return transaction;
    }
  };
  const { createPaymentHandler } = require('../cloudfunctions/payment/handler');
  const now = () => new Date('2026-07-28T16:03:00.000Z');
  const paymentMain = createPaymentHandler({
    cloud, wechatPay, now,
    config: { appid: 'wx373cd5ed5680a30d', mchid: '1900000109' }
  });
  await paymentMain({ action: 'prepay.create', payload: { orderId: 'order-a' } });

  const result = await paymentMain({ action: 'query', payload: { orderId: 'order-a' } });

  assert.equal(result.success, true);
  assert.equal(result.data.payment.status, 'SUCCESS');
  assert.equal(result.data.order.paymentStatus, 'PAID');
  assert.equal(result.data.order.fulfillmentStatus, 'PENDING_ASSIGNMENT');
  assert.equal(result.data.order.paidAmountCents, 2500);
});

test('管理员关闭超时预支付前必须查单且只有未支付结果才会关单', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    admin_users: [adminUser('role-admin')],
    roles: [adminRole('role-admin', 'SUPER_ADMIN', ['payment.close'])],
    orders: [unpaidOrder()],
    payment_records: [{
      _id: 'payment-a', orderId: 'order-a', orderNo: 'BBX202607280001',
      outTradeNo: 'BBX202607280001', amountCents: 2500, status: 'PREPAY',
      expiresAt: new Date('2026-07-28T16:20:00.000Z'), version: 1
    }],
    user_coupons: [], coupon_templates: [], order_logs: [], messages: []
  }, 'openid-admin');
  const calls = [];
  const wechatPay = {
    async queryTransaction(outTradeNo) {
      calls.push(`query:${outTradeNo}`);
      return { out_trade_no: outTradeNo, trade_state: 'NOTPAY' };
    },
    async closeTransaction(outTradeNo) {
      calls.push(`close:${outTradeNo}`);
    }
  };
  const { createPaymentHandler } = require('../cloudfunctions/payment/handler');
  const main = createPaymentHandler({
    cloud, wechatPay,
    config: { appid: 'wx373cd5ed5680a30d', mchid: '1900000109' },
    now: () => new Date('2026-07-28T16:21:00.000Z')
  });

  const result = await main({ action: 'close', payload: { orderId: 'order-a', reason: '支付超时' } });

  assert.equal(result.success, true);
  assert.equal(result.data.payment.status, 'CLOSED');
  assert.equal(result.data.order.paymentStatus, 'CLOSED');
  assert.equal(result.data.order.fulfillmentStatus, 'CANCELLED');
  assert.deepEqual(calls, [
    'query:BBX202607280001',
    'close:BBX202607280001'
  ]);
});

test('取消与支付成功乱序时查单真值优先且不会错误调用关单', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    admin_users: [adminUser('role-admin')],
    roles: [adminRole('role-admin', 'SUPER_ADMIN', ['payment.close'])],
    orders: [unpaidOrder()],
    payment_records: [{
      _id: 'payment-a', orderId: 'order-a', orderNo: 'BBX202607280001',
      outTradeNo: 'BBX202607280001', amountCents: 2500, status: 'PREPAY', version: 1
    }],
    user_coupons: [], order_logs: [], messages: []
  }, 'openid-admin');
  let closeCalls = 0;
  const wechatPay = {
    async queryTransaction() {
      return {
        mchid: '1900000109', appid: 'wx373cd5ed5680a30d',
        out_trade_no: 'BBX202607280001', transaction_id: '4200000000202607280001',
        trade_state: 'SUCCESS', success_time: '2026-07-28T16:01:00+08:00',
        amount: { total: 2500, payer_total: 2500, currency: 'CNY' },
        payer: { openid: 'openid-customer-a' }
      };
    },
    async closeTransaction() { closeCalls += 1; }
  };
  const { createPaymentHandler } = require('../cloudfunctions/payment/handler');
  const main = createPaymentHandler({
    cloud, wechatPay,
    config: { appid: 'wx373cd5ed5680a30d', mchid: '1900000109' },
    now: () => new Date('2026-07-28T16:02:00.000Z')
  });

  const result = await main({
    action: 'close', payload: { orderId: 'order-a', reason: '顾客主动取消' }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.order.paymentStatus, 'PAID');
  assert.equal(result.data.order.fulfillmentStatus, 'PENDING_ASSIGNMENT');
  assert.equal(closeCalls, 0);
});

test('管理员发起部分退款按幂等键只向微信提交一次且受理不等于成功', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    admin_users: [adminUser('role-admin')],
    roles: [adminRole('role-admin', 'SUPER_ADMIN', ['refund.request', 'refund.execute'])],
    orders: [paidOrder()],
    payment_records: [{
      _id: 'payment-a', orderId: 'order-a', orderNo: 'BBX202607280001',
      outTradeNo: 'BBX202607280001', transactionId: '4200000000202607280001',
      amountCents: 2500, status: 'SUCCESS', version: 2
    }],
    refund_records: [], order_logs: [], messages: []
  }, 'openid-admin');
  const refundCalls = [];
  const wechatPay = {
    async createRefund(input) {
      refundCalls.push(input);
      return {
        refund_id: '5030000000202607280001',
        out_refund_no: input.outRefundNo,
        status: 'PROCESSING',
        amount: { refund: 1000, total: 2500, currency: 'CNY' }
      };
    }
  };
  const { createPaymentHandler } = require('../cloudfunctions/payment/handler');
  const main = createPaymentHandler({
    cloud, wechatPay,
    createRefundNo: () => 'BBXR202607280001',
    now: () => new Date('2026-07-28T16:10:00.000Z')
  });
  const event = {
    action: 'refund.request',
    idempotencyKey: 'refund-idempotency-001',
    payload: { orderId: 'order-a', amountCents: 1000, reason: '顾客协商部分退款' }
  };

  const first = await main(event);
  const duplicate = await main(event);
  const overReserved = await main({
    action: 'refund.request',
    idempotencyKey: 'refund-idempotency-002',
    payload: { orderId: 'order-a', amountCents: 2000, reason: '第二笔退款' }
  });

  assert.equal(first.success, true);
  assert.deepEqual(first.data.refund, {
    id: first.data.refund.id,
    orderId: 'order-a',
    outRefundNo: 'BBXR202607280001',
    refundId: '5030000000202607280001',
    amountCents: 1000,
    status: 'PROCESSING',
    refundedAt: null
  });
  assert.deepEqual(duplicate.data, first.data);
  assert.equal(overReserved.success, false);
  assert.equal(overReserved.error.code, 'REFUND_AMOUNT_EXCEEDED');
  assert.deepEqual(refundCalls, [{
    outTradeNo: 'BBX202607280001',
    outRefundNo: 'BBXR202607280001',
    reason: '顾客协商部分退款',
    amountCents: 1000,
    totalAmountCents: 2500
  }]);
});

test('微信申请退款响应已成功时立即完成全额退款并取消未开始履约', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    admin_users: [adminUser('role-admin')],
    roles: [adminRole('role-admin', 'SUPER_ADMIN', [
      'refund.request', 'refund.execute', 'refund.query'
    ])],
    orders: [paidOrder()],
    payment_records: [{
      _id: 'payment-a', orderId: 'order-a', orderNo: 'BBX202607280001',
      outTradeNo: 'BBX202607280001', transactionId: '4200000000202607280001',
      amountCents: 2500, status: 'SUCCESS', version: 2
    }],
    refund_records: [], order_logs: [], messages: [], audit_logs: []
  }, 'openid-admin');
  const wechatPay = {
    async createRefund(input) {
      return {
        out_trade_no: input.outTradeNo,
        transaction_id: '4200000000202607280001',
        out_refund_no: input.outRefundNo,
        refund_id: '5030000000202607280001',
        status: 'SUCCESS',
        success_time: '2026-07-28T16:12:00+08:00',
        amount: { total: 2500, refund: 2500, payer_total: 2500, payer_refund: 2500 }
      };
    }
  };
  const { createPaymentHandler } = require('../cloudfunctions/payment/handler');
  const main = createPaymentHandler({
    cloud, wechatPay,
    createRefundNo: () => 'BBXR202607280001',
    now: () => new Date('2026-07-28T16:12:00.000Z')
  });

  const requested = await main({
    action: 'refund.request', idempotencyKey: 'refund-full-001',
    payload: { orderId: 'order-a', amountCents: 2500, reason: '服务开始前全额退款' }
  });
  const queried = await main({
    action: 'refund.query', payload: { refundId: requested.data.refund.id }
  });

  assert.equal(requested.data.refund.status, 'SUCCESS');
  assert.equal(queried.data.order.paymentStatus, 'REFUNDED');
  assert.equal(queried.data.order.fulfillmentStatus, 'CANCELLED');
  assert.equal(queried.data.order.refundedAmountCents, 2500);
});

test('退款成功通知累计部分退款金额且重复通知不会重复写顾客时间线', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: [paidOrder({ afterSalesStatus: 'PROCESSING' })],
    payment_records: [{
      _id: 'payment-a', orderId: 'order-a', orderNo: 'BBX202607280001',
      outTradeNo: 'BBX202607280001', transactionId: '4200000000202607280001',
      amountCents: 2500, status: 'SUCCESS', version: 2
    }],
    refund_records: [{
      _id: 'refund-a', orderId: 'order-a', orderNo: 'BBX202607280001',
      outRefundNo: 'BBXR202607280001', refundId: '5030000000202607280001',
      amountCents: 1000, status: 'PROCESSING', notifyId: null, version: 2
    }],
    order_logs: [], messages: []
  });
  const refundResource = {
    mchid: '1900000109',
    out_trade_no: 'BBX202607280001',
    transaction_id: '4200000000202607280001',
    out_refund_no: 'BBXR202607280001',
    refund_id: '5030000000202607280001',
    refund_status: 'SUCCESS',
    success_time: '2026-07-28T16:12:00+08:00',
    amount: { total: 2500, refund: 1000, payer_total: 2500, payer_refund: 800 }
  };
  const wechatPay = {
    parseNotification() {
      return { id: 'EV-REFUND-001', eventType: 'REFUND.SUCCESS', resource: refundResource };
    }
  };
  const { createRefundNotificationHandler } = require('../cloudfunctions/payment/handler');
  const notifyMain = createRefundNotificationHandler({
    cloud, wechatPay,
    config: { mchid: '1900000109' },
    now: () => new Date('2026-07-28T16:13:00.000Z')
  });

  const first = await notifyMain({ headers: {}, rawBody: 'signed-refund-body' });
  const duplicate = await notifyMain({ headers: {}, rawBody: 'signed-refund-body' });
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const orderMain = createOrderHandler({
    cloud,
    now: () => new Date('2026-07-28T16:13:00.000Z')
  });
  const detail = await orderMain({ action: 'detail', payload: { orderId: 'order-a' } });

  assert.equal(first.statusCode, 204);
  assert.deepEqual(duplicate, first);
  assert.equal(detail.data.order.paymentStatus, 'PARTIALLY_REFUNDED');
  assert.equal(detail.data.order.refundedAmountCents, 1000);
  assert.equal(detail.data.order.afterSalesStatus, 'RESOLVED');
  assert.equal(detail.data.order.fulfillmentStatus, 'PENDING_ASSIGNMENT');
  assert.equal(detail.data.timeline.length, 2);
});

test('退款异常通知不会记为退款成功并保留人工处理状态', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: [paidOrder({ afterSalesStatus: 'PROCESSING' })],
    payment_records: [{
      _id: 'payment-a', orderId: 'order-a', outTradeNo: 'BBX202607280001',
      transactionId: '4200000000202607280001', amountCents: 2500,
      status: 'SUCCESS', version: 2
    }],
    refund_records: [{
      _id: 'refund-a', orderId: 'order-a', outRefundNo: 'BBXR202607280001',
      refundId: '5030000000202607280001', amountCents: 1000,
      status: 'PROCESSING', version: 2
    }],
    order_logs: [], messages: []
  });
  const wechatPay = {
    parseNotification() {
      return {
        id: 'EV-REFUND-ABNORMAL-001', eventType: 'REFUND.ABNORMAL',
        resource: {
          mchid: '1900000109', out_trade_no: 'BBX202607280001',
          transaction_id: '4200000000202607280001',
          out_refund_no: 'BBXR202607280001', refund_id: '5030000000202607280001',
          refund_status: 'ABNORMAL',
          amount: { total: 2500, refund: 1000, payer_total: 2500, payer_refund: 1000 }
        }
      };
    }
  };
  const { createRefundNotificationHandler } = require('../cloudfunctions/payment/handler');
  const response = await createRefundNotificationHandler({
    cloud, wechatPay, config: { mchid: '1900000109' },
    now: () => new Date('2026-07-28T16:13:00.000Z')
  })({ headers: {}, rawBody: 'signed-abnormal-refund' });
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const detail = await createOrderHandler({ cloud })({
    action: 'detail', payload: { orderId: 'order-a' }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(detail.data.order.paymentStatus, 'PAID');
  assert.equal(detail.data.order.refundedAmountCents, 0);
  assert.equal(detail.data.order.afterSalesStatus, 'PROCESSING');
  assert.equal(detail.data.timeline[0].action, 'REFUND_ABNORMAL');
});

test('退款通知延迟时财务主动查询可以确认退款成功', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    admin_users: [adminUser('role-finance', {
      _id: 'admin-finance', authSubjectId: 'openid-finance', displayName: '财务'
    })],
    roles: [adminRole('role-finance', 'FINANCE', ['refund.query'])],
    orders: [paidOrder({ afterSalesStatus: 'PROCESSING' })],
    payment_records: [{
      _id: 'payment-a', orderId: 'order-a', orderNo: 'BBX202607280001',
      outTradeNo: 'BBX202607280001', transactionId: '4200000000202607280001',
      amountCents: 2500, status: 'SUCCESS', version: 2
    }],
    refund_records: [{
      _id: 'refund-a', orderId: 'order-a', orderNo: 'BBX202607280001',
      outRefundNo: 'BBXR202607280001', refundId: '5030000000202607280001',
      amountCents: 1000, status: 'PROCESSING', notifyId: null, version: 2
    }],
    order_logs: [], messages: []
  }, 'openid-finance');
  const refundResource = {
    out_trade_no: 'BBX202607280001', transaction_id: '4200000000202607280001',
    out_refund_no: 'BBXR202607280001', refund_id: '5030000000202607280001',
    status: 'SUCCESS', success_time: '2026-07-28T16:12:00+08:00',
    amount: { total: 2500, refund: 1000, payer_total: 2500, payer_refund: 1000 }
  };
  const wechatPay = {
    async queryRefund(outRefundNo) {
      assert.equal(outRefundNo, 'BBXR202607280001');
      return refundResource;
    }
  };
  const { createPaymentHandler } = require('../cloudfunctions/payment/handler');
  const main = createPaymentHandler({
    cloud, wechatPay,
    now: () => new Date('2026-07-28T16:13:00.000Z')
  });

  const result = await main({ action: 'refund.query', payload: { refundId: 'refund-a' } });

  assert.equal(result.success, true);
  assert.equal(result.data.refund.status, 'SUCCESS');
  assert.equal(result.data.order.paymentStatus, 'PARTIALLY_REFUNDED');
  assert.equal(result.data.order.refundedAmountCents, 1000);
});

test('退款成功后迟到的支付通知不会把退款状态回滚为已支付', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    orders: [paidOrder({
      paymentStatus: 'PARTIALLY_REFUNDED',
      refundedAmountCents: 1000,
      afterSalesStatus: 'RESOLVED'
    })],
    payment_records: [{
      _id: 'payment-a', orderId: 'order-a', orderNo: 'BBX202607280001',
      outTradeNo: 'BBX202607280001', transactionId: '4200000000202607280001',
      amountCents: 2500, status: 'PARTIAL_REFUND', version: 3
    }],
    refund_records: [{
      _id: 'refund-a', orderId: 'order-a', outRefundNo: 'BBXR202607280001',
      amountCents: 1000, status: 'SUCCESS', version: 3
    }],
    user_coupons: [], order_logs: [], messages: []
  });
  const wechatPay = {
    parseNotification() {
      return {
        id: 'EV-TRANSACTION-LATE', eventType: 'TRANSACTION.SUCCESS',
        resource: {
          mchid: '1900000109', appid: 'wx373cd5ed5680a30d',
          out_trade_no: 'BBX202607280001', transaction_id: '4200000000202607280001',
          trade_state: 'SUCCESS', success_time: '2026-07-28T16:01:00+08:00',
          amount: { total: 2500, payer_total: 2500, currency: 'CNY' },
          payer: { openid: 'openid-customer-a' }
        }
      };
    }
  };
  const { createPaymentNotificationHandler } = require('../cloudfunctions/payment/handler');
  const notifyMain = createPaymentNotificationHandler({
    cloud, wechatPay,
    config: { appid: 'wx373cd5ed5680a30d', mchid: '1900000109' },
    now: () => new Date('2026-07-28T17:00:00.000Z')
  });

  const response = await notifyMain({ headers: {}, rawBody: 'late-payment-notification' });
  const { createOrderHandler } = require('../cloudfunctions/order/handler');
  const detail = await createOrderHandler({ cloud })({
    action: 'detail', payload: { orderId: 'order-a' }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(detail.data.order.paymentStatus, 'PARTIALLY_REFUNDED');
  assert.equal(detail.data.order.refundedAmountCents, 1000);
  assert.equal(detail.data.timeline.length, 0);
});

test('财务执行 T+1 对账时记录微信账单与本地实收金额差异', async () => {
  const cloud = createMemoryCloud({
    users: [customer()],
    admin_users: [adminUser('role-finance', {
      _id: 'admin-finance', authSubjectId: 'openid-finance', displayName: '财务'
    })],
    roles: [adminRole('role-finance', 'FINANCE', ['payment.reconcile'])],
    payment_records: [{
      _id: 'payment-a', orderId: 'order-a', orderNo: 'BBX202607270001',
      outTradeNo: 'BBX202607270001', transactionId: '4200000000202607270001',
      amountCents: 2500, status: 'SUCCESS',
      paidAt: new Date('2026-07-27T08:01:00.000Z')
    }],
    refund_records: [],
    reconciliation_records: []
  }, 'openid-finance');
  const bill = [
    '交易时间,微信订单号,商户订单号,订单金额,微信退款单号,商户退款单号,退款金额',
    '`2026-07-27 16:01:00,`4200000000202607270001,`BBX202607270001,`24.00,`,`,`,',
    '总交易单数,总交易额,总退款金额',
    '`1,`24.00,`0.00'
  ].join('\n');
  const wechatPay = {
    async downloadTradeBill(billDate) {
      assert.equal(billDate, '2026-07-27');
      return { hashType: 'SHA1', hashValue: 'verified-sha1', content: bill };
    }
  };
  const { createPaymentHandler } = require('../cloudfunctions/payment/handler');
  const main = createPaymentHandler({
    cloud, wechatPay,
    now: () => new Date('2026-07-28T02:00:00.000Z')
  });

  const result = await main({ action: 'reconcile.daily', payload: { billDate: '2026-07-27' } });

  assert.equal(result.success, true);
  assert.equal(result.data.reconciliation.status, 'DIFFERENCE');
  assert.equal(result.data.reconciliation.billDate, '2026-07-27');
  assert.deepEqual(result.data.reconciliation.differences, [{
    type: 'PAYMENT_AMOUNT_MISMATCH',
    outTradeNo: 'BBX202607270001',
    localAmountCents: 2500,
    billAmountCents: 2400
  }]);
});
