const nav = require('../../utils/nav');
const payment = require('../../utils/payment');
const store = require('../../utils/store');
const auth = require('../../utils/auth');
const { TABS, orderCardSummary } = require('../../utils/order-status');

const PAGE_SIZE = 20;

Page({
  data: {
    tabs: TABS.map((tab) => tab.name),
    activeTab: '全部',
    activeTabKey: 'all',
    orders: [],
    empty: false,
    loading: false,
    error: '',
    noMore: false,
    counts: { all: 0, unpaid: 0, waiting: 0, inProgress: 0, completed: 0 }
  },

  _cursor: null,

  onLoad(options) {
    auth.requireLogin('orders', 'back');
    // 支持从"我的"页面跳转时指定标签
    if (options && options.tab) {
      const tab = TABS.find((t) => t.key === options.tab || t.name === options.tab);
      if (tab) this.setData({ activeTab: tab.name, activeTabKey: tab.key });
    }
  },

  onShow() {
    const pendingStatus = store.popPendingTabState();
    if (pendingStatus) {
      const tab = TABS.find((t) => t.name === pendingStatus || t.key === pendingStatus);
      if (tab) this.setData({ activeTab: tab.name, activeTabKey: tab.key });
    }
    this.loadSummary();
    this.resetAndLoad();
  },

  onPullDownRefresh() {
    this.loadSummary();
    this.resetAndLoad().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this._cursor || this.data.noMore || this.data.loading) return;
    this.loadOrders(this._cursor);
  },

  onTab(e) {
    const name = e.currentTarget.dataset.status;
    const tab = TABS.find((t) => t.name === name);
    if (!tab || tab.name === this.data.activeTab) return;
    this.setData({ activeTab: tab.name, activeTabKey: tab.key });
    this.resetAndLoad();
  },

  loadSummary() {
    wx.cloud.callFunction({
      name: 'order',
      data: { action: 'summary', payload: {} }
    }).then((res) => {
      if (res.result && res.result.success) {
        this.setData({ counts: res.result.data.counts });
      }
    }).catch(() => {});
  },

  resetAndLoad() {
    this._cursor = null;
    this.setData({ orders: [], empty: false, error: '', noMore: false });
    return this.loadOrders(null);
  },

  loadOrders(cursor) {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true, error: '' });

    return wx.cloud.callFunction({
      name: 'order',
      data: {
        action: 'list',
        payload: {
          tab: this.data.activeTabKey,
          cursor: cursor || null,
          limit: PAGE_SIZE
        }
      }
    }).then((res) => {
      if (!res.result || !res.result.success) {
        nav.toast('加载失败，请重试');
        this.setData({ loading: false, error: '订单加载失败，请稍后重试' });
        return;
      }
      const newOrders = (res.result.data.orders || []).map(orderCardSummary);
      const allOrders = cursor ? this.data.orders.concat(newOrders) : newOrders;
      this._cursor = res.result.data.nextCursor;
      this.setData({
        orders: allOrders,
        empty: allOrders.length === 0,
        noMore: !res.result.data.nextCursor,
        loading: false,
        error: ''
      });
    }).catch(() => {
      nav.toast('网络异常，请重试');
      this.setData({ loading: false, error: '网络异常，订单加载失败，请稍后重试' });
    });
  },

  retry() {
    return this.resetAndLoad();
  },

  goOrderDetail(e) {
    const orderNo = e.currentTarget.dataset.orderno;
    if (orderNo) {
      wx.navigateTo({ url: `/pages/order-detail/order-detail?orderNo=${orderNo}` });
    }
  },

  handleAction(e) {
    const { type, orderno, orderid } = e.currentTarget.dataset;
    if (type === 'cancel') {
      this.cancelOrder(orderid, orderno);
    } else if (type === 'pay' || type === 'refund' || type === 'review' || type === 'rebuy' || type === 'complaint') {
      nav.toast('该功能即将接入');
    } else if (type === 'confirm' || type === 'dispute') {
      wx.navigateTo({ url: `/pages/order-detail/order-detail?orderNo=${orderno}` });
    }
  },

  cancelOrder(orderId, orderNo) {
    wx.showModal({
      title: '确认取消',
      content: `确定要取消订单 ${orderNo || ''} 吗？`,
      confirmText: '确认取消',
      cancelText: '暂不取消',
      success: (res) => {
        if (!res.confirm) return;
        // 查找订单的 version
        const order = this.data.orders.find((o) => o.id === orderId);
        wx.cloud.callFunction({
          name: 'order',
          data: {
            action: 'cancel',
            payload: {
              orderId,
              reason: '顾客主动取消',
              version: order ? order.version : 1
            }
          }
        }).then(async (result) => {
          if (result.result && result.result.success) {
            nav.toast('订单已取消');
            this.loadSummary();
            this.resetAndLoad();
          } else if (result.result && result.result.error
            && result.result.error.code === 'PAYMENT_CLOSE_REQUIRED') {
            await payment.call('close', { orderId, reason: '顾客主动取消' });
            nav.toast('订单已取消');
            this.loadSummary();
            this.resetAndLoad();
          } else {
            const msg = result.result && result.result.error
              ? result.result.error.message
              : '取消失败，请重试';
            nav.toast(msg);
          }
        }).catch((error) => nav.toast(error.message || '网络异常，请重试'));
      }
    });
  }
});
