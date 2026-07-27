const nav = require('../../utils/nav');
const store = require('../../utils/store');
const auth = require('../../utils/auth');
const catalog = require('../../utils/catalog');

Page({
  data: {
    service: null,
    priceText: '',
    originalPriceText: '',
    loading: true,
    error: ''
  },

  async onLoad(options = {}) {
    const selected = store.getSelectedService(null);
    this.detailPayload = options.serviceId
      ? { serviceId: options.serviceId }
      : options.code
        ? { code: options.code }
        : selected && selected.id
          ? { serviceId: selected.id }
          : selected && selected.code
            ? { code: selected.code }
            : null;
    await this.loadDetail();
  },

  async loadDetail() {
    if (!this.detailPayload) {
      this.setData({ loading: false, error: '服务套餐参数缺失' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const data = await catalog.call('service.detail', this.detailPayload);
      const service = data.service;
      this.setData({
        service,
        priceText: catalog.formatPrice(service.priceCents, service.unitLabel),
        originalPriceText: service.originalPriceCents == null
          ? ''
          : catalog.formatPrice(service.originalPriceCents, service.unitLabel),
        error: ''
      });
      store.setSelectedService({ id: service.id, code: service.code, source: 'service-detail' });
    } catch (error) {
      this.setData({ service: null, error: error.message || '套餐详情加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async retry() {
    await this.loadDetail();
  },

  onShareAppMessage() {
    return {
      title: `爆爆熊电竞｜${this.data.service ? this.data.service.name : '服务套餐'}`,
      path: this.data.service
        ? `/pages/service-detail/service-detail?serviceId=${this.data.service.id}`
        : '/pages/home/home'
    };
  },

  onChoosePlan() {
    if (!this.data.service) {
      nav.toast('套餐尚未加载完成');
      return;
    }
    if (!this.data.service.purchasable) {
      nav.toast('该套餐当前暂停接单');
      return;
    }
    store.setSelectedService({
      id: this.data.service.id,
      code: this.data.service.code,
      source: 'service-detail'
    });
    if (!auth.requireLogin('checkout')) return;
    nav.go('checkout');
  }
});
