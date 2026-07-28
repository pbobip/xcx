function failure(code, message, requestId = '') {
  return { success: false, error: { code, message }, requestId };
}

function dateValue(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  return new Date(value);
}

async function currentCustomer(db, cloud) {
  const context = cloud.getWXContext ? cloud.getWXContext() : {};
  if (!context.OPENID) return null;
  const result = await db.collection('users').where({ openid: context.OPENID }).limit(1).get();
  const user = result.data[0] || null;
  return user && user.status === 'ACTIVE' ? user : null;
}

function publicPayment(record) {
  return {
    orderId: record.orderId,
    orderNo: record.orderNo,
    outTradeNo: record.outTradeNo,
    amountCents: record.amountCents,
    status: record.status,
    expiresAt: record.expiresAt
  };
}

function isConfirmedPaymentRecord(record) {
  return record && ['SUCCESS', 'PARTIAL_REFUND', 'REFUND'].includes(record.status);
}

function publicPaymentOrder(record) {
  return {
    id: record._id,
    orderNo: record.orderNo,
    paymentStatus: record.paymentStatus,
    fulfillmentStatus: record.fulfillmentStatus,
    afterSalesStatus: record.afterSalesStatus,
    payableAmountCents: record.payableAmountCents,
    paidAmountCents: record.paidAmountCents,
    refundedAmountCents: record.refundedAmountCents,
    paidAt: record.paidAt || null
  };
}

async function ownedOrder(db, user, orderId) {
  if (typeof orderId !== 'string' || !orderId) return null;
  const result = await db.collection('orders').doc(orderId).get();
  const order = result.data;
  return order && order.userId === user._id ? order : null;
}

function paymentExpiry(order, timestamp) {
  const createdAt = dateValue(order.createdAt);
  const fromCreation = new Date(createdAt.getTime() + 30 * 60 * 1000);
  if (Number.isFinite(fromCreation.getTime()) && fromCreation > timestamp) return fromCreation;
  return new Date(timestamp.getTime() + 30 * 60 * 1000);
}

function hasRole(user, ...roles) {
  const assigned = Array.isArray(user.roles) ? user.roles : [];
  return roles.some((role) => assigned.includes(role));
}

function returnedCouponStatus(coupon, template, timestamp) {
  if (!template || template.status !== 'ACTIVE') return 'VOID';
  const validFrom = dateValue(coupon.validFrom || template.validFrom);
  const validTo = dateValue(coupon.validTo || template.validTo);
  if (Number.isFinite(validTo.getTime()) && validTo < timestamp) return 'EXPIRED';
  if (Number.isFinite(validFrom.getTime()) && validFrom > timestamp) return 'AVAILABLE';
  return 'AVAILABLE';
}

function defaultRefundNo(now) {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 17);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0');
  return `BBXR${stamp}${suffix}`;
}

