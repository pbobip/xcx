const nav = require('../../utils/nav');
const store = require('../../utils/store');
const { PACKAGES, getPackage, getIndexByCode, normalizeIndex } = require('../../utils/packages');

Page({
  data: {
    // 套餐 segmented（默认技术陪）
    pkgList: PACKAGES.map((pkg) => pkg.label),
    pkgIndex: 2,
    pkg: getPackage(2),
    // 步进器 1-99，总价随套餐单价同步变化
    qty: 1,
    total: getPackage(2).unitPrice,
    // 游戏平台 segmented
    platformList: ['电脑端'],
    platformIndex: 0,
    // 区服 picker
    serverList: ['无畏契约国服', '其他区服（联系客服确认）'],
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
    // 弹层与支付态
    couponOpen: false,
    paying: false
  },

  onLoad() {
    if (!store.isLoggedIn()) {
      store.setLoginReturn({ page: 'checkout', mode: 'back' });
      nav.go('login');
      return;
    }
    const selected = store.getSelectedService({ code: 'PRO' });
    this.applyPackage(selected && selected.code ? getIndexByCode(selected.code) : 2);
  },

  noop() {},

  goDetail() {
    nav.go('service-detail');
  },

  onPkgTap(e) {
    this.applyPackage(e.currentTarget.dataset.index);
  },

  applyPackage(index) {
    const pkgIndex = normalizeIndex(index);
    const pkg = getPackage(pkgIndex);
    this.setData({ pkgIndex, pkg, total: pkg.unitPrice * this.data.qty });
    store.setSelectedService({ code: pkg.code, source: 'checkout' });
  },

  onPlatformTap(e) {
    this.setData({ platformIndex: Number(e.currentTarget.dataset.index) });
  },

  onTimeTap(e) {
    this.setData({ timeIndex: Number(e.currentTarget.dataset.index) });
  },

  onStep(e) {
    const step = Number(e.currentTarget.dataset.step);
    const next = Math.max(1, Math.min(99, this.data.qty + step));
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
    if (!store.isLoggedIn()) {
      store.setLoginReturn({ page: 'checkout', mode: 'back' });
      nav.go('login');
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
