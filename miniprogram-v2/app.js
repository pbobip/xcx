const store = require('./utils/store');

App({
  globalData: {
    unreadMessages: store.getUnreadMessages()
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请升级微信基础库');
    } else {
      wx.cloud.init({
        env: 'cloud1-d5gmfvq70c644d633',
        traceUser: true
      });
    }

    this.syncMessageBadge();
  },

  onShow() {
    this.syncMessageBadge();
  },

  syncMessageBadge() {
    const count = Number(this.globalData.unreadMessages) || 0;
    if (count > 0) {
      wx.setTabBarBadge({ index: 3, text: String(count), fail: () => {} });
      return;
    }
    wx.removeTabBarBadge({ index: 3, fail: () => {} });
  },

  setUnreadMessages(count) {
    const next = Math.max(0, Number(count) || 0);
    this.globalData.unreadMessages = next;
    store.setUnreadMessages(next);
    this.syncMessageBadge();
  }
});
