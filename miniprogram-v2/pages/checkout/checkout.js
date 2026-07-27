const nav = require('../../utils/nav');
const store = require('../../utils/store');
const auth = require('../../utils/auth');
const catalog = require('../../utils/catalog');
const order = require('../../utils/order');

function yuan(cents) {
  const value = (Number(cents) || 0) / 100;
  return Number.isInteger(value) ? value : Number(value.toFixed(2));
}

function requiredFieldMap(fields) {
  const defaults = {
    platform: true,
    region: true,
    gameId: true,
    serviceMode: true,
    scheduledAt: false,
    customerNote: false,
    adultConfirmed: true
  };
  for (const field of fields || []) {
    if (Object.prototype.hasOwnProperty.call(defaults, field.key)) {
      defaults[field.key] = field.required === true;
    }
  }
  return defaults;
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
    serverCodes: [],
    server: '',
    serverLabel: '',
    requiredFields: requiredFieldMap([]),
    // 表单
    gameId: '',
    timeList: ['立即服务', '预约时间'],
    timeIndex: 0,
    scheduledDate: '',
    scheduledTime: '',
    note: '',
    adult: false,
    error: '',
    idFocused: false,
    noteFocused: false,
    catalogLoading: true,
    catalogBlocked: true,
    couponOpen: false,
    paying: false,
    quoting: false,
    idempotencyKey: ''
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
      const serverCodes = (service.regions || [])
        .filter((region) => region.status === 'ACTIVE')
        .map((region) => region.code);
      const catalogBlocked = !service.purchasable;
      this.setData({
        pkg,
        minQuantity: service.minQuantity || 1,
        maxQuantity: service.maxQuantity || 99,
        qty: service.minQuantity || 1,
        total: unitPrice * (service.minQuantity || 1),
        platformList,
        serverList,
        serverCodes,
        requiredFields: requiredFieldMap(service.orderFields),
        catalogBlocked,
        idempotencyKey: order.idempotencyKey(),
        error: catalogBlocked ? '该服务套餐当前暂停接单，请返回目录选择其他套餐。' : ''
      });
      store.setSelectedService({ id: service.id, code: service.code, source: 'checkout' });
      if (!catalogBlocked) await this.refreshQuote(service.minQuantity || 1);
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
    const timeIndex = Number(e.currentTarget.dataset.index);
    const update = { timeIndex };
    if (timeIndex === 0) {
      update.scheduledDate = '';
      update.scheduledTime = '';
    }
    this.setData(update);
  },

  async refreshQuote(quantity) {
    if (!this.data.pkg || this.data.catalogBlocked) return;
    this.setData({ quoting: true });
    try {
      const data = await order.call('quote', {
        serviceId: this.data.pkg.id,
        quantity
      });
      this.setData({ total: yuan(data.quote.payableAmountCents), error: '' });
    } catch (error) {
      this.setData({ error: error.message || '金额计算失败，请稍后重试。' });
    } finally {
      this.setData({ quoting: false });
    }
  },

  async onStep(e) {
    const step = Number(e.currentTarget.dataset.step);
    const next = Math.max(this.data.minQuantity, Math.min(this.data.maxQuantity, this.data.qty + step));
    this.setData({ qty: next });
    await this.refreshQuote(next);
  },

  openCoupon() {
    this.setData({ couponOpen: true });
  },

  closeCoupon() {
    this.setData({ couponOpen: false });
  },

  onServerChange(e) {
    const index = Number(e.detail.value);
    this.setData({
      server: this.data.serverCodes[index],
      serverLabel: this.data.serverList[index]
    });
  },

  onScheduledDateChange(e) {
    this.setData({ scheduledDate: e.detail.value });
  },

  onScheduledTimeChange(e) {
    this.setData({ scheduledTime: e.detail.value });
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
  async onPay() {
    if (this.data.paying) return;
    if (!auth.requireLogin('checkout', 'back')) return;
    if (this.data.catalogBlocked || !this.data.pkg) {
      this.setData({ error: this.data.error || '当前套餐不可下单，请返回目录重新选择。' });
      return;
    }
    const id = this.data.gameId.trim();
    const server = this.data.server;
    const adult = this.data.adult;
    const platform = this.data.platformList[this.data.platformIndex] || '';
    if (this.data.requiredFields.platform && !platform) {
      this.setData({ error: '请选择游戏平台后再下单。' });
      return;
    }
    if (this.data.requiredFields.region && !server) {
      this.setData({ error: '请选择游戏区服后再下单。' });
      return;
    }
    if (this.data.requiredFields.gameId && !id) {
      this.setData({ error: '请填写游戏文字 ID 后再下单。' });
      return;
    }
    if (!adult) { this.setData({ error: '请确认本人已成年并阅读点单规则。' }); return; }
    if (this.data.timeIndex === 1 && (!this.data.scheduledDate || !this.data.scheduledTime)) {
      this.setData({ error: '请选择完整的预约日期和时间。' });
      return;
    }
    if (/密码|验证码|支付密码|身份证/.test(this.data.note)) {
      this.setData({ error: '备注包含敏感信息，请删除密码、验证码或证件内容。' });
      return;
    }
    this.setData({ error: '', paying: true });
    const serviceMode = this.data.timeIndex === 1 ? 'RESERVATION' : 'IMMEDIATE';
    const scheduledAt = serviceMode === 'RESERVATION'
      ? `${this.data.scheduledDate}T${this.data.scheduledTime}:00+08:00`
      : '';
    try {
      const data = await order.call('create', {
        serviceId: this.data.pkg.id,
        quantity: this.data.qty,
        orderValues: {
          platform,
          region: server,
          gameId: id,
          serviceMode,
          scheduledAt,
          customerNote: this.data.note.trim(),
          adultConfirmed: 'CONFIRMED'
        }
      }, { idempotencyKey: this.data.idempotencyKey });
      const cloudOrder = data.order;
      const snapshotService = cloudOrder.snapshot.service;
      store.setLastOrder(Object.assign({}, cloudOrder, {
        status: '待付款',
        title: snapshotService.name,
        label: snapshotService.name,
        standard: cloudOrder.snapshot.fulfillmentStandard,
        qty: cloudOrder.quantity,
        unit: snapshotService.unitLabel,
        unitPrice: yuan(cloudOrder.unitPriceCents),
        total: yuan(cloudOrder.payableAmountCents),
        server: this.data.serverLabel,
        platform,
        gameId: id,
        timeType: this.data.timeList[this.data.timeIndex]
      }));
      nav.redirect('payment-result');
    } catch (error) {
      this.setData({ error: error.message || '服务订单创建失败，请稍后重试。' });
    } finally {
      this.setData({ paying: false });
    }
  }
});
