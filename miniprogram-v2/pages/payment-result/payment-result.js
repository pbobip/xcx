const nav = require('../../utils/nav');
const store = require('../../utils/store');

const DEFAULT_ORDER = { orderNo: 'BBX-DEMO-001', title: '钻石段位技术陪', qty: 1, unit: '局', total: 35 };

Page({
  data: {
    icon: 'check',
    order: DEFAULT_ORDER,
    title: '支付成功，等待爆爆熊派单',
    copy: '无畏契约钻石段位技术陪 · 1 局 · 实付 ¥35'
  },
  onShow() {
    const order = store.getLastOrder(DEFAULT_ORDER);
    const copy = `无畏契约${order.title} · ${order.qty} ${order.unit} · 实付 ¥${order.total}`;
    this.setData({ order, copy });
  },
  onCopyOrderNo() {
    wx.setClipboardData({
      data: this.data.order.orderNo || DEFAULT_ORDER.orderNo,
      success: () => nav.toast('订单号已复制')
    });
  },
  onViewOrder() {
    store.setSelectedOrder(Object.assign({ status: '待服务' }, this.data.order));
    nav.go('order-detail');
  }
});
