const nav = require('../../utils/nav');
const auth = require('../../utils/auth');

Page({
  data: {
    notifyOn: true,
    logoutOpen: false
  },
  onLoad() {
    try {
      const saved = wx.getStorageSync('bbx_notify_on');
      if (saved !== '') this.setData({ notifyOn: Boolean(saved) });
    } catch (error) {
      // 保留默认值。
    }
  },
  noop() {},
  toggleNotify() {
    const notifyOn = !this.data.notifyOn;
    this.setData({ notifyOn });
    try { wx.setStorageSync('bbx_notify_on', notifyOn); } catch (error) {}
  },
  onPlaceholder(e) {
    nav.toast(e.currentTarget.dataset.message || '该功能待接入');
  },
  openLogout() {
    this.setData({ logoutOpen: true });
  },
  closeLogout() {
    this.setData({ logoutOpen: false });
  },
  confirmLogout() {
    auth.logout();
    nav.relaunch('login');
  }
});
