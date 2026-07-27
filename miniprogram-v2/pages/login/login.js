const nav = require('../../utils/nav');
const store = require('../../utils/store');
const auth = require('../../utils/auth');

Page({
  data: {
    loggingIn: false,
    error: ''
  },
  onLoad() {
    if (auth.isLoggedIn()) nav.go('home');
  },
  async onWechatLogin() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true, error: '' });
    try {
      await auth.login();
      const loginReturn = store.popLoginReturn();
      if (loginReturn && loginReturn.page) {
        if (loginReturn.mode === 'back') {
          nav.back(loginReturn.page);
        } else {
          nav.redirect(loginReturn.page);
        }
        return;
      }
      nav.go('home');
    } catch (error) {
      this.setData({
        error: error && error.message ? error.message : '微信登录失败，请稍后重试'
      });
    } finally {
      this.setData({ loggingIn: false });
    }
  },
  onBrowseCatalog() {
    auth.logout();
    store.popLoginReturn();
    nav.go('home');
  }
});
