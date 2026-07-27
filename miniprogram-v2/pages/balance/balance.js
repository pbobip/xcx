const nav = require('../../utils/nav');

Page({
  data: {
    rows: [
      { icon: 'i-order', title: '余额明细', desc: '充值、消费与退款记录' },
      { icon: 'i-coupon', title: '支付抵扣', desc: '下单时可选择余额抵扣' },
      { icon: 'i-shield', title: '风险控制', desc: '启用前完成财务与合规评审' }
    ]
  },
  onPreview(e) {
    nav.toast(`${e.currentTarget.dataset.title}为 P1 预览能力`);
  }
});
