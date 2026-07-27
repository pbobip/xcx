const auth = require('../../utils/auth');

Page({
  onLoad() {
    auth.requireLogin('invite', 'back');
  },
  onShareAppMessage() {
    return {
      title: '爆爆熊电竞｜陪玩价目与服务保障',
      path: '/pages/home/home'
    };
  }
});
