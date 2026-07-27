const nav = require('../../utils/nav');
const store = require('../../utils/store');
const catalog = require('../../utils/catalog');

Page({
  data: {
    categories: [],
    activeCategoryId: '',
    cards: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    hasMore: false,
    error: ''
  },

  async onLoad() {
    await this.loadInitial();
  },

  async onShow() {
    getApp().syncMessageBadge();
    if (!this.data.categories.length) return;
    const targetCategory = this.takePendingCategory(this.data.categories);
    if (!targetCategory) return;
    await this.selectCategory(targetCategory.id);
  },

  goSearch() {
    nav.go('search');
  },

  async loadInitial() {
    this.setData({ loading: true, error: '' });
    try {
      const categoryData = await catalog.call('category.list');
      const categories = categoryData.categories;
      const targetCategory = this.takePendingCategory(categories);
      const activeCategoryId = targetCategory
        ? targetCategory.id
        : categories[0] ? categories[0].id : '';
      this.setData({
        categories,
        activeCategoryId,
        cards: [],
        nextCursor: null,
        hasMore: false
      });
      if (activeCategoryId) await this.loadServices(true);
    } catch (error) {
      this.setData({ error: error.message || '目录加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  takePendingCategory(categories) {
    const pendingTarget = store.popPendingCategoryTarget();
    const targetId = pendingTarget && pendingTarget.targetId;
    return targetId
      ? categories.find((item) => item.id === targetId || item.code === targetId) || null
      : null;
  },

  async loadServices(reset) {
    const categoryId = this.data.activeCategoryId;
    const payload = { categoryId, limit: 10 };
    if (!reset && this.data.nextCursor) payload.cursor = this.data.nextCursor;
    const data = await catalog.call('service.list', payload);
    if (categoryId !== this.data.activeCategoryId) return;
    const incoming = data.services.map((item) => Object.assign({}, item, {
      priceText: catalog.formatPrice(item.priceCents, item.unitLabel)
    }));
    const cards = reset
      ? incoming
      : catalog.mergeUnique(this.data.cards, incoming);
    this.setData({
      cards,
      nextCursor: data.nextCursor,
      hasMore: Boolean(data.nextCursor),
      error: ''
    });
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      await this.loadServices(false);
    } catch (error) {
      this.setData({ error: error.message || '加载更多失败，请稍后重试' });
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  async retry() {
    await this.loadInitial();
  },

  async selectCategory(categoryId) {
    if (!categoryId || categoryId === this.data.activeCategoryId) return;
    this.setData({ activeCategoryId: categoryId, cards: [], nextCursor: null, hasMore: false, loading: true, error: '' });
    try {
      await this.loadServices(true);
    } catch (error) {
      this.setData({ error: error.message || '套餐加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async switchCategory(e) {
    await this.selectCategory(e.currentTarget.dataset.categoryId);
  },

  onCardTap(e) {
    const card = this.data.cards[Number(e.currentTarget.dataset.index)];
    if (!card) return;
    store.setSelectedService({ id: card.id, code: card.code, source: 'categories' });
    nav.go('service-detail');
  }
});
