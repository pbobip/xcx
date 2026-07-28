const nav = require('../../utils/nav');
const store = require('../../utils/store');
const auth = require('../../utils/auth');

const GUEST_USER = {
  nickname: '未登录顾客',
  platformUserNo: '登录后生成',
  avatarText: '熊'
};

Page({
  data: {
    loggedIn: false,
    user: GUEST_USER,
    quicks: [
      { count: '0', label: '待付款', tab: 'unpaid' },
      { count: '0', label: '待服务', tab: 'waiting' },
      { count: '0', label: '进行中', tab: 'inProgress' },
      { count: '0', label: '已完成', tab: 'completed' }
    ]
  },
  onShow() {
    const currentUser = auth.getCurrentUser();
    const user = currentUser
      ? Object.assign({}, currentUser, {
        avatarText: String(currentUser.nickname || '熊').slice(0, 1)
      })
      : GUEST_USER;
    this.setData({ loggedIn: Boolean(currentUser), user });
    getApp().syncMessageBadge();
    if (currentUser) this.loadOrderCounts();
  },

  loadOrderCounts() {
    wx.cloud.callFunction({
      name: 'order',
      data: { action: 'summary', payload: {} }
    }).then((res) => {
      if (!res.result || !res.result.success) return;
      const counts = res.result.data.counts;
      this.setData({
        quicks: [
          { count: String(counts.unpaid || 0), label: '待付款', tab: 'unpaid' },
          { count: String(counts.waiting || 0), label: '待服务', tab: 'waiting' },
          { count: String(counts.inProgress || 0), label: '进行中', tab: 'inProgress' },
          { count: String(counts.completed || 0), label: '已完成', tab: 'completed' }
        ]
      });
    }).catch(() => {});
  },

  goLogin() {
    if (!this.data.loggedIn) nav.go('login');
  },
  goSettings() {
    nav.go('settings');
  },
  goOrders(e) {
    const status = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.status
      : '';
    store.setPendingTabState(status || '全部');
    if (!auth.requireLogin('orders')) return;
    nav.go('orders');
  },
  goCoupons() {
    if (!auth.requireLogin('coupons')) return;
    nav.go('coupons');
  },
  goComplaints() {
    if (!auth.requireLogin('complaints')) return;
    nav.go('complaints');
  },
  goBalance() {
    if (!auth.requireLogin('balance')) return;
    nav.go('balance');
  },
  goInvite() {
    if (!auth.requireLogin('invite')) return;
    nav.go('invite');
  }
});
