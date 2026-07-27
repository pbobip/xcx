const nav = require('../../utils/nav');
const store = require('../../utils/store');
const auth = require('../../utils/auth');
const { getPackageByCode } = require('../../utils/packages');

Page({
  data: {
    code: 'PRO',
    pkg: getPackageByCode('PRO')
  },

  onLoad(options) {
    const selected = store.getSelectedService({ code: 'PRO' });
    const code = options.code || (selected && selected.code) || 'PRO';
    const pkg = getPackageByCode(code);
    this.setData({ code: pkg.code, pkg });
    store.setSelectedService({ code: pkg.code, source: options.code ? 'share' : 'service-detail' });
  },

  onShareAppMessage() {
    return {
      title: `爆爆熊电竞｜${this.data.pkg.title}`,
      path: `/pages/service-detail/service-detail?code=${this.data.pkg.code}`
    };
  },

  onChoosePlan() {
    store.setSelectedService({ code: this.data.pkg.code, source: 'service-detail' });
    if (!auth.requireLogin('checkout')) return;
    nav.go('checkout');
  }
});
