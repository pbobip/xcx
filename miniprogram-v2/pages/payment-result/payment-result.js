const nav = require('../../utils/nav');
const store = require('../../utils/store');
const auth = require('../../utils/auth');
const payment = require('../../utils/payment');

Page({
  data: {
    icon: 'check',
    order: null,
    paymentState: 'UNPAID',
    paying: false,
    title: '订单已创建，等待支付接入',
    copy: '本次只创建未付款服务订单，不会产生真实扣款。'
  },
  onShow() {
    if (!auth.requireLogin('payment-result', 'back')) return;
    const order = store.getLastOrder(null);
    if (!order) {
      this.setData({
        order: null,
        title: '暂未找到新建订单',
        copy: '请返回服务套餐重新创建订单。'
      });
      return;
    }
    const paid = order.paymentStatus === 'PAID';
    const copy = paid
      ? `${order.title} · 微信支付已由云端确认`
      : `${order.title} · ${order.qty} ${order.unit} · 应付 ¥${order.total}`;
    this.setData({
      order,
      paymentState: paid ? 'PAID' : 'UNPAID',
      icon: paid ? 'check' : 'order',
      title: paid ? '支付成功' : '服务订单已创建',
      copy
    });
  },
  async onPay() {
    if (!this.data.order || this.data.paying || this.data.paymentState === 'PAID') return;
    this.setData({ paying: true, paymentState: 'REQUESTING', title: '正在调起微信支付' });
    let paymentError = null;
    try {
      const prepay = await payment.call('prepay.create', { orderId: this.data.order.id });
      await payment.requestWechatPayment(prepay.paymentParams);
    } catch (error) {
      paymentError = error;
    }

    try {
      const result = await payment.call('query', { orderId: this.data.order.id });
      if (result.order && result.order.paymentStatus === 'PAID') {
        const order = Object.assign({}, this.data.order, result.order, { status: '待服务' });
        store.setLastOrder(order);
        this.setData({
          order,
          paying: false,
          paymentState: 'PAID',
          icon: 'check',
          title: '支付成功',
          copy: `${order.title} · 微信支付已由云端确认`
        });
        return;
      }
    } catch (queryError) {
      if (!paymentError) paymentError = queryError;
    }

    const cancelled = paymentError && /cancel/i.test(paymentError.errMsg || paymentError.message || '');
    this.setData({
      paying: false,
      paymentState: cancelled ? 'CANCELLED' : paymentError ? 'FAILED' : 'PENDING',
      icon: 'order',
      title: cancelled ? '支付已取消' : paymentError ? '支付暂未完成' : '支付结果确认中',
      copy: cancelled
        ? '服务订单仍为待付款，可稍后重新支付或取消。'
        : '云端尚未确认付款结果，请稍后重试查询。'
    });
  },
  onCopyOrderNo() {
    if (!this.data.order) return;
    wx.setClipboardData({
      data: this.data.order.orderNo,
      success: () => nav.toast('订单号已复制')
    });
  },
  onViewOrder() {
    if (!this.data.order) return;
    store.setSelectedOrder(Object.assign({ status: '待付款' }, this.data.order));
    wx.navigateTo({
      url: `/pages/order-detail/order-detail?orderId=${this.data.order.id}`
    });
  }
});
