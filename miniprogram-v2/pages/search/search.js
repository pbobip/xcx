const nav = require('../../utils/nav');
const store = require('../../utils/store');
const catalog = require('../../utils/catalog');

Page({
  data: {
    keyword: '',
    inputFocus: false,
    recentKeywords: [],
    hotKeywords: [],
    results: [],
    count: 0,
    nextCursor: null,
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: ''
  },

  async onLoad() {
    await this.runSearch(true);
  },

  async runSearch(reset) {
    if (reset) {
      this.searchRequestSeq = (this.searchRequestSeq || 0) + 1;
      this.setData({ loading: true, error: '', nextCursor: null });
    }
    const requestSeq = this.searchRequestSeq || 0;
    const payload = { keyword: this.data.keyword.trim(), limit: 10 };
    if (!reset && this.data.nextCursor) payload.cursor = this.data.nextCursor;
    try {
      const data = await catalog.call('search', payload);
      if (requestSeq !== this.searchRequestSeq) return;
      const incoming = data.services.map((item) => Object.assign({}, item, {
        priceText: catalog.formatPrice(item.priceCents, item.unitLabel)
      }));
      const results = reset
        ? incoming
        : catalog.mergeUnique(this.data.results, incoming);
      this.setData({
        results,
        count: results.length,
        nextCursor: data.nextCursor,
        hasMore: Boolean(data.nextCursor),
        error: ''
      });
    } catch (error) {
      if (requestSeq !== this.searchRequestSeq) return;
      this.setData({ error: error.message || '搜索失败，请稍后重试' });
    } finally {
      if (reset && requestSeq === this.searchRequestSeq) this.setData({ loading: false });
    }
  },

  async onInput(e) {
    this.setData({ keyword: e.detail.value });
    await this.runSearch(true);
  },

  async onClear() {
    this.setData({ keyword: '' });
    await this.runSearch(true);
  },

  async onKeyword(e) {
    this.setData({ keyword: e.currentTarget.dataset.keyword, inputFocus: true });
    await this.runSearch(true);
  },

  onInputBlur() {
    this.setData({ inputFocus: false });
  },

  onClearRecent() {
    this.setData({ recentKeywords: [] });
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    await this.runSearch(false);
    this.setData({ loadingMore: false });
  },

  async retry() {
    await this.runSearch(true);
  },

  openDetail(e) {
    const item = this.data.results[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    store.setSelectedService({ id: item.id, code: item.code, source: 'search' });
    nav.go('service-detail');
  }
});
