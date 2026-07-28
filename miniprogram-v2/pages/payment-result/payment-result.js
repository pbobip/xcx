const nav = require('../../utils/nav');
const store = require('../../utils/store');
const auth = require('../../utils/auth');

Page({
  data: {
    icon: 'check',
    order: null,
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
    const copy = `${order.title} · ${order.qty} ${order.unit} · 应付 ¥${order.total}`;
    this.setData({ order, copy });
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
