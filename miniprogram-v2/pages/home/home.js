const nav = require('../../utils/nav');
const store = require('../../utils/store');
const catalog = require('../../utils/catalog');

function decorateService(service, group, groupLabel) {
  return Object.assign({}, service, {
    group,
    groupLabel,
    priceText: catalog.formatPrice(service.priceCents, service.unitLabel)
  });
}

Page({
  data: {
    banner: null,
    hotService: null,
    tabs: [{ key: 'ALL', label: '推荐' }],
    activeFilter: 'ALL',
    feed: [],
    loading: true,
    error: ''
  },

  async onLoad() {
    await this.loadHome();
  },

  onShow() {
    getApp().syncMessageBadge();
  },

  async loadHome() {
    this.setData({ loading: true, error: '' });
    try {
      const data = await catalog.call('home', { limit: 10 });
      const recommendations = data.recommendations.filter(
        (item) => item.code !== 'HOME_LATEST' && item.services.length
      );
      const tabs = [{ key: 'ALL', label: '推荐' }].concat(
        recommendations.map((item) => ({ key: item.code, label: item.name }))
      );
      const feed = [];
      const ids = new Set();
      for (const recommendation of recommendations) {
        for (const service of recommendation.services) {
          if (ids.has(service.id)) continue;
          ids.add(service.id);
          feed.push(decorateService(service, recommendation.code, recommendation.name));
        }
      }
      if (!feed.length) {
        for (const service of data.services) {
          if (ids.has(service.id)) continue;
          ids.add(service.id);
          feed.push(decorateService(service, 'ALL', '推荐'));
        }
      }
      const hot = data.latestServices[0] || data.services[0] || null;
      this.setData({
        banner: data.banners[0] || null,
        hotService: hot ? decorateService(hot, 'LATEST', '最新服务') : null,
        tabs,
        activeFilter: 'ALL',
        feed,
        error: ''
      });
    } catch (error) {
      this.setData({ error: error.message || '首页内容加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async retry() {
    await this.loadHome();
  },

  onSearch() {
    nav.go('search');
  },

  goCategories() {
    nav.go('categories');
  },

  goDetail() {
    const item = this.data.hotService;
    if (!item) return;
    if (!item.purchasable) {
      nav.toast(item.name + '当前暂停接单');
      return;
    }
    store.setSelectedService({ id: item.id, code: item.code, source: 'home-hot' });
    nav.go('service-detail');
  },

  onFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    if (filter === this.data.activeFilter) return;
    this.setData({ activeFilter: filter });
  },

  onFeedTap(e) {
    const item = this.data.feed[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    if (!item.purchasable) {
      nav.toast(item.name + '当前暂停接单');
      return;
    }
    store.setSelectedService({ id: item.id, code: item.code, source: 'home-feed' });
    nav.go('service-detail');
  }
});
