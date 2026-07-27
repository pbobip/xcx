const nav = require('../../utils/nav');
const store = require('../../utils/store');
const catalog = require('../../utils/catalog');

Page({
  data: {
    games: [],
    categories: [],
    activeGameId: '',
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

  onShow() {
    getApp().syncMessageBadge();
  },

  goSearch() {
    nav.go('search');
  },

  async loadInitial() {
    this.setData({ loading: true, error: '' });
    try {
      const [gameData, categoryData] = await Promise.all([
        catalog.call('game.list'),
        catalog.call('category.list', { kind: 'GAME' })
      ]);
      const categoryGameIds = new Set(categoryData.categories.map((item) => item.gameId));
      const games = gameData.games.filter((item) => categoryGameIds.has(item.id));
      const activeGameId = games[0] ? games[0].id : '';
      this.setData({
        games,
        categories: categoryData.categories,
        activeGameId,
        cards: [],
        nextCursor: null,
        hasMore: false
      });
      if (activeGameId) await this.loadServices(true);
    } catch (error) {
      this.setData({ error: error.message || '目录加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadServices(reset) {
    const gameId = this.data.activeGameId;
    const payload = { gameId, limit: 10 };
    if (!reset && this.data.nextCursor) payload.cursor = this.data.nextCursor;
    const data = await catalog.call('service.list', payload);
    if (gameId !== this.data.activeGameId) return;
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

  async switchGame(e) {
    const gameId = e.currentTarget.dataset.gameId;
    if (!gameId || gameId === this.data.activeGameId) return;
    this.setData({ activeGameId: gameId, cards: [], nextCursor: null, hasMore: false, loading: true, error: '' });
    try {
      await this.loadServices(true);
    } catch (error) {
      this.setData({ error: error.message || '套餐加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onCardTap(e) {
    const card = this.data.cards[Number(e.currentTarget.dataset.index)];
    if (!card || !card.purchasable) {
      if (card) nav.toast(card.name + '当前暂停接单');
      return;
    }
    store.setSelectedService({ id: card.id, code: card.code, source: 'categories' });
    nav.go('service-detail');
  }
});
