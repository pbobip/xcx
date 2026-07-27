const nav = require('../../utils/nav');
const store = require('../../utils/store');

Page({
  data: {
    quicks: [
      { count: '0', label: '待付款' },
      { count: '1', label: '待服务' },
      { count: '1', label: '进行中' },
      { count: '1', label: '已完成' }
    ]
  },
  onShow() {
    getApp().syncMessageBadge();
  },
  goSettings() {
    nav.go('settings');
  },
  goOrders(e) {
    const status = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.status
      : '';
    store.setPendingTabState(status || '全部');
    nav.go('orders');
  },
  goCoupons() {
    nav.go('coupons');
  },
  goComplaints() {
    nav.go('complaints');
  },
  goBalance() {
    nav.go('balance');
  },
  goInvite() {
    nav.go('invite');
  }
});
