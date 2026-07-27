const nav = require('../../utils/nav');

Page({
  data: {
    tabs: ['未使用', '已使用', '已过期'],
    activeTab: 0
  },
  // 三态 segmented 仅切换 active（原型 data-segment 行为）
  onTabTap(e) {
    this.setData({ activeTab: Number(e.currentTarget.dataset.index) });
  },
  onViewCatalog() {
    nav.go('categories');
  }
});
