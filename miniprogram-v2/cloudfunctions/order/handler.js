const crypto = require('node:crypto');

function failure(code, message, requestId) {
  return {
    success: false,
    error: { code, message, details: {} },
    requestId: requestId || ''
  };
}

async function currentCustomer(db, cloud) {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return null;
  const result = await db.collection('users').where({ openid }).limit(1).get();
  const user = result.data[0];
  return user && user.status === 'ACTIVE' ? user : null;
}

async function activeService(db, serviceId) {
  if (!serviceId) return null;
  const result = await db.collection('services').where({ _id: serviceId }).limit(1).get();
  return result.data[0] || null;
}

function validateQuantity(service, value) {
  const quantity = Number(value);
  const minimum = Number(service.minQuantity) || 1;
  const maximum = Number(service.maxQuantity) || 99;
  if (!Number.isInteger(quantity) || quantity < minimum || quantity > maximum) return null;
  return quantity;
}

function quoteFor(service, quantity) {
  const unitPriceCents = Number(service.priceCents);
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) return null;
  const originalAmountCents = unitPriceCents * quantity;
  if (!Number.isSafeInteger(originalAmountCents)) return null;
  return {
    serviceId: service._id,
    serviceCode: service.code,
    serviceName: service.name,
    unit: service.unit,
    unitLabel: service.unitLabel,
    quantity,
    unitPriceCents,
    originalAmountCents,
    discountAmountCents: 0,
    payableAmountCents: originalAmountCents
  };
}

function isEmpty(value) {
  return value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);
}

function containsSensitiveCredential(value) {
  return /密码|验证码|支付密码|身份证(?:件|号)?|password|passcode|verification\s*code|\botp\b/i
    .test(String(value || ''));
}

function validateOrderValues(service, input) {
  const values = input && typeof input === 'object' ? input : {};
  const normalized = {};
  for (const field of service.orderFields || []) {
    const value = values[field.key];
    const validation = field.validation || {};
    const conditional = validation.requiredWhen;
    const required = field.required === true || Boolean(
      conditional && values[conditional.field] === conditional.equals
    );
    if (required && isEmpty(value)) {
      return { error: `${field.label || field.key}为必填项` };
    }
    if (isEmpty(value)) {
      normalized[field.key] = value == null ? '' : value;
      continue;
    }
    if (field.type === 'SINGLE') {
      const allowed = (field.options || []).map((option) => option.value);
      if (allowed.length && !allowed.includes(value)) {
        return { error: `${field.label || field.key}选项无效` };
      }
    }
    if (field.type === 'MULTIPLE') {
      if (!Array.isArray(value)) return { error: `${field.label || field.key}格式无效` };
      const allowed = (field.options || []).map((option) => option.value);
      if (value.some((item) => !allowed.includes(item))) {
        return { error: `${field.label || field.key}选项无效` };
      }
    }
    if (field.type === 'NUMBER' && !Number.isFinite(Number(value))) {
      return { error: `${field.label || field.key}必须为数字` };
    }
    if (field.type === 'DATETIME' && Number.isNaN(new Date(value).getTime())) {
      return { error: `${field.label || field.key}格式无效` };
    }
    if (typeof value === 'string') {
      const length = value.trim().length;
      if (validation.minLength != null && length < Number(validation.minLength)) {
        return { error: `${field.label || field.key}内容过短` };
      }
      if (validation.maxLength != null && length > Number(validation.maxLength)) {
        return { error: `${field.label || field.key}内容过长` };
      }
      if ((validation.rejectSensitiveCredentials || field.type === 'TEXT')
        && containsSensitiveCredential(value)) {
        return { sensitive: true };
      }
      normalized[field.key] = value.trim();
    } else {
      normalized[field.key] = value;
    }
  }
  if (normalized.adultConfirmed !== 'CONFIRMED') {
    return { error: '请确认本人已成年并阅读服务规则' };
  }
  return { values: normalized };
}

