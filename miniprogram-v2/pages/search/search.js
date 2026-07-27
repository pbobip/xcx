// 搜索页：关键词实时过滤 4 张结果卡（逻辑移植自原型 shared/app.js 的 runSearch）
const nav = require('../../utils/nav');
const store = require('../../utils/store');

const RESULTS = [
  { code: 'FUN', tag: '娱乐陪', title: '娱乐陪', note: '10 元 / 局起', price: '¥10起', serviceCode: 'FUN' },
  { code: 'PRO', tag: '技术陪', title: '技术陪', note: '15 元 / 局起', price: '¥15起', serviceCode: 'PRO' },
  { code: 'DM', tag: '钻石', title: '钻石段位', note: '娱乐陪 25 · 技术陪 35', price: '¥25起', serviceCode: 'PRO' },
  { code: 'SWEET', tag: '甜蜜单', title: '甜蜜单', note: '可以指定称呼', price: '¥52/h', serviceCode: 'SWEET' }
];

// 与原型 card.textContent.includes(term) 等价：按 DOM 顺序拼接卡片全部文案
// （code + 标签 + 标题 + 说明 + 「爆爆熊电竞」 + 价格）
const cardText = (r) => r.code + r.tag + r.title + r.note + '爆爆熊电竞' + r.price;

Page({
  data: {
    keyword: '',
    inputFocus: false,
    recentKeywords: ['钻石', '甜蜜单'],
    hotKeywords: ['娱乐陪', '技术陪', '超凡'],
    results: RESULTS.map((r) => Object.assign({ hidden: false }, r)),
    count: RESULTS.length
  },

  runSearch() {
    const term = this.data.keyword.trim();
    let count = 0;
    const results = RESULTS.map((r) => {
      const hit = !term || cardText(r).indexOf(term) !== -1;
      if (hit) count++;
      return Object.assign({ hidden: !hit }, r);
    });
    this.setData({ results, count });
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
    this.runSearch();
  },

  // 「清除」：清空输入并恢复全部结果（原型 data-clear-search）
  onClear() {
    this.setData({ keyword: '' });
    this.runSearch();
  },

  // 最近 / 热门关键词 chip：填入并过滤，同时聚焦输入框（原型 data-keyword）
  onKeyword(e) {
    this.setData({ keyword: e.currentTarget.dataset.keyword, inputFocus: true });
    this.runSearch();
  },

  onInputBlur() {
    this.setData({ inputFocus: false });
  },

  // 「清空」最近搜索：原型仅 toast，不移除 chip
  onClearRecent() {
    nav.toast('已清空最近搜索');
  },

  openDetail(e) {
    const item = this.data.results[Number(e.currentTarget.dataset.index)];
    store.setSelectedService({ code: item ? item.serviceCode : 'PRO', source: 'search' });
    nav.go('service-detail');
  }
});
