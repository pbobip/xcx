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

      if (!['quote', 'create'].includes(event.action)) {
        return failure('INVALID_ARGUMENT', '不支持的服务订单动作', requestId);
      }

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
