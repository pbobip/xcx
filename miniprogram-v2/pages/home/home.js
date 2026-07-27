const nav = require('../../utils/nav');
const store = require('../../utils/store');
const catalog = require('../../utils/catalog');

function decorateService(service, group, groupLabel) {
  return Object.assign({}, service, {
    groupCodes: group ? [group] : [],
    groupLabel,
    hidden: false,
    priceText: catalog.formatPrice(service.priceCents, service.unitLabel)
  });
}

function composeFeed(data, excludedServiceId) {
  const feed = [];
  const byId = new Map();
  function add(service, group, groupLabel) {
    if (service.id === excludedServiceId) return;
    const existing = byId.get(service.id);
    if (existing) {
      if (group && !existing.groupCodes.includes(group)) existing.groupCodes.push(group);
      return;
    }
    const item = decorateService(service, group, groupLabel);
    byId.set(service.id, item);
    feed.push(item);
  }
  for (const recommendation of data.recommendations) {
    if (recommendation.code === 'HOME_LATEST') continue;
    for (const service of recommendation.services) {
      add(service, recommendation.code, recommendation.name);
    }
  }
  for (const service of data.services) add(service, '', '推荐');
  return feed;
}

function applyFilter(feed, activeFilter) {
  return feed.map((item) => Object.assign({}, item, {
    hidden: activeFilter !== 'ALL' && !item.groupCodes.includes(activeFilter)
  }));
}

Page({
  data: {
    banner: null,
    hotService: null,
    tabs: [{ key: 'ALL', label: '推荐' }],
    activeFilter: 'ALL',
    feed: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    loading: true,
    error: ''
  },

  async onLoad() {
    await this.loadHome(true);
  },

  onShow() {
    getApp().syncMessageBadge();
  },

  async loadHome(reset) {
    if (reset) this.setData({ loading: true, error: '', nextCursor: null });
    try {
      const payload = { limit: 10 };
      if (!reset && this.data.nextCursor) payload.cursor = this.data.nextCursor;
      const data = await catalog.call('home', payload);
      const recommendations = data.recommendations.filter(
        (item) => item.code !== 'HOME_LATEST' && item.services.length
      );
      const tabs = [{ key: 'ALL', label: '推荐' }].concat(
        recommendations.map((item) => ({ key: item.code, label: item.name }))
      );
      const hot = data.latestServices[0] || data.services[0] || null;
      const incoming = composeFeed(data, hot ? hot.id : null);
      const merged = reset ? incoming : catalog.mergeUnique(this.data.feed, incoming);
      const activeFilter = reset ? 'ALL' : this.data.activeFilter;
      const feed = applyFilter(merged, activeFilter);
      this.setData({
        banner: reset ? data.banners[0] || null : this.data.banner,
        hotService: reset
          ? hot ? decorateService(hot, 'LATEST', '最新服务') : null
          : this.data.hotService,
        tabs: reset ? tabs : this.data.tabs,
        activeFilter,
        feed,
        nextCursor: data.nextCursor,
        hasMore: Boolean(data.nextCursor),
        error: ''
      });
    } catch (error) {
      this.setData({ error: error.message || '首页内容加载失败，请稍后重试' });
    } finally {
      if (reset) this.setData({ loading: false });
    }
  },

  async retry() {
    await this.loadHome(true);
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    await this.loadHome(false);
    this.setData({ loadingMore: false });
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
    store.setSelectedService({ id: item.id, code: item.code, source: 'home-hot' });
    nav.go('service-detail');
  },

  onFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    if (filter === this.data.activeFilter) return;
    this.setData({ activeFilter: filter, feed: applyFilter(this.data.feed, filter) });
  },

  onFeedTap(e) {
    const item = this.data.feed[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    store.setSelectedService({ id: item.id, code: item.code, source: 'home-feed' });
    nav.go('service-detail');
  }
});
