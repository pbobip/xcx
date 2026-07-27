// 游戏分类页：左侧 6 游戏菜单切换右侧价目列表（数据展开自原型 shared/app.js 的 gameCatalog）
const nav = require('../../utils/nav');
const store = require('../../utils/store');

const GAMES = ['英雄联盟', '永劫无间', '三角洲行动', '王者荣耀', '绝地求生', '无畏契约'];

// 原型 serviceCard(code, title, tier, note, price)：可点击进入服务详情
const serviceCard = (code, title, tier, note, price) => ({
  code,
  tag: tier,
  title,
  note,
  oldPrice: '爆爆熊电竞',
  price,
  available: true
});

// 原型 unavailableGameCard(code, game)：待运营配置，不可点击
const unavailableGameCard = (code, game) => ({
  code,
  tag: game,
  title: '陪玩与护航',
  note: '套餐价格与规则配置中',
  oldPrice: '',
  price: '敬请期待',
  available: false
});

const GAME_CATALOG = {
  '英雄联盟': [unavailableGameCard('LOL', '英雄联盟')],
  '永劫无间': [unavailableGameCard('NAR', '永劫无间')],
  '三角洲行动': [unavailableGameCard('DF', '三角洲行动')],
  '王者荣耀': [unavailableGameCard('HOK', '王者荣耀')],
  '绝地求生': [unavailableGameCard('PUBG', '绝地求生')],
  '无畏契约': [
    serviceCard('BASIC', '匹配 / 下三 / 黄金', '基础档', '10 元一局或 20 元 / 小时', '¥10/局'),
    serviceCard('FUN', '娱乐陪', '娱乐陪', '基础 10 · 铂金 15 · 钻石 25 · 超凡 35', '¥10起'),
    serviceCard('PRO', '技术陪', '技术陪', '基础 15 · 铂金 25 · 钻石 35 · 超凡 45', '¥15起'),
    serviceCard('SWEET', '甜蜜单', '甜蜜单', '可以指定称呼', '¥52/h')
  ]
};

Page({
  data: {
    games: GAMES,
    activeGame: GAMES[0],
    cards: GAME_CATALOG[GAMES[0]]
  },

  onShow() {
    getApp().syncMessageBadge();
  },

  goSearch() {
    nav.go('search');
  },

  switchGame(e) {
    const game = e.currentTarget.dataset.game;
    if (!GAME_CATALOG[game]) return;
    this.setData({ activeGame: game, cards: GAME_CATALOG[game] });
    nav.toast('已切换至' + game);
  },

  onCardTap(e) {
    const card = this.data.cards[Number(e.currentTarget.dataset.index)];
    if (!e.currentTarget.dataset.available) {
      if (card) nav.toast(card.title + '暂未开放');
      return;
    }
    store.setSelectedService({ code: card ? card.code : 'PRO', source: 'categories' });
    nav.go('service-detail');
  }
});