function publicRefund(record) {
  return {
    id: record._id,
    orderId: record.orderId,
    outRefundNo: record.outRefundNo,
    refundId: record.refundId || null,
    amountCents: record.amountCents,
    status: record.status,
    refundedAt: record.refundedAt || null
  };
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function billCell(value) {
  return String(value || '').replace(/^\uFEFF/, '').replace(/^`/, '').trim();
}

function amountCents(value) {
  const normalized = billCell(value);
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function parseTradeBill(content) {
  const lines = String(content || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('微信支付交易账单内容为空');
  const headers = parseCsvLine(lines[0]).map(billCell);
  const records = [];
  for (const line of lines.slice(1)) {
    if (billCell(line).startsWith('总交易单数')) break;
    const cells = parseCsvLine(line);
    const record = {};
    headers.forEach((header, index) => { record[header] = billCell(cells[index]); });
    if (record['商户订单号']) records.push(record);
  }
  return records;
}

function chinaDate(value) {
  const date = dateValue(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function publicReconciliation(record) {
  return {
    id: record._id,
    billDate: record.billDate,
    status: record.status,
    hashType: record.hashType,
    hashValue: record.hashValue,
    differences: record.differences,
    checkedAt: record.checkedAt
  };
}

function createPaymentHandler({
  cloud,
  wechatPay,
  config = {},
  logger = console,
  now = () => new Date(),
  createRefundNo = () => defaultRefundNo(now())
}) {
  const db = cloud.database();

  async function createPrepay({ user, payload, requestId }) {
    const order = await ownedOrder(db, user, payload.orderId);
    if (!order) return failure('NOT_FOUND', '未找到服务订单', requestId);
    if (order.paymentStatus !== 'UNPAID' || order.fulfillmentStatus !== 'NOT_STARTED') {
      return failure('PAYMENT_STATUS_CONFLICT', '当前服务订单不能发起支付', requestId);
    }
    if (!Number.isInteger(order.payableAmountCents) || order.payableAmountCents <= 0) {
      return failure('INVALID_ARGUMENT', '服务订单应付金额无效', requestId);
    }
    const existingResult = await db.collection('payment_records')
      .where({ orderId: order._id, status: 'PREPAY' })
      .limit(1)
      .get();
    const existing = existingResult.data[0];
    const timestamp = now();
    if (existing && dateValue(existing.expiresAt) > timestamp && existing.paymentParams) {
      return {
        success: true,
        data: { payment: publicPayment(existing), paymentParams: existing.paymentParams },
        requestId
      };
    }

    const expiresAt = paymentExpiry(order, timestamp);
    const prepay = await wechatPay.createJsapiPayment({
      description: order.snapshot.service.name,
      outTradeNo: order.orderNo,
      amountCents: order.payableAmountCents,
      openid: cloud.getWXContext().OPENID,
      expiresAt
    });
    const record = {
      orderId: order._id,
      orderNo: order.orderNo,
      outTradeNo: order.orderNo,
      transactionId: null,
      amountCents: order.payableAmountCents,
      status: 'PREPAY',
      prepayId: prepay.prepayId,
      paymentParams: prepay.paymentParams,
      expiresAt,
      notifyId: null,
      paidAt: null,
      lastQueriedAt: null,
      rawSummary: null,
      requestId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      isTest: order.isTest === true
    };
    await db.collection('payment_records').add({ data: record });
    return {
      success: true,
      data: { payment: publicPayment(record), paymentParams: prepay.paymentParams },
      requestId
    };
  }

  async function queryPayment({ user, payload, requestId }) {
    const order = await ownedOrder(db, user, payload.orderId);
    if (!order) return failure('NOT_FOUND', '未找到服务订单', requestId);
    const payment = await first(db.collection('payment_records'), { orderId: order._id });
    if (!payment) return failure('PAYMENT_PENDING', '服务订单尚未创建预支付', requestId);
    if (isConfirmedPaymentRecord(payment) &&
      ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.paymentStatus)) {
      return {
        success: true,
        data: { payment: publicPayment(payment), order: publicPaymentOrder(order) },
        requestId
      };
    }

    const resource = await wechatPay.queryTransaction(payment.outTradeNo);
    const timestamp = now();
    if (resource.trade_state === 'SUCCESS') {
      validateSuccessfulTransaction({ resource, config, payment, order, user });
      const confirmed = await confirmPaymentSuccess({
        db,
        resource,
        payment,
        order,
        eventId: `QUERY:${resource.transaction_id}`,
        eventType: 'TRANSACTION.QUERY.SUCCESS',
        timestamp
      });
      return {
        success: true,
        data: {
          payment: publicPayment(confirmed.payment),
          order: publicPaymentOrder(confirmed.order)
        },
        requestId
      };
    }
    await db.collection('payment_records').doc(payment._id).update({ data: {
      status: resource.trade_state || payment.status,
      lastQueriedAt: timestamp,
      rawSummary: { tradeState: resource.trade_state || 'UNKNOWN' },
      updatedAt: timestamp,
      version: (payment.version || 1) + 1
    } });
    const latestPayment = (await db.collection('payment_records').doc(payment._id).get()).data;
    return {
      success: true,
      data: { payment: publicPayment(latestPayment), order: publicPaymentOrder(order) },
      requestId
    };
  }

  async function closePayment({ user, payload, requestId }) {
    const orderResult = await db.collection('orders').doc(payload.orderId || '').get();
    const order = orderResult.data;
    if (!order) return failure('NOT_FOUND', '未找到服务订单', requestId);
    const isOwner = order.userId === user._id;
    if (!isOwner && !hasRole(user, 'ADMIN', 'FINANCE')) {
      return failure('FORBIDDEN', '无权关闭微信支付订单', requestId);
    }
    if (order.paymentStatus === 'CLOSED') {
      const closedPayment = await first(db.collection('payment_records'), { orderId: order._id });
      return {
        success: true,
        data: { payment: publicPayment(closedPayment), order: publicPaymentOrder(order) },
        requestId
      };
    }
    if (order.paymentStatus !== 'UNPAID' || order.fulfillmentStatus !== 'NOT_STARTED') {
      return failure('PAYMENT_STATUS_CONFLICT', '当前服务订单不能关闭', requestId);
    }
    const payment = await first(db.collection('payment_records'), { orderId: order._id });
    if (!payment) return failure('PAYMENT_PENDING', '服务订单尚未创建预支付', requestId);
    const resource = await wechatPay.queryTransaction(payment.outTradeNo);
    const timestamp = now();
    if (resource.trade_state === 'SUCCESS') {
      const payerResult = await db.collection('users').doc(order.userId).get();
      validateSuccessfulTransaction({
        resource, config, payment, order, user: payerResult.data
      });
      const confirmed = await confirmPaymentSuccess({
        db, resource, payment, order,
        eventId: `QUERY:${resource.transaction_id}`,
        eventType: 'TRANSACTION.QUERY.SUCCESS',
        timestamp
      });
      return {
        success: true,
        data: { payment: publicPayment(confirmed.payment), order: publicPaymentOrder(confirmed.order) },
        requestId
      };
    }
    if (!['NOTPAY', 'CLOSED'].includes(resource.trade_state)) {
      return failure('PAYMENT_PENDING', '微信支付结果仍在处理中，暂不能关单', requestId);
    }
    if (resource.trade_state === 'NOTPAY') await wechatPay.closeTransaction(payment.outTradeNo);

    await db.runTransaction(async (transaction) => {
      const currentOrder = (await transaction.collection('orders').doc(order._id).get()).data;
      const currentPayment = (await transaction.collection('payment_records').doc(payment._id).get()).data;
      if (currentOrder.paymentStatus === 'CLOSED') return;
      if (currentOrder.paymentStatus !== 'UNPAID' || isConfirmedPaymentRecord(currentPayment)) {
        throw new Error('关单时支付状态已变化');
      }
      if (currentOrder.userCouponId) {
        const coupon = (await transaction.collection('user_coupons')
          .doc(currentOrder.userCouponId).get()).data;
        if (coupon && coupon.status === 'LOCKED' && coupon.lockedOrderId === currentOrder._id) {
          const template = (await transaction.collection('coupon_templates')
            .doc(coupon.templateId).get()).data;
          await transaction.collection('user_coupons').doc(coupon._id).update({ data: {
            status: returnedCouponStatus(coupon, template, timestamp),
            lockedOrderId: null,
            lockedAt: null,
            updatedAt: timestamp,
            version: (coupon.version || 1) + 1
          } });
        }
      }
      await transaction.collection('payment_records').doc(payment._id).update({ data: {
        status: 'CLOSED', lastQueriedAt: timestamp,
        rawSummary: { tradeState: resource.trade_state }, updatedAt: timestamp,
        version: (currentPayment.version || 1) + 1
      } });
      await transaction.collection('orders').doc(order._id).update({ data: {
        paymentStatus: 'CLOSED', fulfillmentStatus: 'CANCELLED', closedAt: timestamp,
        updatedAt: timestamp, version: (currentOrder.version || 1) + 1
      } });
      const commonLog = {
        orderId: currentOrder._id, orderNo: currentOrder.orderNo,
        action: 'PAYMENT_CLOSE', actorType: isOwner ? 'CUSTOMER' : 'ADMIN', actorId: user._id,
        internalReason: payload.reason || '支付超时', requestId,
        createdAt: timestamp, updatedAt: timestamp, version: 1,
        isTest: currentOrder.isTest === true
      };
      await transaction.collection('order_logs').add({ data: Object.assign({}, commonLog, {
        statusDimension: 'PAYMENT', fromStatus: 'UNPAID', toStatus: 'CLOSED',
        customerVisible: true, customerMessage: '未付款服务订单已关闭'
      }) });
      await transaction.collection('order_logs').add({ data: Object.assign({}, commonLog, {
        statusDimension: 'FULFILLMENT', fromStatus: 'NOT_STARTED', toStatus: 'CANCELLED',
        customerVisible: false, customerMessage: ''
      }) });
    });
    const latestPayment = (await db.collection('payment_records').doc(payment._id).get()).data;
    const latestOrder = (await db.collection('orders').doc(order._id).get()).data;
    return {
      success: true,
      data: { payment: publicPayment(latestPayment), order: publicPaymentOrder(latestOrder) },
      requestId
    };
  }

  async function requestRefund({ user, event, payload, requestId }) {
    if (!hasRole(user, 'ADMIN', 'CUSTOMER_SERVICE')) {
      return failure('FORBIDDEN', '无权发起退款', requestId);
    }
    const idempotencyKey = event.idempotencyKey;
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 64) {
      return failure('INVALID_ARGUMENT', '退款必须提供有效的幂等键', requestId);
    }
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (!reason || reason.length > 80) {
      return failure('INVALID_ARGUMENT', '退款原因不能为空且不能超过 80 个字符', requestId);
    }
    if (!Number.isInteger(payload.amountCents) || payload.amountCents <= 0) {
      return failure('INVALID_ARGUMENT', '退款金额必须为正整数分', requestId);
    }
    const requestHash = JSON.stringify({
      orderId: payload.orderId,
      amountCents: payload.amountCents,
      reason
    });
    const existing = await first(db.collection('refund_records'), { idempotencyKey });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return failure('IDEMPOTENCY_CONFLICT', '同一退款幂等键不能提交不同内容', requestId);
      }
      return { success: true, data: { refund: publicRefund(existing) }, requestId };
    }

    const orderResult = await db.collection('orders').doc(payload.orderId || '').get();
    const order = orderResult.data;
    if (!order) return failure('NOT_FOUND', '未找到服务订单', requestId);
    if (!['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus)) {
      return failure('PAYMENT_STATUS_CONFLICT', '当前支付状态不能退款', requestId);
    }
    const payment = await first(db.collection('payment_records'), { orderId: order._id });
    if (!isConfirmedPaymentRecord(payment)) {
      return failure('PAYMENT_STATUS_CONFLICT', '没有可退款的成功支付记录', requestId);
    }
    const refundResult = await db.collection('refund_records').where({ orderId: order._id }).get();
    const reservedAmount = refundResult.data
      .filter((item) => ['CREATING', 'PROCESSING'].includes(item.status))
      .reduce((sum, item) => sum + item.amountCents, 0);
    const refundable = order.paidAmountCents - (order.refundedAmountCents || 0) - reservedAmount;
    if (payload.amountCents > refundable) {
      return failure('REFUND_AMOUNT_EXCEEDED', '累计退款金额不能超过实付金额', requestId);
    }

    const timestamp = now();
    const outRefundNo = createRefundNo();
    const addResult = await db.collection('refund_records').add({ data: {
      orderId: order._id,
      orderNo: order.orderNo,
      refundNo: outRefundNo,
      outRefundNo,
      refundId: null,
      amountCents: payload.amountCents,
      reason,
      status: 'CREATING',
      requestedBy: user._id,
      approvedBy: hasRole(user, 'ADMIN') ? user._id : null,
      notifyId: null,
      refundedAt: null,
      idempotencyKey,
      requestHash,
      requestId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      isTest: order.isTest === true
    } });
    let response;
    try {
      response = await wechatPay.createRefund({
        outTradeNo: payment.outTradeNo,
        outRefundNo,
        reason,
        amountCents: payload.amountCents,
        totalAmountCents: payment.amountCents
      });
    } catch (error) {
      await db.collection('refund_records').doc(addResult._id).update({ data: {
        status: 'UNKNOWN', updatedAt: now(), version: 2
      } });
      throw error;
    }
    const acceptedStatus = response.status || 'PROCESSING';
    await db.collection('refund_records').doc(addResult._id).update({ data: {
      refundId: response.refund_id || null,
      status: acceptedStatus,
      updatedAt: now(),
      version: 2
    } });
    await db.collection('orders').doc(order._id).update({ data: {
      afterSalesStatus: 'REFUNDING',
      updatedAt: now(),
      version: (order.version || 1) + 1
    } });
    const created = (await db.collection('refund_records').doc(addResult._id).get()).data;
    return { success: true, data: { refund: publicRefund(created) }, requestId };
  }

  async function queryRefund({ user, payload, requestId }) {
    if (!hasRole(user, 'ADMIN', 'FINANCE')) {
      return failure('FORBIDDEN', '无权查询退款', requestId);
    }
    const refundResult = await db.collection('refund_records').doc(payload.refundId || '').get();
    const refund = refundResult.data;
    if (!refund) return failure('NOT_FOUND', '退款记录不存在', requestId);
    const order = (await db.collection('orders').doc(refund.orderId).get()).data;
    if (!order) return failure('NOT_FOUND', '退款关联的服务订单不存在', requestId);
    if (refund.status === 'SUCCESS') {
      return {
        success: true,
        data: { refund: publicRefund(refund), order: publicPaymentOrder(order) },
        requestId
      };
    }
    const resource = await wechatPay.queryRefund(refund.outRefundNo);
    const timestamp = now();
    if (resource.status === 'SUCCESS') {
      const payment = await first(db.collection('payment_records'), { orderId: refund.orderId });
      validateSuccessfulRefund({ resource, refund, payment, order });
      const confirmed = await confirmRefundSuccess({
        db,
        resource,
        refund,
        payment,
        order,
        eventId: `QUERY_REFUND:${resource.refund_id}`,
        notificationId: null,
        timestamp
      });
      return {
        success: true,
        data: {
          refund: publicRefund(confirmed.refund),
          order: publicPaymentOrder(confirmed.order)
        },
        requestId
      };
    }
    await db.collection('refund_records').doc(refund._id).update({ data: {
      status: resource.status || refund.status,
      updatedAt: timestamp,
      version: (refund.version || 1) + 1
    } });
    const latest = (await db.collection('refund_records').doc(refund._id).get()).data;
    return {
      success: true,
      data: { refund: publicRefund(latest), order: publicPaymentOrder(order) },
      requestId
    };
  }

  async function reconcileDaily({ user, payload, requestId }) {
    if (!hasRole(user, 'ADMIN', 'FINANCE')) {
      return failure('FORBIDDEN', '无权执行支付对账', requestId);
    }
    const billDate = payload.billDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate || '')) {
      return failure('INVALID_ARGUMENT', '账单日期格式必须为 YYYY-MM-DD', requestId);
    }
    const today = chinaDate(now());
    if (billDate >= today) {
      return failure('INVALID_ARGUMENT', '只能对账已结束的自然日', requestId);
    }
    const bill = await wechatPay.downloadTradeBill(billDate);
    const rows = parseTradeBill(bill.content);
    const billPayments = new Map();
    const billRefunds = new Map();
    for (const row of rows) {
      if (!billPayments.has(row['商户订单号'])) billPayments.set(row['商户订单号'], row);
      if (row['商户退款单号']) billRefunds.set(row['商户退款单号'], row);
    }

    const allPayments = (await db.collection('payment_records').where({}).get()).data;
    const localPayments = allPayments.filter((record) =>
      ['SUCCESS', 'PARTIAL_REFUND', 'REFUND'].includes(record.status) &&
      chinaDate(record.paidAt) === billDate
    );
    const allRefunds = (await db.collection('refund_records').where({}).get()).data;
    const localRefunds = allRefunds.filter((record) =>
      record.status === 'SUCCESS' && chinaDate(record.refundedAt) === billDate
    );
    const differences = [];
    const localPaymentMap = new Map(localPayments.map((item) => [item.outTradeNo, item]));
    for (const [outTradeNo, row] of billPayments) {
      const local = localPaymentMap.get(outTradeNo);
      if (!local) {
        differences.push({ type: 'PAYMENT_MISSING_LOCAL', outTradeNo });
        continue;
      }
      const billAmountCents = amountCents(row['订单金额'] || row['应结订单金额']);
      if (billAmountCents !== local.amountCents) {
        differences.push({
          type: 'PAYMENT_AMOUNT_MISMATCH', outTradeNo,
          localAmountCents: local.amountCents, billAmountCents
        });
      } else if (row['微信订单号'] && row['微信订单号'] !== local.transactionId) {
        differences.push({
          type: 'PAYMENT_TRANSACTION_MISMATCH', outTradeNo,
          localTransactionId: local.transactionId, billTransactionId: row['微信订单号']
        });
      }
      localPaymentMap.delete(outTradeNo);
    }
    for (const outTradeNo of localPaymentMap.keys()) {
      differences.push({ type: 'PAYMENT_MISSING_BILL', outTradeNo });
    }
    const localRefundMap = new Map(localRefunds.map((item) => [item.outRefundNo, item]));
    for (const [outRefundNo, row] of billRefunds) {
      const local = localRefundMap.get(outRefundNo);
      if (!local) {
        differences.push({ type: 'REFUND_MISSING_LOCAL', outRefundNo });
        continue;
      }
      const billAmountCents = amountCents(row['退款金额']);
      if (billAmountCents !== local.amountCents) {
        differences.push({
          type: 'REFUND_AMOUNT_MISMATCH', outRefundNo,
          localAmountCents: local.amountCents, billAmountCents
        });
      }
      localRefundMap.delete(outRefundNo);
    }
    for (const outRefundNo of localRefundMap.keys()) {
      differences.push({ type: 'REFUND_MISSING_BILL', outRefundNo });
    }

    const timestamp = now();
    const record = {
      billDate,
      status: differences.length ? 'DIFFERENCE' : 'MATCHED',
      hashType: bill.hashType,
      hashValue: bill.hashValue,
      paymentCount: localPayments.length,
      refundCount: localRefunds.length,
      differences,
      checkedAt: timestamp,
      checkedBy: user._id,
      requestId,
      updatedAt: timestamp
    };
    const existing = await first(db.collection('reconciliation_records'), { billDate });
    if (existing) {
      await db.collection('reconciliation_records').doc(existing._id).update({
        data: Object.assign({}, record, { version: (existing.version || 1) + 1 })
      });
      record._id = existing._id;
    } else {
      const added = await db.collection('reconciliation_records').add({
        data: Object.assign({}, record, { createdAt: timestamp, version: 1 })
      });
      record._id = added._id;
    }
    return {
      success: true,
      data: { reconciliation: publicReconciliation(record) },
      requestId
    };
  }

  return async function main(event = {}) {
    const requestId = event.requestId || '';
    try {
      const user = await currentCustomer(db, cloud);
      if (!user) return failure('UNAUTHENTICATED', '请先完成微信登录', requestId);
      if (event.action === 'prepay.create') {
        return createPrepay({ user, payload: event.payload || {}, requestId });
      }
      if (event.action === 'query') {
        return queryPayment({ user, payload: event.payload || {}, requestId });
      }
      if (event.action === 'close') {
        return closePayment({ user, payload: event.payload || {}, requestId });
      }
      if (event.action === 'refund.request') {
        return requestRefund({
          user, event, payload: event.payload || {}, requestId
        });
      }
      if (event.action === 'refund.query') {
        return queryRefund({ user, payload: event.payload || {}, requestId });
      }
      if (event.action === 'reconcile.daily') {
        return reconcileDaily({ user, payload: event.payload || {}, requestId });
      }
      return failure('INVALID_ARGUMENT', '不支持的支付动作', requestId);
    } catch (error) {
      logger.error('payment action failed', {
        action: event.action || '',
        requestId,
        code: error && error.code ? error.code : 'UNKNOWN'
      });
      return failure('INTERNAL_ERROR', '支付暂时无法处理，请稍后重试', requestId);
    }
  };
}

function notificationResponse(statusCode, code, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, message })
  };
}

async function first(collection, query) {
  const result = await collection.where(query).limit(1).get();
  return result.data[0] || null;
}

function paymentTime(value, fallback) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function validateSuccessfulTransaction({ resource, config, payment, order, user }) {
  if (resource.appid !== config.appid || resource.mchid !== config.mchid) {
    throw new Error('支付结果商户身份不匹配');
  }
  if (resource.trade_state !== 'SUCCESS') throw new Error('支付结果不是成功状态');
  if (!resource.amount || resource.amount.currency !== 'CNY') {
    throw new Error('支付结果币种无效');
  }
  if (!resource.payer || resource.payer.openid !== user.openid) {
    throw new Error('支付结果顾客身份不匹配');
  }
  if (
    resource.amount.total !== payment.amountCents ||
    resource.amount.total !== order.payableAmountCents ||
    !Number.isInteger(resource.amount.payer_total) ||
    resource.amount.payer_total < 0 ||
    resource.amount.payer_total > resource.amount.total
  ) {
    const mismatch = new Error('支付结果金额不一致');
    mismatch.code = 'PAYMENT_AMOUNT_MISMATCH';
    throw mismatch;
  }
}

async function confirmPaymentSuccess({
  db,
  resource,
  payment,
  order,
  eventId,
  eventType,
  timestamp
}) {
  const paidAt = paymentTime(resource.success_time, timestamp);
  await db.runTransaction(async (transaction) => {
    const txPayments = transaction.collection('payment_records');
    const txOrders = transaction.collection('orders');
    const currentPayment = (await txPayments.doc(payment._id).get()).data;
    if (isConfirmedPaymentRecord(currentPayment)) return;
    const currentOrder = (await txOrders.doc(order._id).get()).data;

    await txPayments.doc(payment._id).update({ data: {
      status: 'SUCCESS',
      transactionId: resource.transaction_id,
      notifyId: eventType === 'TRANSACTION.SUCCESS' ? eventId : currentPayment.notifyId,
      paidAt,
      lastQueriedAt: eventType === 'TRANSACTION.SUCCESS' ? currentPayment.lastQueriedAt : timestamp,
      rawSummary: {
        eventType,
        tradeState: resource.trade_state,
        bankType: resource.bank_type || ''
      },
      updatedAt: timestamp,
      version: (currentPayment.version || 1) + 1
    } });
    await txOrders.doc(order._id).update({ data: {
      paymentStatus: 'PAID',
      fulfillmentStatus: 'PENDING_ASSIGNMENT',
      paidAmountCents: resource.amount.payer_total,
      paidAt,
      updatedAt: timestamp,
      version: (currentOrder.version || 1) + 1
    } });

    if (currentOrder.userCouponId) {
      const coupon = (await transaction.collection('user_coupons')
        .where({ _id: currentOrder.userCouponId, status: 'LOCKED', lockedOrderId: currentOrder._id })
        .limit(1).get()).data[0];
      if (coupon) {
        await transaction.collection('user_coupons').doc(coupon._id).update({ data: {
          status: 'USED', lockedOrderId: null, usedOrderId: currentOrder._id,
          usedAt: paidAt, updatedAt: timestamp, version: (coupon.version || 1) + 1
        } });
      }
    }

    const commonLog = {
      orderId: currentOrder._id,
      orderNo: currentOrder.orderNo,
      action: 'PAYMENT_SUCCESS',
      actorType: 'WECHAT_PAY',
      actorId: resource.transaction_id,
      customerVisible: true,
      customerMessage: '微信支付已确认，正在等待平台派单',
      internalReason: '',
      requestId: eventId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      isTest: currentOrder.isTest === true
    };
    await transaction.collection('order_logs').add({ data: Object.assign({}, commonLog, {
      statusDimension: 'PAYMENT', fromStatus: currentOrder.paymentStatus, toStatus: 'PAID'
    }) });
    await transaction.collection('order_logs').add({ data: Object.assign({}, commonLog, {
      statusDimension: 'FULFILLMENT',
      fromStatus: currentOrder.fulfillmentStatus,
      toStatus: 'PENDING_ASSIGNMENT'
    }) });
    await transaction.collection('messages').add({ data: {
      userId: currentOrder.userId, type: 'PAYMENT_SUCCESS', title: '支付成功',
      summary: '服务订单支付已确认，平台将尽快安排服务', orderId: currentOrder._id,
      isRead: false, createdAt: timestamp, updatedAt: timestamp, version: 1,
      isTest: currentOrder.isTest === true
    } });
  });
  return {
    payment: (await db.collection('payment_records').doc(payment._id).get()).data,
    order: (await db.collection('orders').doc(order._id).get()).data
  };
}

function createPaymentNotificationHandler({
  cloud,
  wechatPay,
  config,
  logger = console,
  now = () => new Date()
}) {
  const db = cloud.database();

  return async function paymentNotification(event = {}) {
    let notification;
    try {
      notification = wechatPay.parseNotification({
        headers: event.headers || {},
        rawBody: event.rawBody || ''
      });
    } catch (error) {
      logger.warn('payment notification rejected', { code: 'SIGNATURE_OR_DECRYPT_FAILED' });
      return notificationResponse(401, 'FAIL', '签名验证或解密失败');
    }

    try {
      if (notification.eventType !== 'TRANSACTION.SUCCESS') {
        throw new Error('不支持的支付通知类型');
      }
      const resource = notification.resource || {};
      if (resource.appid !== config.appid || resource.mchid !== config.mchid) {
        throw new Error('支付通知商户身份不匹配');
      }
      if (resource.trade_state !== 'SUCCESS') throw new Error('支付结果不是成功状态');
      if (!resource.amount || resource.amount.currency !== 'CNY') {
        throw new Error('支付通知币种无效');
      }

      const existingNotification = await first(
        db.collection('payment_records'),
        { notifyId: notification.id }
      );
      if (existingNotification) return notificationResponse(200, 'SUCCESS', '成功');
      const existingTransaction = await first(
        db.collection('payment_records'),
        { transactionId: resource.transaction_id }
      );
      if (isConfirmedPaymentRecord(existingTransaction)) {
        return notificationResponse(200, 'SUCCESS', '成功');
      }

      const payment = await first(
        db.collection('payment_records'),
        { outTradeNo: resource.out_trade_no }
      );
      if (!payment) throw new Error('支付记录不存在');
      const orderResult = await db.collection('orders').doc(payment.orderId).get();
      const order = orderResult.data;
      if (!order) throw new Error('服务订单不存在');
      const userResult = await db.collection('users').doc(order.userId).get();
      const user = userResult.data;
      if (!user || !resource.payer || resource.payer.openid !== user.openid) {
        throw new Error('支付通知顾客身份不匹配');
      }
      if (
        resource.amount.total !== payment.amountCents ||
        resource.amount.total !== order.payableAmountCents ||
        !Number.isInteger(resource.amount.payer_total) ||
        resource.amount.payer_total < 0 ||
        resource.amount.payer_total > resource.amount.total
      ) {
        const mismatch = new Error('支付通知金额不一致');
        mismatch.code = 'PAYMENT_AMOUNT_MISMATCH';
        throw mismatch;
      }

      const timestamp = now();
      const paidAt = paymentTime(resource.success_time, timestamp);
      await db.runTransaction(async (transaction) => {
        const txPayments = transaction.collection('payment_records');
        const txOrders = transaction.collection('orders');
        const currentPayment = (await txPayments.doc(payment._id).get()).data;
        if (currentPayment.notifyId === notification.id || currentPayment.status === 'SUCCESS') return;
        const currentOrder = (await txOrders.doc(order._id).get()).data;

        await txPayments.doc(payment._id).update({ data: {
          status: 'SUCCESS',
          transactionId: resource.transaction_id,
          notifyId: notification.id,
          paidAt,
          rawSummary: {
            eventType: notification.eventType,
            tradeState: resource.trade_state,
            bankType: resource.bank_type || ''
          },
          updatedAt: timestamp,
          version: (currentPayment.version || 1) + 1
        } });
        await txOrders.doc(order._id).update({ data: {
          paymentStatus: 'PAID',
          fulfillmentStatus: 'PENDING_ASSIGNMENT',
          paidAmountCents: resource.amount.payer_total,
          paidAt,
          updatedAt: timestamp,
          version: (currentOrder.version || 1) + 1
        } });

        if (currentOrder.userCouponId) {
          const coupon = (await transaction.collection('user_coupons')
            .where({ _id: currentOrder.userCouponId, status: 'LOCKED', lockedOrderId: currentOrder._id })
            .limit(1).get()).data[0];
          if (coupon) {
            await transaction.collection('user_coupons').doc(coupon._id).update({ data: {
              status: 'USED',
              lockedOrderId: null,
              usedOrderId: currentOrder._id,
              usedAt: paidAt,
              updatedAt: timestamp,
              version: (coupon.version || 1) + 1
            } });
          }
        }

        const commonLog = {
          orderId: currentOrder._id,
          orderNo: currentOrder.orderNo,
          action: 'PAYMENT_SUCCESS',
          actorType: 'WECHAT_PAY',
          actorId: resource.transaction_id,
          customerVisible: true,
          customerMessage: '微信支付已确认，正在等待平台派单',
          internalReason: '',
          requestId: notification.id,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
          isTest: currentOrder.isTest === true
        };
        await transaction.collection('order_logs').add({ data: Object.assign({}, commonLog, {
          statusDimension: 'PAYMENT',
          fromStatus: currentOrder.paymentStatus,
          toStatus: 'PAID'
        }) });
        await transaction.collection('order_logs').add({ data: Object.assign({}, commonLog, {
          statusDimension: 'FULFILLMENT',
          fromStatus: currentOrder.fulfillmentStatus,
          toStatus: 'PENDING_ASSIGNMENT'
        }) });
        await transaction.collection('messages').add({ data: {
          userId: currentOrder.userId,
          type: 'PAYMENT_SUCCESS',
          title: '支付成功',
          summary: '服务订单支付已确认，平台将尽快安排服务',
          orderId: currentOrder._id,
          isRead: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
          isTest: currentOrder.isTest === true
        } });
      });
      return notificationResponse(200, 'SUCCESS', '成功');
    } catch (error) {
      logger.error('payment notification failed', {
        notificationId: notification.id || '',
        code: error && error.code ? error.code : 'INVALID_NOTIFICATION'
      });
      return notificationResponse(500, 'FAIL', '通知处理失败');
    }
  };
}

function validateSuccessfulRefund({ resource, refund, payment, order }) {
  if (!payment) throw new Error('退款关联的支付记录不存在');
  if (
    resource.out_trade_no !== payment.outTradeNo ||
    resource.transaction_id !== payment.transactionId ||
    resource.out_refund_no !== refund.outRefundNo ||
    (refund.refundId && resource.refund_id !== refund.refundId) ||
    !resource.amount ||
    resource.amount.refund !== refund.amountCents ||
    resource.amount.total !== payment.amountCents ||
    resource.amount.payer_total !== order.paidAmountCents ||
    !Number.isInteger(resource.amount.payer_refund) ||
    resource.amount.payer_refund < 0 ||
    resource.amount.payer_refund > refund.amountCents
  ) {
    throw new Error('退款结果金额或关联标识不一致');
  }
}

async function confirmRefundSuccess({
  db,
  resource,
  refund,
  payment,
  order,
  eventId,
  notificationId,
  timestamp
}) {
  const refundedAt = paymentTime(resource.success_time, timestamp);
  await db.runTransaction(async (transaction) => {
    const currentRefund = (await transaction.collection('refund_records')
      .doc(refund._id).get()).data;
    if (currentRefund.status === 'SUCCESS') return;
    const currentOrder = (await transaction.collection('orders').doc(order._id).get()).data;
    const currentPayment = (await transaction.collection('payment_records')
      .doc(payment._id).get()).data;
    const refundedAmountCents = (currentOrder.refundedAmountCents || 0) + resource.amount.payer_refund;
    if (refundedAmountCents > currentOrder.paidAmountCents) {
      throw new Error('累计退款金额超过实付金额');
    }
    const isFullRefund = refundedAmountCents === currentOrder.paidAmountCents;
    const paymentStatus = isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const fulfillmentStatus = isFullRefund && ['PENDING_ASSIGNMENT', 'WAITING_START'].includes(currentOrder.fulfillmentStatus)
      ? 'CANCELLED'
      : currentOrder.fulfillmentStatus;

    await transaction.collection('refund_records').doc(refund._id).update({ data: {
      status: 'SUCCESS',
      refundId: resource.refund_id,
      notifyId: notificationId || currentRefund.notifyId,
      refundedAt,
      updatedAt: timestamp,
      version: (currentRefund.version || 1) + 1
    } });
    await transaction.collection('payment_records').doc(payment._id).update({ data: {
      status: isFullRefund ? 'REFUND' : 'PARTIAL_REFUND',
      updatedAt: timestamp,
      version: (currentPayment.version || 1) + 1
    } });
    await transaction.collection('orders').doc(order._id).update({ data: {
      paymentStatus,
      fulfillmentStatus,
      afterSalesStatus: 'RESOLVED',
      refundedAmountCents,
      updatedAt: timestamp,
      version: (currentOrder.version || 1) + 1
    } });
    const commonLog = {
      orderId: currentOrder._id, orderNo: currentOrder.orderNo,
      action: 'REFUND_SUCCESS', actorType: 'WECHAT_PAY', actorId: resource.refund_id,
      customerVisible: true,
      customerMessage: isFullRefund ? '退款已原路退回' : '部分退款已原路退回',
      internalReason: currentRefund.reason || '', requestId: eventId,
      createdAt: timestamp, updatedAt: timestamp, version: 1,
      isTest: currentOrder.isTest === true
    };
    await transaction.collection('order_logs').add({ data: Object.assign({}, commonLog, {
      statusDimension: 'PAYMENT', fromStatus: currentOrder.paymentStatus, toStatus: paymentStatus
    }) });
    await transaction.collection('order_logs').add({ data: Object.assign({}, commonLog, {
      statusDimension: 'AFTER_SALES', fromStatus: currentOrder.afterSalesStatus, toStatus: 'RESOLVED'
    }) });
    await transaction.collection('messages').add({ data: {
      userId: currentOrder.userId, type: 'REFUND_SUCCESS',
      title: isFullRefund ? '退款成功' : '部分退款成功',
      summary: commonLog.customerMessage, orderId: currentOrder._id, isRead: false,
      createdAt: timestamp, updatedAt: timestamp, version: 1,
      isTest: currentOrder.isTest === true
    } });
  });
  return {
    refund: (await db.collection('refund_records').doc(refund._id).get()).data,
    order: (await db.collection('orders').doc(order._id).get()).data
  };
}

function createRefundNotificationHandler({
  cloud,
  wechatPay,
  config,
  logger = console,
  now = () => new Date()
}) {
  const db = cloud.database();

  return async function refundNotification(event = {}) {
    let notification;
    try {
      notification = wechatPay.parseNotification({
        headers: event.headers || {},
        rawBody: event.rawBody || ''
      });
    } catch (_) {
      logger.warn('refund notification rejected', { code: 'SIGNATURE_OR_DECRYPT_FAILED' });
      return notificationResponse(401, 'FAIL', '签名验证或解密失败');
    }
    try {
      if (notification.eventType !== 'REFUND.SUCCESS') {
        throw new Error('不支持的退款通知类型');
      }
      const resource = notification.resource || {};
      if (resource.mchid !== config.mchid || resource.refund_status !== 'SUCCESS') {
        throw new Error('退款通知商户或状态无效');
      }
      const duplicate = await first(db.collection('refund_records'), { notifyId: notification.id });
      if (duplicate) return notificationResponse(200, 'SUCCESS', '成功');
      const refund = await first(
        db.collection('refund_records'),
        { outRefundNo: resource.out_refund_no }
      );
      if (!refund) throw new Error('退款记录不存在');
      if (refund.status === 'SUCCESS') return notificationResponse(200, 'SUCCESS', '成功');
      const order = (await db.collection('orders').doc(refund.orderId).get()).data;
      const payment = await first(db.collection('payment_records'), { orderId: refund.orderId });
      if (!order || !payment) throw new Error('退款关联的支付或服务订单不存在');
      if (
        resource.out_trade_no !== payment.outTradeNo ||
        resource.transaction_id !== payment.transactionId ||
        (refund.refundId && resource.refund_id !== refund.refundId) ||
        !resource.amount ||
        resource.amount.refund !== refund.amountCents ||
        resource.amount.total !== payment.amountCents ||
        resource.amount.payer_total !== order.paidAmountCents ||
        !Number.isInteger(resource.amount.payer_refund) ||
        resource.amount.payer_refund < 0 ||
        resource.amount.payer_refund > refund.amountCents
      ) {
        throw new Error('退款通知金额或关联标识不一致');
      }

      const timestamp = now();
      const refundedAt = paymentTime(resource.success_time, timestamp);
      await db.runTransaction(async (transaction) => {
        const currentRefund = (await transaction.collection('refund_records')
          .doc(refund._id).get()).data;
        if (currentRefund.status === 'SUCCESS' || currentRefund.notifyId === notification.id) return;
        const currentOrder = (await transaction.collection('orders').doc(order._id).get()).data;
        const currentPayment = (await transaction.collection('payment_records')
          .doc(payment._id).get()).data;
        const refundedAmountCents = (currentOrder.refundedAmountCents || 0) + resource.amount.payer_refund;
        if (refundedAmountCents > currentOrder.paidAmountCents) {
          throw new Error('累计退款金额超过实付金额');
        }
        const isFullRefund = refundedAmountCents === currentOrder.paidAmountCents;
        const paymentStatus = isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        const fulfillmentStatus = isFullRefund && ['PENDING_ASSIGNMENT', 'WAITING_START'].includes(currentOrder.fulfillmentStatus)
          ? 'CANCELLED'
          : currentOrder.fulfillmentStatus;

        await transaction.collection('refund_records').doc(refund._id).update({ data: {
          status: 'SUCCESS',
          refundId: resource.refund_id,
          notifyId: notification.id,
          refundedAt,
          updatedAt: timestamp,
          version: (currentRefund.version || 1) + 1
        } });
        await transaction.collection('payment_records').doc(payment._id).update({ data: {
          status: isFullRefund ? 'REFUND' : 'PARTIAL_REFUND',
          updatedAt: timestamp,
          version: (currentPayment.version || 1) + 1
        } });
        await transaction.collection('orders').doc(order._id).update({ data: {
          paymentStatus,
          fulfillmentStatus,
          afterSalesStatus: 'RESOLVED',
          refundedAmountCents,
          updatedAt: timestamp,
          version: (currentOrder.version || 1) + 1
        } });

        const commonLog = {
          orderId: currentOrder._id,
          orderNo: currentOrder.orderNo,
          action: 'REFUND_SUCCESS',
          actorType: 'WECHAT_PAY',
          actorId: resource.refund_id,
          customerVisible: true,
          customerMessage: isFullRefund ? '退款已原路退回' : '部分退款已原路退回',
          internalReason: currentRefund.reason || '',
          requestId: notification.id,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
          isTest: currentOrder.isTest === true
        };
        await transaction.collection('order_logs').add({ data: Object.assign({}, commonLog, {
          statusDimension: 'PAYMENT',
          fromStatus: currentOrder.paymentStatus,
          toStatus: paymentStatus
        }) });
        await transaction.collection('order_logs').add({ data: Object.assign({}, commonLog, {
          statusDimension: 'AFTER_SALES',
          fromStatus: currentOrder.afterSalesStatus,
          toStatus: 'RESOLVED'
        }) });
        await transaction.collection('messages').add({ data: {
          userId: currentOrder.userId,
          type: 'REFUND_SUCCESS',
          title: isFullRefund ? '退款成功' : '部分退款成功',
          summary: commonLog.customerMessage,
          orderId: currentOrder._id,
          isRead: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
          isTest: currentOrder.isTest === true
        } });
      });
      return notificationResponse(200, 'SUCCESS', '成功');
    } catch (error) {
      logger.error('refund notification failed', {
        notificationId: notification.id || '',
        code: error && error.code ? error.code : 'INVALID_NOTIFICATION'
      });
      return notificationResponse(500, 'FAIL', '通知处理失败');
    }
  };
}

module.exports = {
  createPaymentHandler,
  createPaymentNotificationHandler,
  createRefundNotificationHandler
};
