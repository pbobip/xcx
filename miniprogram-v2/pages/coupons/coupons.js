const nav = require('../../utils/nav');
const auth = require('../../utils/auth');
const coupon = require('../../utils/coupon');
const order = require('../../utils/order');

function couponView(item) {
  const base = coupon.view(item);
  const statusText = item.status === 'AVAILABLE' && item.available === false
    ? item.unavailableReason || '暂不可用'
    : ({
    AVAILABLE: '可使用',
    LOCKED: '订单处理中',
    USED: '已使用',
    EXPIRED: '已过期',
    VOID: '已作废'
  }[item.status] || '不可用');
  return {
    id: base.id,
    name: base.name,
    amountText: base.amountText,
    thresholdText: base.thresholdText,
    scopeText: base.scopeText,
    validText: `${base.validFromText} 至 ${base.validToText}`,
    statusText
  };
}

Page({
  data: {
    tabs: ['未使用', '已使用', '已过期'],
    statusKeys: ['unused', 'used', 'expired'],
    activeTab: 0,
    coupons: [],
    loading: false,
    error: '',
    empty: false,
    nextCursor: null
  },
  onLoad() {
    auth.requireLogin('coupons', 'back');
  },
  onShow() {
    if (!auth.isLoggedIn()) return Promise.resolve();
    return this.loadCoupons(null);
  },
  async onTabTap(e) {
    if (this.data.loading) return;
    const activeTab = Number(e.currentTarget.dataset.index);
    if (activeTab === this.data.activeTab) return;
    this.setData({ activeTab });
    await this.loadCoupons(null);
  },
  async loadCoupons(cursor) {
    if (this.data.loading) return;
    this.setData(Object.assign({ loading: true, error: '' }, cursor ? {} : {
      coupons: [],
      nextCursor: null,
      empty: false
    }));
    try {
      const data = await order.call('coupon.mine.list', {
        status: this.data.statusKeys[this.data.activeTab],
        cursor: cursor || null,
        limit: 10
      });
      const incoming = (data.coupons || []).map(couponView);
      const coupons = cursor ? this.data.coupons.concat(incoming) : incoming;
      this.setData({
        coupons,
        nextCursor: data.nextCursor || null,
        empty: coupons.length === 0
      });
    } catch (error) {
      this.setData({
        error: error.message || '优惠券加载失败，请稍后重试。',
        empty: false
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  retry() {
    return this.loadCoupons(null);
  },
  loadMore() {
    if (!this.data.nextCursor) return Promise.resolve();
    return this.loadCoupons(this.data.nextCursor);
  },
  onViewCatalog() {
    nav.go('categories');
  }
});
