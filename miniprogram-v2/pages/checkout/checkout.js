const nav = require('../../utils/nav');
const store = require('../../utils/store');
const auth = require('../../utils/auth');
const catalog = require('../../utils/catalog');

function yuan(cents) {
  const value = (Number(cents) || 0) / 100;
  return Number.isInteger(value) ? value : Number(value.toFixed(2));
}

Page({
  data: {
    pkg: null,
    qty: 1,
    minQuantity: 1,
    maxQuantity: 99,
    total: 0,
    platformList: [],
    platformIndex: 0,
    serverList: [],
    server: '',
    // 表单
    gameId: '',
    timeList: ['立即服务', '预约时间'],
    timeIndex: 0,
    note: '',
    adult: false,
    error: '',
    idFocused: false,
    noteFocused: false,
    catalogLoading: true,
    catalogBlocked: true,
    couponOpen: false,
    paying: false
  },

  async onLoad() {
    if (!auth.requireLogin('checkout', 'back')) return;
    const selected = store.getSelectedService(null);
    if (!selected || (!selected.id && !selected.code)) {
      this.setData({ catalogLoading: false, catalogBlocked: true, error: '未选择服务套餐，请返回目录重新选择。' });
      return;
    }
    try {
      const data = await catalog.call(
        'service.detail',
        selected.id ? { serviceId: selected.id } : { code: selected.code }
      );
      const service = data.service;
      const unitPrice = yuan(service.priceCents);
      const pkg = {
        id: service.id,
        code: service.code,
        label: service.name,
        title: service.name,
        standard: service.fulfillmentStandard,
        unit: service.unitLabel,
        unitPrice
      };
      const platformList = service.platforms || [];
      const serverList = (service.regions || [])
        .filter((region) => region.status === 'ACTIVE')
        .map((region) => region.name);
      const catalogBlocked = !service.purchasable;
      this.setData({
        pkg,
        minQuantity: service.minQuantity || 1,
        maxQuantity: service.maxQuantity || 99,
        qty: service.minQuantity || 1,
        total: unitPrice * (service.minQuantity || 1),
        platformList,
        serverList,
        catalogBlocked,
        error: catalogBlocked ? '该服务套餐当前暂停接单，请返回目录选择其他套餐。' : ''
      });
      store.setSelectedService({ id: service.id, code: service.code, source: 'checkout' });
    } catch (error) {
      this.setData({ catalogBlocked: true, error: error.message || '套餐已下架或暂时无法读取。' });
    } finally {
      this.setData({ catalogLoading: false });
    }
  },

  noop() {},

  goDetail() {
    nav.go('service-detail');
  },

  onPlatformTap(e) {
    this.setData({ platformIndex: Number(e.currentTarget.dataset.index) });
  },

  onTimeTap(e) {
    this.setData({ timeIndex: Number(e.currentTarget.dataset.index) });
  },

  onStep(e) {
    const step = Number(e.currentTarget.dataset.step);
    const next = Math.max(this.data.minQuantity, Math.min(this.data.maxQuantity, this.data.qty + step));
    this.setData({ qty: next, total: next * this.data.pkg.unitPrice });
  },

  openCoupon() {
    this.setData({ couponOpen: true });
  },

  closeCoupon() {
    this.setData({ couponOpen: false });
  },

  onServerChange(e) {
    this.setData({ server: this.data.serverList[Number(e.detail.value)] });
  },

  onIdInput(e) {
    this.setData({ gameId: e.detail.value });
  },

  onIdFocus() {
    this.setData({ idFocused: true });
  },

  onIdBlur() {
    this.setData({ idFocused: false });
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value });
  },

  onNoteFocus() {
    this.setData({ noteFocused: true });
  },

  onNoteBlur() {
    this.setData({ noteFocused: false });
  },

  toggleAdult() {
    this.setData({ adult: !this.data.adult });
  },

  // 校验顺序与文案与原型一致（shared/app.js 211-218 行）
  onPay() {
    if (this.data.paying) return;
    if (!auth.requireLogin('checkout', 'back')) return;
    if (this.data.catalogBlocked || !this.data.pkg) {
      this.setData({ error: this.data.error || '当前套餐不可下单，请返回目录重新选择。' });
      return;
    }
    const id = this.data.gameId.trim();
    const server = this.data.server;
    const adult = this.data.adult;
    if (!server) { this.setData({ error: '请选择游戏区服后再支付。' }); return; }
    if (!id) { this.setData({ error: '请填写游戏文字 ID 后再支付。' }); return; }
    if (!adult) { this.setData({ error: '请确认本人已成年并阅读点单规则。' }); return; }
    if (/密码|验证码|支付密码|身份证/.test(this.data.note)) {
      this.setData({ error: '备注包含敏感信息，请删除密码、验证码或证件内容。' });
      return;
    }
    store.setLastOrder({
      orderNo: 'BBX-DEMO-001',
      status: '待服务',
      title: this.data.pkg.title,
      label: this.data.pkg.label,
      standard: this.data.pkg.standard,
      qty: this.data.qty,
      unit: this.data.pkg.unit,
      unitPrice: this.data.pkg.unitPrice,
      total: this.data.total,
      server,
      platform: this.data.platformList[this.data.platformIndex],
      gameId: id,
      timeType: this.data.timeList[this.data.timeIndex]
    });
    this.setData({ error: '', paying: true });
    setTimeout(() => nav.redirect('payment-result'), 450);
  }
});
