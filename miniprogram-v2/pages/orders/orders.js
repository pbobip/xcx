const nav = require('../../utils/nav');
const store = require('../../utils/store');

const DEMO_ORDERS = [
  {
    id: 'BBX-20260726-001',
    orderNo: 'BBX-20260726-001',
    status: '待服务',
    code: 'PRO',
    label: '技术陪',
    title: '钻石段位技术陪',
    summary: '1 局 · 无畏契约国服',
    qty: 1,
    unit: '局',
    standard: '白金或人前五',
    platform: '电脑端',
    server: '无畏契约国服',
    total: 35
  },
  {
    id: 'BBX-20260726-002',
    orderNo: 'BBX-20260726-002',
    status: '进行中',
    code: 'FUN',
    label: '娱乐陪',
    title: '钻石段位娱乐陪',
    summary: '1 局 · 无畏契约国服',
    qty: 1,
    unit: '局',
    standard: '轻松组队，以娱乐体验为主',
    platform: '电脑端',
    server: '无畏契约国服',
    total: 25
  },
  {
    id: 'BBX-20260726-003',
    orderNo: 'BBX-20260726-003',
    status: '已完成',
    code: 'SWEET',
    label: '甜蜜单',
    title: '甜蜜单陪玩',
    summary: '1 小时 · 无畏契约国服',
    qty: 1,
    unit: '小时',
    standard: '可以指定称呼',
    platform: '电脑端',
    server: '无畏契约国服',
    total: 52
  }
];

Page({
  data: {
    tabs: ['全部', '待付款', '待服务', '进行中', '已完成'],
    activeTab: '全部',
    orders: DEMO_ORDERS,
    empty: false
  },

  onShow() {
    const pendingStatus = store.popPendingTabState();
    if (pendingStatus && this.data.tabs.includes(pendingStatus)) {
      this.selectTab(pendingStatus);
    }
  },

  onTab(e) {
    this.selectTab(e.currentTarget.dataset.status);
  },

  selectTab(status) {
    const count = this.data.orders.filter(
      (order) => status === '全部' || order.status === status
    ).length;
    this.setData({ activeTab: status, empty: count === 0 });
  },

  goServiceDetail(e) {
    const order = this.data.orders[Number(e.currentTarget.dataset.index)];
    store.setSelectedService({ code: order ? order.code : 'PRO', source: 'orders' });
    nav.go('service-detail');
  },

  goOrderDetail(e) {
    const order = this.data.orders[Number(e.currentTarget.dataset.index)];
    if (order) store.setSelectedOrder(order);
    nav.go('order-detail');
  }
});
