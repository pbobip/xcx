const nav = require('../../utils/nav');
const payment = require('../../utils/payment');
const auth = require('../../utils/auth');
const {
  statusText, statusTitle, progressIndex,
  availableActions, centsToYuan
} = require('../../utils/order-status');

Page({
  data: {
    loading: true,
    error: '',
    order: null,
    statusText: '',
    statusTitle: '',
    progressIndex: -1,
    actions: [],
    timeline: [],
    // 快照展示字段
    orderNo: '',
    title: '',
    quantity: 0,
    unit: '',
    standard: '',
    platform: '',
    server: '',
    payableYuan: '0.00',
    // 异议弹窗
    disputeOpen: false,
    disputeReason: '',
    disputeDescription: '',
    // 评价弹窗（占位，Issue #6 不实现提交）
    scores: [1, 2, 3, 4, 5],
    reviewScore: 5,
    reviewText: '',
    reviewOpen: false,
    // 退款弹窗（占位）
    refundOpen: false
  },

  _orderNo: '',
  _orderId: '',
  _version: 1,

  onLoad(options) {
    if (!auth.requireLogin('order-detail', 'back')) return;
    this._orderNo = options.orderNo || '';
    this._orderId = options.orderId || '';
    this.loadOrder();
  },

  onShow() {
    if (!auth.isLoggedIn()) return;
    if (this._orderNo || this._orderId) this.loadOrder();
  },

  onPullDownRefresh() {
    this.loadOrder().then(() => wx.stopPullDownRefresh());
  },

  loadOrder() {
    this.setData({ loading: true, error: '' });
    const payload = this._orderId
      ? { orderId: this._orderId }
      : { orderNo: this._orderNo };

    return wx.cloud.callFunction({
      name: 'order',
      data: { action: 'detail', payload }
    }).then((res) => {
      if (!res.result || !res.result.success) {
        const message = res.result && res.result.error
          ? res.result.error.message
          : '订单详情加载失败，请稍后重试';
        nav.toast(message);
        this.setData({ loading: false, error: message });
        return;
      }
      const order = res.result.data.order;
      const snapshot = order.snapshot || {};
      const service = snapshot.service || {};
      const pricing = snapshot.pricing || {};
      const orderValues = snapshot.orderValues || order.orderValues || {};

      this._orderId = order.id || order._id;
      this._orderNo = order.orderNo;
      this._version = order.version;

      this.setData({
        loading: false,
        error: '',
        order,
        statusText: statusText(order),
        statusTitle: statusTitle(order),
        progressIndex: progressIndex(order),
        actions: availableActions(order),
        timeline: (res.result.data.timeline || []).map((item) => ({
          customerMessage: item.message,
          createdAt: item.createdAt
        })),
        orderNo: order.orderNo,
        title: service.name || '',
        quantity: pricing.quantity || order.quantity || 1,
        unit: service.unitLabel || service.unit || '',
        standard: snapshot.fulfillmentStandard || '',
        platform: orderValues.platform || '',
        server: orderValues.region || '',
        payableYuan: centsToYuan(pricing.payableAmountCents || order.payableAmountCents || 0)
      });
    }).catch(() => {
      nav.toast('网络异常，请重试');
      this.setData({ loading: false, error: '网络异常，订单详情加载失败，请稍后重试' });
    });
  },

  retry() {
    return this.loadOrder();
  },

  noop() {},

  copyOrderNo() {
    wx.setClipboardData({
      data: this._orderNo,
      success: () => nav.toast('订单号已复制')
    });
  },

  handleAction(e) {
    const type = e.currentTarget.dataset.type;
    if (type === 'cancel') this.cancelOrder();
    else if (type === 'confirm') this.confirmOrder();
    else if (type === 'dispute') this.setData({ disputeOpen: true });
    else if (type === 'refund') this.openRefund();
    else if (type === 'review') this.openReview();
    else if (type === 'pay' || type === 'rebuy' || type === 'complaint') {
      nav.toast('该功能即将接入');
    }
  },

  // ── 取消订单 ──
  cancelOrder() {
    wx.showModal({
      title: '确认取消',
      content: `确定要取消订单 ${this._orderNo} 吗？`,
      confirmText: '确认取消',
      cancelText: '暂不取消',
      success: (res) => {
        if (!res.confirm) return;
        wx.cloud.callFunction({
          name: 'order',
          data: {
            action: 'cancel',
            payload: {
              orderId: this._orderId,
              reason: '顾客主动取消',
              version: this._version
            }
          }
        }).then(async (result) => {
          if (result.result && result.result.success) {
            nav.toast('订单已取消');
            this.loadOrder();
          } else if (result.result && result.result.error
            && result.result.error.code === 'PAYMENT_CLOSE_REQUIRED') {
            await payment.call('close', {
              orderId: this._orderId,
              reason: '顾客主动取消'
            });
            nav.toast('订单已取消');
            this.loadOrder();
          } else {
            nav.toast(result.result && result.result.error
              ? result.result.error.message
              : '取消失败');
          }
        }).catch((error) => nav.toast(error.message || '网络异常'));
      }
    });
  },

  // ── 确认完成 ──
  confirmOrder() {
    wx.showModal({
      title: '确认完成',
      content: '确认服务已完成？确认后将无法撤销。',
      confirmText: '确认完成',
      success: (res) => {
        if (!res.confirm) return;
        wx.cloud.callFunction({
          name: 'order',
          data: {
            action: 'confirm',
            payload: { orderId: this._orderId, version: this._version }
          }
        }).then((result) => {
          if (result.result && result.result.success) {
            nav.toast('订单已完成');
            this.loadOrder();
          } else {
            nav.toast(result.result && result.result.error
              ? result.result.error.message
              : '确认失败');
          }
        }).catch(() => nav.toast('网络异常'));
      }
    });
  },

  // ── 提出异议 ──
  closeDispute() {
    this.setData({ disputeOpen: false, disputeReason: '', disputeDescription: '' });
  },

  onDisputeReasonInput(e) {
    this.setData({ disputeReason: e.detail.value });
  },

  onDisputeDescInput(e) {
    this.setData({ disputeDescription: e.detail.value });
  },

  submitDispute() {
    const reason = this.data.disputeReason.trim();
    const description = this.data.disputeDescription.trim();
    if (!reason) {
      nav.toast('请填写异议原因');
      return;
    }
    wx.cloud.callFunction({
      name: 'order',
      data: {
        action: 'dispute',
        payload: {
          orderId: this._orderId,
          reason,
          description,
          version: this._version
        }
      }
    }).then((result) => {
      if (result.result && result.result.success) {
        nav.toast('异议已提交');
        this.closeDispute();
        this.loadOrder();
      } else {
        nav.toast(result.result && result.result.error
          ? result.result.error.message
          : '提交失败');
      }
    }).catch(() => nav.toast('网络异常'));
  },

  // ── 退款弹窗（占位，Issue #8 实现） ──
  openRefund() {
    this.setData({ refundOpen: true });
  },
  closeRefund() {
    this.setData({ refundOpen: false });
  },
  submitRefund() {
    this.setData({ refundOpen: false });
    nav.toast('退款功能即将接入');
  },

  // ── 评价弹窗（占位，后续 Issue 实现） ──
  openReview() {
    this.setData({ reviewOpen: true });
  },
  closeReview() {
    this.setData({ reviewOpen: false });
  },
  onScore(e) {
    this.setData({ reviewScore: e.currentTarget.dataset.score });
  },
  onReviewInput(e) {
    this.setData({ reviewText: e.detail.value });
  },
  submitReview() {
    this.setData({ reviewOpen: false });
    nav.toast('评价功能即将接入');
  }
});