function snapshotFor(service, quote, orderValues) {
  return {
    service: {
      id: service._id,
      code: service.code,
      name: service.name,
      gameId: service.gameId,
      serviceTypeId: service.serviceTypeId || null,
      categoryIds: service.categoryIds || [],
      unit: service.unit,
      unitLabel: service.unitLabel,
      descriptionBlocks: service.descriptionBlocks || []
    },
    pricing: {
      quantity: quote.quantity,
      unitPriceCents: quote.unitPriceCents,
      originalAmountCents: quote.originalAmountCents,
      discountAmountCents: quote.discountAmountCents,
      payableAmountCents: quote.payableAmountCents
    },
    orderFields: service.orderFields || [],
    orderValues,
    fulfillmentStandard: service.fulfillmentStandard || '',
    purchaseNotice: service.purchaseNotice || '',
    agreement: {
      type: 'SERVICE_RULES',
      version: 'development-v1',
      title: '开发占位服务规则',
      content: '本人已成年，并已阅读换人、售后、退款与账号安全规则。',
      isDevelopmentPlaceholder: true
    }
  };
}

function defaultOrderNo(now) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0');
  return `BBX-${stamp.slice(0, 8)}-${stamp.slice(8)}-${suffix}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestHash(serviceId, quantity, orderValues) {
  return crypto.createHash('sha256').update(stableStringify({
    serviceId,
    quantity,
    orderValues
  })).digest('hex');
}

function publicOrder(record) {
  return {
    id: record._id,
    orderNo: record.orderNo,
    serviceId: record.serviceId,
    quantity: record.quantity,
    unitPriceCents: record.unitPriceCents,
    originalAmountCents: record.originalAmountCents,
    discountAmountCents: record.discountAmountCents,
    payableAmountCents: record.payableAmountCents,
    paidAmountCents: record.paidAmountCents,
    paymentStatus: record.paymentStatus,
    fulfillmentStatus: record.fulfillmentStatus,
    afterSalesStatus: record.afterSalesStatus,
    serviceMode: record.serviceMode,
    scheduledAt: record.scheduledAt,
    createdAt: record.createdAt,
    version: record.version,
    snapshot: record.snapshot
  };
}

async function handleQuoteAndCreate({ db, user, event, payload, requestId, now, createOrderNo }) {
  let createRequestHash = null;
  if (event.action === 'create') {
    if (!event.idempotencyKey || typeof event.idempotencyKey !== 'string') {
      return failure('INVALID_ARGUMENT', '缺少重复提交保护标识', requestId);
    }
    createRequestHash = requestHash(
      payload.serviceId,
      Number(payload.quantity),
      payload.orderValues && typeof payload.orderValues === 'object'
        ? payload.orderValues
        : {}
    );
    const existingResult = await db.collection('orders')
      .where({ userId: user._id, idempotencyKey: event.idempotencyKey })
      .limit(1)
      .get();
    const existing = existingResult.data[0];
    if (existing) {
      if (existing.requestHash !== createRequestHash) {
        return failure('DUPLICATE_REQUEST', '重复提交内容与原请求不一致', requestId);
      }
      return {
        success: true,
        data: { order: publicOrder(existing), reused: true },
        requestId
      };
    }
  }

  const service = await activeService(db, payload.serviceId);
  if (!service || service.status === 'OFFLINE' || service.status === 'DRAFT') {
    return failure('SERVICE_OFFLINE', '服务套餐不存在或已下架', requestId);
  }
  if (service.status !== 'ACTIVE') {
    return failure('SERVICE_PAUSED', '服务套餐当前暂停接单', requestId);
  }
  const quantity = validateQuantity(service, payload.quantity);
  if (quantity === null) {
    return failure('INVALID_ARGUMENT', '购买数量超出套餐允许范围', requestId);
  }
  const quote = quoteFor(service, quantity);
  if (!quote) return failure('INVALID_ARGUMENT', '套餐价格配置无效', requestId);

  if (event.action === 'quote') {
    return { success: true, data: { quote }, requestId };
  }
  const validated = validateOrderValues(service, payload.orderValues);
  if (validated.sensitive) {
    return failure('SENSITIVE_CONTENT', '输入包含密码、验证码或证件等敏感信息', requestId);
  }
  if (validated.error) return failure('INVALID_ARGUMENT', validated.error, requestId);

  const timestamp = now();
  const orderValues = validated.values;
  const snapshot = snapshotFor(service, quote, orderValues);
  const record = {
    orderNo: createOrderNo(timestamp),
    userId: user._id,
    serviceId: service._id,
    snapshot,
    quantity,
    unitPriceCents: quote.unitPriceCents,
    originalAmountCents: quote.originalAmountCents,
    discountAmountCents: 0,
    payableAmountCents: quote.payableAmountCents,
    paidAmountCents: 0,
    refundedAmountCents: 0,
    userCouponId: null,
    orderValues,
    serviceMode: orderValues.serviceMode,
    scheduledAt: orderValues.serviceMode === 'RESERVATION'
      ? new Date(orderValues.scheduledAt)
      : null,
    customerNote: orderValues.customerNote || '',
    paymentStatus: 'UNPAID',
    fulfillmentStatus: 'NOT_STARTED',
    afterSalesStatus: 'NONE',
    assignedStaffId: null,
    paidAt: null,
    startedAt: null,
    completedAt: null,
    closedAt: null,
    idempotencyKey: event.idempotencyKey,
    requestHash: createRequestHash,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    isTest: service.isTest === true
  };

  const outcome = await db.runTransaction(async (transaction) => {
    const orders = transaction.collection('orders');
    const existingResult = await orders
      .where({ userId: user._id, idempotencyKey: event.idempotencyKey })
      .limit(1)
      .get();
    const existing = existingResult.data[0];
    if (existing) {
      if (existing.requestHash !== createRequestHash) return { conflict: true };
      return { order: publicOrder(existing), reused: true };
    }

    const created = await orders.add({ data: record });
    const saved = Object.assign({ _id: created._id }, record);
    await transaction.collection('order_logs').add({
      data: {
        orderId: created._id,
        orderNo: record.orderNo,
        action: 'CREATE',
        statusDimension: 'PAYMENT',
        fromStatus: null,
        toStatus: 'UNPAID',
        actorType: 'CUSTOMER',
        actorId: user._id,
        customerVisible: true,
        customerMessage: '服务订单已创建，等待付款',
        internalReason: '',
        requestId,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
        isTest: service.isTest === true
      }
    });
    return { order: publicOrder(saved), reused: false };
  });

  if (outcome.conflict) {
    return failure('DUPLICATE_REQUEST', '重复提交内容与原请求不一致', requestId);
  }
  return {
    success: true,
    data: { order: outcome.order, reused: outcome.reused },
    requestId
  };
}

async function handleSummary({ db, _, user, requestId }) {
  const counts = { all: 0, unpaid: 0, waiting: 0, inProgress: 0, completed: 0 };

  counts.all = (await db.collection('orders').where({ userId: user._id }).count()).total;
  counts.unpaid = (await db.collection('orders').where({
    userId: user._id,
    paymentStatus: 'UNPAID',
    fulfillmentStatus: 'NOT_STARTED'
  }).count()).total;
  counts.waiting = (await db.collection('orders').where({
    userId: user._id,
    paymentStatus: 'PAID',
    fulfillmentStatus: _.in(['PENDING_ASSIGNMENT', 'WAITING_START'])
  }).count()).total;
  counts.inProgress = (await db.collection('orders').where({
    userId: user._id,
    fulfillmentStatus: _.in(['IN_SERVICE', 'WAITING_CONFIRMATION'])
  }).count()).total;
  counts.completed = (await db.collection('orders').where({
    userId: user._id,
    fulfillmentStatus: 'COMPLETED'
  }).count()).total;

  return { success: true, data: { counts }, requestId };
}

async function handleList({ db, _, user, payload, requestId }) {
  const { tab, cursor, limit = 10 } = payload;
  const query = { userId: user._id };

  if (tab === 'unpaid') {
    query.paymentStatus = 'UNPAID';
    query.fulfillmentStatus = 'NOT_STARTED';
  } else if (tab === 'waiting') {
    query.paymentStatus = 'PAID';
    query.fulfillmentStatus = _.in(['PENDING_ASSIGNMENT', 'WAITING_START']);
  } else if (tab === 'inProgress') {
    query.fulfillmentStatus = _.in(['IN_SERVICE', 'WAITING_CONFIRMATION']);
  } else if (tab === 'completed') {
    query.fulfillmentStatus = 'COMPLETED';
  }

  const result = await db.collection('orders').where(query).orderBy('createdAt', 'desc').get();
  let items = result.data;

  if (cursor) {
    const idx = items.findIndex(item => item._id === cursor);
    if (idx !== -1) items = items.slice(idx + 1);
  }

  const hasMore = items.length > limit;
  items = items.slice(0, limit);

  const orders = items.map(record => ({
    id: record._id,
    orderNo: record.orderNo,
    serviceId: record.serviceId,
    serviceName: record.snapshot.service.name,
    serviceCode: record.snapshot.service.code,
    quantity: record.quantity,
    payableAmountCents: record.payableAmountCents,
    paymentStatus: record.paymentStatus,
    fulfillmentStatus: record.fulfillmentStatus,
    afterSalesStatus: record.afterSalesStatus,
    createdAt: record.createdAt,
    version: record.version
  }));

  const nextCursor = hasMore ? items[items.length - 1]._id : null;
  return { success: true, data: { orders, nextCursor }, requestId };
}

function getAvailableActions(record) {
  const actions = ['contact'];
  const p = record.paymentStatus;
  const f = record.fulfillmentStatus;
  const a = record.afterSalesStatus;

  if (p === 'UNPAID' && f === 'NOT_STARTED') actions.push('cancel', 'pay');
  if (p === 'PAID' && ['PENDING_ASSIGNMENT', 'WAITING_START'].includes(f)) actions.push('refund');
  if (f === 'IN_SERVICE') actions.push('complaint');
  if (f === 'WAITING_CONFIRMATION' && a !== 'PROCESSING') actions.push('confirm', 'dispute');
  if (f === 'COMPLETED') actions.push('review', 'rebuy');

  return actions;
}

async function handleDetail({ db, user, payload, requestId }) {
  const { orderId, orderNo } = payload;
  const query = { userId: user._id };
  if (orderId) query._id = orderId;
  else if (orderNo) query.orderNo = orderNo;
  else return failure('INVALID_ARGUMENT', '必须提供订单ID或订单号', requestId);

  const result = await db.collection('orders').where(query).limit(1).get();
  const record = result.data[0];
  if (!record) return failure('NOT_FOUND', '服务订单不存在', requestId);

  const logsResult = await db.collection('order_logs').where({ orderId: record._id, customerVisible: true }).orderBy('createdAt', 'desc').get();

  return {
    success: true,
    data: {
      order: publicOrder(record),
      timeline: logsResult.data.map(log => ({
        action: log.action,
        message: log.customerMessage,
        createdAt: log.createdAt
      })),
      actions: getAvailableActions(record)
    },
    requestId
  };
}

async function handleCancel({ db, user, payload, requestId, now }) {
  const { orderId, reason, version } = payload;
  const timestamp = now();

  return await db.runTransaction(async (transaction) => {
    const orders = transaction.collection('orders');
    const result = await orders.doc(orderId).get();
    const record = result.data;

    if (!record || record.userId !== user._id) return failure('NOT_FOUND', '服务订单不存在', requestId);
    if (record.version !== version) return failure('CONFLICT', '订单状态已更新，请刷新后重试', requestId);
    if (record.paymentStatus !== 'UNPAID' || record.fulfillmentStatus !== 'NOT_STARTED') {
      return failure('PAYMENT_STATUS_CONFLICT', '订单当前状态不允许取消', requestId);
    }

    await orders.doc(orderId).update({
      data: {
        paymentStatus: 'CLOSED',
        fulfillmentStatus: 'CANCELLED',
        closedAt: timestamp,
        version: version + 1,
        updatedAt: timestamp
      }
    });

    const logs = transaction.collection('order_logs');
    await logs.add({
      data: {
        orderId, orderNo: record.orderNo,
        action: 'CANCEL', statusDimension: 'PAYMENT',
        fromStatus: 'UNPAID', toStatus: 'CLOSED',
        actorType: 'CUSTOMER', actorId: user._id,
        customerVisible: true, customerMessage: '订单已取消关闭',
        internalReason: reason || '', requestId,
        createdAt: timestamp, updatedAt: timestamp, version: 1, isTest: record.isTest
      }
    });
    await logs.add({
      data: {
        orderId, orderNo: record.orderNo,
        action: 'CANCEL', statusDimension: 'FULFILLMENT',
        fromStatus: 'NOT_STARTED', toStatus: 'CANCELLED',
        actorType: 'CUSTOMER', actorId: user._id,
        customerVisible: false, customerMessage: '',
        internalReason: reason || '', requestId,
        createdAt: timestamp, updatedAt: timestamp, version: 1, isTest: record.isTest
      }
    });

    const updated = await orders.doc(orderId).get();
    return { success: true, data: { order: publicOrder(updated.data) }, requestId };
  });
}

async function handleConfirm({ db, user, payload, requestId, now }) {
  const { orderId, version } = payload;
  const timestamp = now();

  return await db.runTransaction(async (transaction) => {
    const orders = transaction.collection('orders');
    const result = await orders.doc(orderId).get();
    const record = result.data;

    if (!record || record.userId !== user._id) return failure('NOT_FOUND', '服务订单不存在', requestId);
    if (record.version !== version) return failure('CONFLICT', '订单状态已更新，请刷新后重试', requestId);
    if (record.fulfillmentStatus !== 'WAITING_CONFIRMATION') {
      return failure('FULFILLMENT_STATUS_CONFLICT', '订单当前状态不允许确认完成', requestId);
    }
    if (record.afterSalesStatus === 'PROCESSING') {
      return failure('AFTER_SALES_STATUS_CONFLICT', '售后处理中，无法确认完成', requestId);
    }

    await orders.doc(orderId).update({
      data: {
        fulfillmentStatus: 'COMPLETED',
        completedAt: timestamp,
        version: version + 1,
        updatedAt: timestamp
      }
    });

    await transaction.collection('order_logs').add({
      data: {
        orderId, orderNo: record.orderNo,
        action: 'CONFIRM', statusDimension: 'FULFILLMENT',
        fromStatus: 'WAITING_CONFIRMATION', toStatus: 'COMPLETED',
        actorType: 'CUSTOMER', actorId: user._id,
        customerVisible: true, customerMessage: '服务已确认完成',
        internalReason: '', requestId,
        createdAt: timestamp, updatedAt: timestamp, version: 1, isTest: record.isTest
      }
    });

    const updated = await orders.doc(orderId).get();
    return { success: true, data: { order: publicOrder(updated.data) }, requestId };
  });
}

async function handleDispute({ db, user, payload, requestId, now }) {
  const { orderId, reason, description, version } = payload;
  const timestamp = now();

  return await db.runTransaction(async (transaction) => {
    const orders = transaction.collection('orders');
    const result = await orders.doc(orderId).get();
    const record = result.data;

    if (!record || record.userId !== user._id) return failure('NOT_FOUND', '服务订单不存在', requestId);
    if (record.version !== version) return failure('CONFLICT', '订单状态已更新，请刷新后重试', requestId);
    if (record.fulfillmentStatus !== 'WAITING_CONFIRMATION') {
      return failure('FULFILLMENT_STATUS_CONFLICT', '订单当前状态不允许提起异议', requestId);
    }

    await orders.doc(orderId).update({
      data: {
        afterSalesStatus: 'REQUESTED',
        version: version + 1,
        updatedAt: timestamp
      }
    });

    await transaction.collection('order_logs').add({
      data: {
        orderId, orderNo: record.orderNo,
        action: 'DISPUTE', statusDimension: 'AFTER_SALES',
        fromStatus: record.afterSalesStatus, toStatus: 'REQUESTED',
        actorType: 'CUSTOMER', actorId: user._id,
        customerVisible: true, customerMessage: '已发起服务异议',
        internalReason: `${reason}: ${description}`, requestId,
        createdAt: timestamp, updatedAt: timestamp, version: 1, isTest: record.isTest
      }
    });

    const updated = await orders.doc(orderId).get();
    return { success: true, data: { order: publicOrder(updated.data) }, requestId };
  });
}

function createOrderHandler({
  cloud,
  logger = console,
  now = () => new Date(),
  createOrderNo = defaultOrderNo
}) {
  const db = cloud.database();

  return async function main(event = {}) {
    const requestId = event.requestId || '';
    const payload = event.payload || {};
    try {
      const user = await currentCustomer(db, cloud);
      if (!user) return failure('UNAUTHENTICATED', '请先完成微信登录', requestId);

      const _ = db.command || {
        in: (arr) => ({ $in: arr }),
        neq: (val) => ({ $neq: val }),
        or: (arr) => ({ $or: arr })
      };

      const ACTIONS = {
        quote: handleQuoteAndCreate,
        create: handleQuoteAndCreate,
        summary: handleSummary,
        list: handleList,
        detail: handleDetail,
        cancel: handleCancel,
        confirm: handleConfirm,
        dispute: handleDispute
      };

      const actionHandler = ACTIONS[event.action];
      if (!actionHandler) {
        return failure('INVALID_ARGUMENT', '不支持的服务订单动作', requestId);
      }

      return await actionHandler({ db, _, user, event, payload, requestId, now, createOrderNo });
    } catch (error) {
      logger.error('order action failed', {
        action: event.action || '',
        requestId,
        code: error && error.code ? error.code : 'UNKNOWN'
      });
      return failure('INTERNAL_ERROR', '服务订单暂时无法处理，请稍后重试', requestId);
    }
  };
}

module.exports = { createOrderHandler };
