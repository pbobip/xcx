const nav = require('../../utils/nav');
const store = require('../../utils/store');

Page({
  data: {
    // 推荐区 tabs：key 用于筛选（'全部' 显示为「推荐」）
    tabs: [
      { key: '全部', label: '推荐' },
      { key: '陪玩专区', label: '陪玩专区' },
      { key: '护航专区', label: '护航专区' },
      { key: '教学专区', label: '教学专区' },
      { key: '热门活动', label: '热门活动' }
    ],
    activeFilter: '全部',
    feed: [
      { code: 'VAL', serviceCode: 'PRO', title: '无畏契约技术陪｜按局', group: '陪玩专区', note: '钻石技术陪，白金或人前五', price: '¥35/局', available: true },
      { code: 'LOL', title: '英雄联盟双排陪玩｜按小时', group: '陪玩专区', note: '服务时长与区服待运营配置', price: '待配置', available: false },
      { code: 'DF', title: '三角洲行动护航｜指定任务', group: '护航专区', note: '任务范围以下单说明为准', price: '待配置', available: false },
      { code: 'HOK', title: '王者荣耀娱乐陪｜按局', group: '陪玩专区', note: '手机端套餐待运营配置', price: '待配置', available: false },
      { code: 'PUBG', title: '绝地求生战术教学｜1小时', group: '教学专区', note: '课程内容待运营配置', price: '待配置', available: false },
      { code: 'NAR', title: '永劫无间护航｜指定任务', group: '护航专区', note: '套餐内容待运营配置', price: '待配置', available: false },
      { code: 'NEW', title: '新人体验活动', group: '热门活动', note: '活动规则与时间待运营配置', price: '待配置', available: false }
    ]
  },

  onShow() {
    getApp().syncMessageBadge();
  },

  onSearch() {
    nav.go('search');
  },

  goCategories() {
    nav.go('categories');
  },

  goDetail() {
    store.setSelectedService({ code: 'BASIC', source: 'home-hot' });
    nav.go('service-detail');
  },

  onFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    if (filter === this.data.activeFilter) return;
    this.setData({ activeFilter: filter });
  },

  onFeedTap(e) {
    const item = this.data.feed[e.currentTarget.dataset.index];
    if (!item) return;
    if (item.available) {
      store.setSelectedService({ code: item.serviceCode || item.code, source: 'home-feed' });
      nav.go('service-detail');
    } else {
      nav.toast(item.title + '待运营配置');
    }
  }
});
