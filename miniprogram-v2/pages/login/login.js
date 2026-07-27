const nav = require('../../utils/nav');
const store = require('../../utils/store');

Page({
  onLoad() {
    if (store.isLoggedIn()) nav.go('home');
  },
  onWechatLogin() {
    // 无后端时仅保存本地演示登录态；正式登录需把 wx.login code 交给服务端换取会话。
    store.setLoggedIn(true);
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
  },
  onBrowseCatalog() {
    store.setLoggedIn(false);
    store.popLoginReturn();
    nav.go('home');
  }
});
