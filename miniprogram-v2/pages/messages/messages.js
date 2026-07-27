const nav = require('../../utils/nav');

Page({
  data: {
    messages: [
      {
        id: 'order',
        icon: 'order',
        title: '爆爆熊已接单',
        desc: '钻石技术陪订单正在安排合适的陪玩。',
        time: '刚刚',
        unread: true
      },
      {
        id: 'rule',
        icon: 'message',
        title: '点单规则提醒',
        desc: '不满意可申请换人，有问题可联系平台售后。',
        time: '今天',
        unread: true
      },
      {
        id: 'welcome',
        icon: 'shield',
        title: '欢迎来到爆爆熊电竞',
        desc: '请勿向任何人提供密码、验证码或支付凭证。',
        time: '昨天',
        unread: false
      }
    ]
  },
  onShow() {
    const app = getApp();
    if (app.globalData.unreadMessages === 0) {
      this.setData({ messages: this.data.messages.map((message) => Object.assign({}, message, { unread: false })) });
    }
    app.syncMessageBadge();
  },
  // 全部已读：清行内 badge + 清全局未读数 + 同步 tab 徽标
  onReadAll() {
    const messages = this.data.messages.map((m) => Object.assign({}, m, { unread: false }));
    this.setData({ messages });
    getApp().setUnreadMessages(0);
    nav.toast('消息已全部标记为已读');
  }
});
