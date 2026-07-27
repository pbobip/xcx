const nav = require('../../utils/nav');
const store = require('../../utils/store');

const DEFAULT_ORDER = {
  orderNo: 'BBX-20260726-001',
  status: '待服务',
  title: '钻石段位技术陪',
  label: '技术陪',
  standard: '白金或人前五',
  qty: 1,
  unit: '局',
  total: 35,
  platform: '电脑端',
  server: '无畏契约国服'
};

const STATUS_TITLES = {
  待付款: '订单等待支付',
  待服务: '爆爆熊正在安排陪玩',
  进行中: '陪玩服务进行中',
  已完成: '服务已完成'
};

const STATUS_PROGRESS = {
  待付款: -1,
  待服务: 1,
  进行中: 2,
  已完成: 3
};

Page({
  data: {
    scores: [1, 2, 3, 4, 5],
    reviewScore: 5,
    reviewText: '',
    refundOpen: false,
    reviewOpen: false,
    order: DEFAULT_ORDER,
    statusTitle: STATUS_TITLES[DEFAULT_ORDER.status],
    progressIndex: STATUS_PROGRESS[DEFAULT_ORDER.status]
  },

  onLoad() {
    this.loadOrder();
  },

  onShow() {
    this.loadOrder();
  },

  loadOrder() {
    const order = store.getSelectedOrder(store.getLastOrder(DEFAULT_ORDER));
    this.setData({
      order,
      statusTitle: STATUS_TITLES[order.status] || '查看订单进度',
      progressIndex: STATUS_PROGRESS[order.status] === undefined ? 0 : STATUS_PROGRESS[order.status]
    });
  },

  noop() {},

  copyOrderNo() {
    wx.setClipboardData({
      data: this.data.order.orderNo || DEFAULT_ORDER.orderNo,
      success: () => nav.toast('订单号已复制')
    });
  },

  goComplaint() {
    nav.go('complaint-submit');
  },

  openRefund() {
    this.setData({ refundOpen: true });
  },

  closeRefund() {
    this.setData({ refundOpen: false });
  },

  submitRefund() {
    this.setData({ refundOpen: false });
    nav.toast('退款申请已提交');
  },

  openReview() {
    this.setData({ reviewOpen: true });
  },

  closeReview() {
    this.setData({ reviewOpen: false });
  },

  onScore(e) {
    this.setData({ reviewScore: e.currentTarget.dataset.score });
  },

  onReviewInput(e) {
    this.setData({ reviewText: e.detail.value });
  },

  submitReview() {
    this.setData({ reviewOpen: false });
    nav.toast('评价已保存为原型草稿');
  }
});
