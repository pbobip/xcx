const nav = require('../../utils/nav');
const store = require('../../utils/store');
const auth = require('../../utils/auth');

Page({
  data: {
    orderList: ['爆爆熊订单 BBX-20260726-001'],
    reasonList: ['申请换人', '派单超时', '服务与价目说明不符', '服务态度问题', '其他'],
    order: '',
    reason: '',
    copy: '',
    error: '',
    submitting: false,
    evidence: []
  },

  onLoad() {
    if (!auth.requireLogin('complaint-submit', 'back')) return;
    const lastOrder = store.getLastOrder(null);
    if (lastOrder && lastOrder.orderNo) {
      this.setData({ orderList: [`爆爆熊订单 ${lastOrder.orderNo}`] });
    }
  },

  onOrderChange(e) {
    this.setData({ order: this.data.orderList[Number(e.detail.value)] || '' });
  },

  onReasonChange(e) {
    this.setData({ reason: this.data.reasonList[Number(e.detail.value)] || '' });
  },

  onCopyInput(e) {
    this.setData({ copy: e.detail.value });
  },

  onUpload() {
    wx.chooseMedia({
      count: Math.max(1, 3 - this.data.evidence.length),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (result) => {
        const next = this.data.evidence.concat(result.tempFiles.map((file) => file.tempFilePath)).slice(0, 3);
        this.setData({ evidence: next });
        nav.toast(`已选择 ${next.length} 张图片`);
      }
    });
  },

  onRemoveEvidence(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ evidence: this.data.evidence.filter((_, itemIndex) => itemIndex !== index) });
  },

  // 校验逻辑与文案与原型 app.js 231-236 行一致
  onSubmit() {
    if (this.data.submitting) return;
    const order = this.data.order;
    const reason = this.data.reason;
    const copy = this.data.copy.trim();
    if (!order || !reason || copy.length < 6) {
      this.setData({ error: '请选择关联订单与原因，并至少填写 6 个字的问题说明。' });
      return;
    }
    this.setData({ submitting: true });
    nav.toast('售后申请已提交，自动完成已暂停');
    setTimeout(() => nav.redirect('complaints'), 700);
  }
});
