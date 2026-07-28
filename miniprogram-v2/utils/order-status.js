// 服务订单三维状态 → 前台标签、可用操作和展示信息映射
// 依据 docs/database.md §2.3 顾客订单标签映射

// 顾客可见标签
const TABS = [
  { key: 'all', name: '全部' },
  { key: 'unpaid', name: '待付款' },
  { key: 'waiting', name: '待服务' },
  { key: 'inProgress', name: '进行中' },
  { key: 'completed', name: '已完成' }
];

// 三维状态 → 顾客标签
function orderTab(order) {
  const ps = order.paymentStatus;
  const fs = order.fulfillmentStatus;
  if (ps === 'UNPAID' && fs === 'NOT_STARTED') return 'unpaid';
  if (ps === 'PAID' && (fs === 'PENDING_ASSIGNMENT' || fs === 'WAITING_START')) return 'waiting';
  if (fs === 'IN_SERVICE' || fs === 'WAITING_CONFIRMATION') return 'inProgress';
  if (fs === 'COMPLETED') return 'completed';
  return 'all';
}

// 顾客标签 → 中文
function tabLabel(tab) {
  const found = TABS.find((item) => item.key === tab);
  return found ? found.name : '全部';
}

// 三维状态 → 顾客可见状态文本
function statusText(order) {
  const ps = order.paymentStatus;
  const fs = order.fulfillmentStatus;
  const as = order.afterSalesStatus;
  if (as === 'REQUESTED' || as === 'PROCESSING') return '售后处理中';
  if (ps === 'CLOSED' || fs === 'CANCELLED') return '已关闭';
  if (ps === 'REFUNDED') return '已退款';
  if (ps === 'PARTIALLY_REFUNDED') return '部分退款';
  return tabLabel(orderTab(order));
}

// 状态头部标题
function statusTitle(order) {
  const tab = orderTab(order);
  const titles = {
    unpaid: '订单等待支付',
    waiting: '爆爆熊正在安排陪玩',
    inProgress: order.fulfillmentStatus === 'WAITING_CONFIRMATION'
      ? '服务已完成，请确认'
      : '陪玩服务进行中',
    completed: '服务已完成'
  };
  return titles[tab] || '查看订单进度';
}

// 履约进度索引（用于时间线展示）
function progressIndex(order) {
  const fs = order.fulfillmentStatus;
  const map = {
    NOT_STARTED: -1,
    PENDING_ASSIGNMENT: 1,
    WAITING_START: 1,
    IN_SERVICE: 2,
    WAITING_CONFIRMATION: 2,
    COMPLETED: 3,
    CANCELLED: -1
  };
  return map[fs] !== undefined ? map[fs] : 0;
}

// 三维状态 → 可用操作按钮列表
function availableActions(order) {
  const ps = order.paymentStatus;
  const fs = order.fulfillmentStatus;
  const as = order.afterSalesStatus;
  const actions = [];

  if (ps === 'UNPAID' && fs === 'NOT_STARTED') {
    actions.push({ type: 'pay', text: '去支付', primary: true, placeholder: true });
    actions.push({ type: 'cancel', text: '取消订单' });
  } else if (ps === 'PAID' && (fs === 'PENDING_ASSIGNMENT' || fs === 'WAITING_START')) {
    actions.push({ type: 'refund', text: '申请退款', placeholder: true });
  } else if (fs === 'IN_SERVICE') {
    actions.push({ type: 'complaint', text: '发起投诉', placeholder: true });
  } else if (fs === 'WAITING_CONFIRMATION' && as !== 'PROCESSING') {
    actions.push({ type: 'confirm', text: '确认完成', primary: true });
    actions.push({ type: 'dispute', text: '提出异议' });
  } else if (fs === 'COMPLETED') {
    actions.push({ type: 'review', text: '评价服务', placeholder: true });
    actions.push({ type: 'rebuy', text: '再次购买', placeholder: true });
  }

  actions.push({ type: 'contact', text: '联系客服' });
  return actions;
}

// 金额分 → 元展示
function centsToYuan(cents) {
  return (Number(cents) / 100).toFixed(2);
}

// 从订单记录提取列表卡片所需摘要
// 兼容 detail（含完整 snapshot）和 list（扁平字段）两种返回格式
function orderCardSummary(order) {
  const snapshot = order.snapshot || {};
  const service = snapshot.service || {};
  const pricing = snapshot.pricing || {};
  return {
    id: order.id || order._id,
    orderNo: order.orderNo,
    tab: orderTab(order),
    statusText: statusText(order),
    title: service.name || order.serviceName || '',
    code: service.code || order.serviceCode || '',
    unit: service.unitLabel || service.unit || '',
    quantity: pricing.quantity || order.quantity || 1,
    payableAmountCents: pricing.payableAmountCents || order.payableAmountCents || 0,
    payableYuan: centsToYuan(pricing.payableAmountCents || order.payableAmountCents || 0),
    createdAt: order.createdAt,
    version: order.version,
    actions: availableActions(order)
  };
}

module.exports = {
  TABS,
  orderTab,
  tabLabel,
  statusText,
  statusTitle,
  progressIndex,
  availableActions,
  centsToYuan,
  orderCardSummary
};
