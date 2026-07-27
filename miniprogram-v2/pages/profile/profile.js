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
      { count: '0', label: '待付款' },
      { count: '1', label: '待服务' },
      { count: '1', label: '进行中' },
      { count: '1', label: '已完成' }
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
