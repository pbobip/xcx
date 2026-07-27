const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');

function loadPage(relativePath, responses, seed = {}) {
  const calls = [];
  const storage = new Map(Object.entries(seed));
  global.wx = {
    cloud: {
      async callFunction({ name, data }) {
        calls.push({ type: 'callFunction', name, data });
        return { result: await responses(data.action, data.payload || {}) };
      }
    },
    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : '';
    },
    setStorageSync(key, value) {
      storage.set(key, value);
    },
    removeStorageSync(key) {
      storage.delete(key);
    },
    navigateTo({ url }) {
      calls.push({ type: 'navigateTo', url });
    },
    switchTab({ url }) {
      calls.push({ type: 'switchTab', url });
    },
    showToast() {}
  };
  global.getApp = () => ({ syncMessageBadge() {} });
  global.getCurrentPages = () => [];

  let definition;
  global.Page = (page) => {
    definition = page;
  };
  const absolutePath = path.join(root, relativePath);
  delete require.cache[require.resolve(absolutePath)];
  require(absolutePath);

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(update) {
      Object.assign(this.data, update);
    },
    selectComponent() {
      return { show() {} };
    }
  });
  return { page, calls, storage };
}

function success(data) {
  return { success: true, data, requestId: '' };
}

test('分类页从云端加载专区与套餐并在翻页时去重', async () => {
  const responses = (action, payload) => {
    if (action === 'category.list') {
      return success({
        categories: [
          { id: 'category-lol', code: 'GAME_LOL', name: '英雄联盟专区', kind: 'GAME', gameId: 'game-lol' },
          { id: 'category-valorant', code: 'GAME_VALORANT', name: '无畏契约专区', kind: 'GAME', gameId: 'game-valorant' }
        ]
      });
    }
    if (action === 'service.list' && !payload.cursor) {
      assert.equal(payload.categoryId, 'category-lol');
      return success({
        services: [
          { id: 'service-a', code: 'VAL_A', name: '基础陪玩', subtitle: '10 元一局', priceCents: 1000, unitLabel: '局', status: 'ACTIVE', purchasable: true }
        ],
        nextCursor: 'next-page'
      });
    }
    if (action === 'service.list' && payload.cursor === 'next-page') {
      return success({
        services: [
          { id: 'service-a', code: 'VAL_A', name: '基础陪玩', subtitle: '重复项', priceCents: 1000, unitLabel: '局', status: 'ACTIVE', purchasable: true },
          { id: 'service-b', code: 'VAL_B', name: '技术陪玩', subtitle: '35 元一局', priceCents: 3500, unitLabel: '局', status: 'ACTIVE', purchasable: true }
        ],
        nextCursor: null
      });
    }
    throw new Error(`unexpected action: ${action}`);
  };
  const result = loadPage('pages/categories/categories.js', responses);

  await result.page.onLoad();
  await result.page.loadMore();

  assert.deepEqual(
    result.page.data.categories.map((item) => item.name),
    ['英雄联盟专区', '无畏契约专区']
  );
  assert.deepEqual(result.page.data.cards.map((item) => item.id), ['service-a', 'service-b']);
  assert.equal(result.page.data.hasMore, false);
  assert.equal(
    result.calls.filter((call) => call.type === 'callFunction' && call.data.action === 'service.list').length,
    2
  );
});

test('暂停接单套餐仍可从列表进入详情查看', () => {
  const result = loadPage('pages/categories/categories.js', () => {
    throw new Error('不应发起云请求');
  });
  result.page.setData({
    cards: [
      { id: 'service-paused', code: 'VAL_PAUSED', name: '暂停套餐', purchasable: false }
    ]
  });

  result.page.onCardTap({ currentTarget: { dataset: { index: 0 } } });

  assert.deepEqual(result.storage.get('bbx_selected_service'), {
    id: 'service-paused',
    code: 'VAL_PAUSED',
    source: 'categories'
  });
  assert.equal(result.calls.at(-1).url, '/pages/service-detail/service-detail');
});

test('分类页为加载、失败、空目录和加载更多提供明确反馈', () => {
  const markup = fs.readFileSync(
    path.join(root, 'pages/categories/categories.wxml'),
    'utf8'
  );

  assert.match(markup, /wx:if="\{\{loading\}\}"/);
  assert.match(markup, /bindtap="retry"/);
  assert.match(markup, /暂无开放套餐/);
  assert.match(markup, /bindtap="loadMore"/);
  assert.match(markup, /item\.purchasable/);
});

test('详情页按服务套餐 ID 读取云端数据且暂停套餐不能进入下单', async () => {
  const responses = (action, payload) => {
    assert.equal(action, 'service.detail');
    assert.equal(payload.serviceId, 'service-paused');
    return success({
      service: {
        id: 'service-paused',
        code: 'VAL_PAUSED',
        name: '暂停接单套餐',
        subtitle: '仍可查看详情',
        unit: 'ROUND',
        unitLabel: '局',
        priceCents: 2500,
        originalPriceCents: null,
        status: 'PAUSED',
        purchasable: false,
        platforms: ['PC'],
        regions: [{ code: 'CN', name: '国服', status: 'ACTIVE' }],
        fulfillmentStandard: '按订单约定完成服务',
        purchaseNotice: '仅限成年人下单',
        descriptionBlocks: [],
        stats: { orderCount: 0, reviewCount: 0, overallScore: null }
      }
    });
  };
  const result = loadPage(
    'pages/service-detail/service-detail.js',
    responses,
    { bbx_selected_service: { id: 'service-paused', code: 'VAL_PAUSED' } }
  );

  await result.page.onLoad({});
  result.page.onChoosePlan();

  assert.equal(result.page.data.service.name, '暂停接单套餐');
  assert.equal(result.page.data.service.purchasable, false);
  assert.equal(
    result.calls.some((call) => call.type === 'navigateTo' && call.url === '/pages/checkout/checkout'),
    false
  );
});

test('详情页展示云端套餐字段并覆盖加载、失败和暂停状态', () => {
  const markup = fs.readFileSync(
    path.join(root, 'pages/service-detail/service-detail.wxml'),
    'utf8'
  );
  const source = fs.readFileSync(
    path.join(root, 'pages/service-detail/service-detail.js'),
    'utf8'
  );

  assert.match(markup, /wx:if="\{\{loading\}\}"/);
  assert.match(markup, /bindtap="retry"/);
  assert.match(markup, /service\.fulfillmentStandard/);
  assert.match(markup, /service\.purchaseNotice/);
  assert.match(markup, /service\.stats\.orderCount/);
  assert.match(markup, /service\.purchasable/);
  assert.doesNotMatch(markup, /完整价目/);
  assert.doesNotMatch(source, /utils\/packages/);
});

test('搜索页从云端搜索套餐并在加载更多时去重', async () => {
  const responses = (action, payload) => {
    assert.equal(action, 'search');
    if (!payload.keyword) return success({ services: [], nextCursor: null });
    if (!payload.cursor) {
      return success({
        services: [
          { id: 'service-fun', code: 'VAL_FUN', name: '钻石段位娱乐陪', subtitle: '轻松组队', priceCents: 2500, unitLabel: '局', purchasable: true }
        ],
        nextCursor: 'search-next'
      });
    }
    return success({
      services: [
        { id: 'service-fun', code: 'VAL_FUN', name: '钻石段位娱乐陪', subtitle: '重复项', priceCents: 2500, unitLabel: '局', purchasable: true },
        { id: 'service-pro', code: 'VAL_PRO', name: '钻石段位技术陪', subtitle: '技术提升', priceCents: 3500, unitLabel: '局', purchasable: true }
      ],
      nextCursor: null
    });
  };
  const result = loadPage('pages/search/search.js', responses);

  await result.page.onLoad();
  await result.page.onInput({ detail: { value: '钻石' } });
  await result.page.loadMore();

  assert.equal(result.page.data.keyword, '钻石');
  assert.deepEqual(result.page.data.results.map((item) => item.id), ['service-fun', 'service-pro']);
  assert.equal(result.page.data.count, 2);
  assert.equal(result.page.data.hasMore, false);
});

test('搜索页展示云端结果并覆盖加载、失败、空结果和加载更多', () => {
  const markup = fs.readFileSync(path.join(root, 'pages/search/search.wxml'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'pages/search/search.js'), 'utf8');

  assert.match(markup, /wx:if="\{\{loading\}\}"/);
  assert.match(markup, /bindtap="retry"/);
  assert.match(markup, /没有找到匹配服务/);
  assert.match(markup, /bindtap="loadMore"/);
  assert.match(markup, /item\.purchasable/);
  assert.doesNotMatch(source, /const RESULTS/);
});

test('首页从云端加载横幅、最新套餐和推荐位并保持详情跳转', async () => {
  const responses = (action) => {
    assert.equal(action, 'home');
    const service = {
      id: 'service-pro',
      code: 'VAL_PRO',
      name: '钻石段位技术陪',
      subtitle: '技术提升',
      priceCents: 3500,
      unitLabel: '局',
      status: 'ACTIVE',
      purchasable: true
    };
    const latestService = Object.assign({}, service, {
      id: 'service-latest',
      code: 'LATEST',
      name: '最新服务套餐'
    });
    return success({
      banners: [{ id: 'banner-1', title: '云端横幅', subtitle: '开发测试内容', targetType: 'SERVICE', targetId: 'service-pro' }],
      latestServices: [latestService],
      recommendations: [{ id: 'recommend-1', code: 'HOME_RECOMMENDED', name: '推荐', services: [service] }],
      services: [latestService, service],
      nextCursor: null
    });
  };
  const result = loadPage('pages/home/home.js', responses);

  await result.page.onLoad();
  result.page.onFeedTap({ currentTarget: { dataset: { index: 0 } } });

  assert.equal(result.page.data.banner.title, '云端横幅');
  assert.equal(result.page.data.hotService.id, 'service-latest');
  assert.deepEqual(result.storage.get('bbx_selected_service'), {
    id: 'service-pro',
    code: 'VAL_PRO',
    source: 'home-feed'
  });
  assert.equal(result.calls.at(-1).url, '/pages/service-detail/service-detail');
});

test('首页横幅保留云端顺序并可跳转服务套餐详情', async () => {
  const service = {
    id: 'service-pro',
    code: 'VAL_PRO',
    name: '钻石段位技术陪',
    subtitle: '技术提升',
    priceCents: 3500,
    unitLabel: '局',
    status: 'ACTIVE',
    purchasable: true
  };
  const result = loadPage('pages/home/home.js', () => success({
    banners: [
      {
        id: 'banner-service',
        title: '技术陪推荐',
        subtitle: '查看服务套餐',
        targetType: 'SERVICE',
        targetId: 'service-pro'
      },
      {
        id: 'banner-category',
        title: '无畏契约专区',
        subtitle: '查看专区',
        targetType: 'CATEGORY',
        targetId: 'category-game-valorant'
      }
    ],
    latestServices: [],
    recommendations: [],
    services: [service],
    nextCursor: null
  }));

  await result.page.onLoad();
  result.page.onBannerTap({ currentTarget: { dataset: { index: 0 } } });

  assert.deepEqual(result.page.data.banners.map((item) => item.id), [
    'banner-service',
    'banner-category'
  ]);
  assert.deepEqual(result.storage.get('bbx_selected_service'), {
    id: 'service-pro',
    source: 'home-banner'
  });
  assert.equal(result.calls.at(-1).url, '/pages/service-detail/service-detail');
});

test('首页专区横幅进入分类页后选中指定专区', async () => {
  const home = loadPage('pages/home/home.js', () => success({
    banners: [
      {
        id: 'banner-category',
        title: '无畏契约专区',
        subtitle: '查看专区',
        targetType: 'CATEGORY',
        targetId: 'GAME_VALORANT'
      }
    ],
    latestServices: [],
    recommendations: [],
    services: [],
    nextCursor: null
  }));

  await home.page.onLoad();
  home.page.onBannerTap({ currentTarget: { dataset: { index: 0 } } });

  assert.deepEqual(home.storage.get('bbx_pending_category_target'), {
    targetId: 'GAME_VALORANT',
    source: 'home-banner'
  });
  assert.equal(home.calls.at(-1).url, '/pages/categories/categories');

  const categories = loadPage(
    'pages/categories/categories.js',
    (action, payload) => {
      if (action === 'category.list') {
        return success({
          categories: [
            { id: 'category-game-lol', code: 'GAME_LOL', name: '英雄联盟专区' },
            { id: 'category-game-valorant', code: 'GAME_VALORANT', name: '无畏契约专区' }
          ]
        });
      }
      assert.equal(action, 'service.list');
      assert.equal(payload.categoryId, 'category-game-valorant');
      return success({ services: [], nextCursor: null });
    },
    Object.fromEntries(home.storage)
  );

  await categories.page.onLoad();

  assert.equal(categories.page.data.activeCategoryId, 'category-game-valorant');
  assert.equal(categories.storage.has('bbx_pending_category_target'), false);
});

test('分类页已加载时仍会在再次显示后消费首页横幅专区目标', async () => {
  const result = loadPage(
    'pages/categories/categories.js',
    (action, payload) => {
      if (action === 'category.list') {
        return success({
          categories: [
            { id: 'category-game-lol', code: 'GAME_LOL', name: '英雄联盟专区' },
            { id: 'category-game-valorant', code: 'GAME_VALORANT', name: '无畏契约专区' }
          ]
        });
      }
      assert.equal(action, 'service.list');
      assert.ok([
        'category-game-lol',
        'category-game-valorant'
      ].includes(payload.categoryId));
      return success({ services: [], nextCursor: null });
    }
  );

  await result.page.onLoad();
  result.storage.set('bbx_pending_category_target', {
    targetId: 'GAME_VALORANT',
    source: 'home-banner'
  });
  await result.page.onShow();

  assert.equal(result.page.data.activeCategoryId, 'category-game-valorant');
  assert.equal(result.storage.has('bbx_pending_category_target'), false);
  assert.equal(
    result.calls.filter(
      (call) => call.type === 'callFunction'
        && call.data.action === 'service.list'
        && call.data.payload.categoryId === 'category-game-valorant'
    ).length,
    1
  );
});

test('首页最新服务不在推荐列表中重复展示', async () => {
  const service = {
    id: 'service-latest',
    code: 'LATEST',
    name: '最新服务套餐',
    subtitle: '开发模拟数据',
    priceCents: 900,
    unitLabel: '局',
    status: 'ACTIVE',
    purchasable: true
  };
  const result = loadPage('pages/home/home.js', () => success({
    banners: [],
    latestServices: [service],
    recommendations: [
      { id: 'recommend-1', code: 'HOME_RECOMMENDED', name: '推荐', services: [service] }
    ],
    services: [service],
    nextCursor: null
  }));

  await result.page.onLoad();

  assert.equal(result.page.data.hotService.id, 'service-latest');
  assert.deepEqual(result.page.data.feed.map((item) => item.id), []);
});

test('首页默认展示前三条最新服务且全部从推荐列表去重', async () => {
  const latestServices = ['a', 'b', 'c', 'd'].map((suffix, index) => ({
    id: `service-${suffix}`,
    code: `LATEST_${suffix.toUpperCase()}`,
    name: `最新服务 ${suffix.toUpperCase()}`,
    subtitle: '开发模拟数据',
    priceCents: 1000 + index * 100,
    unitLabel: '局',
    status: 'ACTIVE',
    purchasable: true
  }));
  const result = loadPage('pages/home/home.js', () => success({
    banners: [],
    latestServices,
    recommendations: [
      {
        id: 'recommend-1',
        code: 'HOME_RECOMMENDED',
        name: '推荐',
        services: latestServices.slice(0, 3)
      }
    ],
    services: latestServices,
    nextCursor: null
  }));

  await result.page.onLoad();
  result.page.goDetail({ currentTarget: { dataset: { index: 1 } } });

  assert.deepEqual(
    result.page.data.latestServices.map((item) => item.id),
    ['service-a', 'service-b', 'service-c']
  );
  assert.deepEqual(result.page.data.feed.map((item) => item.id), ['service-d']);
  assert.deepEqual(result.storage.get('bbx_selected_service'), {
    id: 'service-b',
    code: 'LATEST_B',
    source: 'home-latest'
  });
});

test('未配置最新服务时普通套餐不会被冒充为最新服务', async () => {
  const ordinary = {
    id: 'service-ordinary',
    code: 'ORDINARY',
    name: '普通推荐套餐',
    subtitle: '未勾选最新',
    priceCents: 2000,
    unitLabel: '局',
    status: 'ACTIVE',
    purchasable: true
  };
  const result = loadPage('pages/home/home.js', () => success({
    banners: [],
    latestServices: [],
    recommendations: [],
    services: [ordinary],
    nextCursor: null
  }));

  await result.page.onLoad();

  assert.deepEqual(result.page.data.latestServices, []);
  assert.equal(result.page.data.hotService, null);
  assert.deepEqual(result.page.data.feed.map((item) => item.id), ['service-ordinary']);
});

test('首页消费云端游标加载更多并去重', async () => {
  const base = {
    id: 'service-a',
    code: 'A',
    name: '套餐 A',
    subtitle: '第一页',
    priceCents: 1000,
    unitLabel: '局',
    purchasable: true
  };
  const responses = (action, payload) => {
    assert.equal(action, 'home');
    if (!payload.cursor) {
      return success({
        banners: [],
        latestServices: [],
        recommendations: [],
        services: [base],
        nextCursor: 'home-next'
      });
    }
    return success({
      banners: [],
      latestServices: [],
      recommendations: [],
      services: [base, Object.assign({}, base, { id: 'service-b', code: 'B', name: '套餐 B' })],
      nextCursor: null
    });
  };
  const result = loadPage('pages/home/home.js', responses);

  await result.page.onLoad();
  await result.page.loadMore();

  assert.equal(result.page.data.hotService, null);
  assert.deepEqual(result.page.data.feed.map((item) => item.id), ['service-a', 'service-b']);
  assert.equal(result.page.data.hasMore, false);
  assert.equal(
    result.calls.filter((call) => call.type === 'callFunction' && call.data.action === 'home').length,
    2
  );
});

test('首页展示云端横幅与套餐并覆盖加载、失败和空目录', () => {
  const markup = fs.readFileSync(path.join(root, 'pages/home/home.wxml'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'pages/home/home.js'), 'utf8');

  assert.match(markup, /wx:if="\{\{loading\}\}"/);
  assert.match(markup, /bindtap="retry"/);
  assert.match(markup, /<swiper/);
  assert.match(markup, /wx:for="\{\{banners\}\}"/);
  assert.match(markup, /indicator-dots="\{\{banners\.length > 1\}\}"/);
  assert.match(markup, /autoplay="\{\{banners\.length > 1\}\}"/);
  assert.match(markup, /bindtap="onBannerTap"/);
  assert.match(markup, /item\.title/);
  assert.match(markup, /wx:for="\{\{latestServices\}\}"/);
  assert.match(markup, /item\.name/);
  assert.match(markup, /bindtap="goDetail"/);
  assert.match(markup, /item\.purchasable/);
  assert.match(markup, /暂无开放套餐/);
  assert.match(markup, /bindtap="loadMore"/);
  assert.doesNotMatch(source, /无畏契约技术陪/);
});

test('确认订单重新校验云端套餐状态并阻止暂停套餐继续支付', async () => {
  const user = {
    id: 'user-1',
    platformUserNo: 'BBX-TEST',
    nickname: '微信用户',
    avatarFileId: null
  };
  const responses = (action, payload) => {
    assert.equal(action, 'service.detail');
    assert.equal(payload.serviceId, 'service-paused');
    return success({
      service: {
        id: 'service-paused',
        code: 'VAL_PAUSED',
        name: '暂停接单套餐',
        subtitle: '仍可查看详情',
        unitLabel: '局',
        priceCents: 2500,
        minQuantity: 1,
        maxQuantity: 99,
        status: 'PAUSED',
        purchasable: false,
        platforms: ['PC'],
        regions: [{ code: 'CN', name: '国服', status: 'ACTIVE' }],
        fulfillmentStandard: '按订单约定完成服务'
      }
    });
  };
  const result = loadPage('pages/checkout/checkout.js', responses, {
    bbx_current_user: user,
    bbx_selected_service: { id: 'service-paused', code: 'VAL_PAUSED' }
  });

  await result.page.onLoad();
  result.page.onPay();

  assert.equal(result.page.data.catalogBlocked, true);
  assert.match(result.page.data.error, /暂停接单/);
  assert.equal(result.page.data.paying, false);
  assert.equal(result.calls.some((call) => call.url === '/pages/payment-result/payment-result'), false);
});

test('确认订单不再依赖本地套餐常量并显示云端校验状态', () => {
  const source = fs.readFileSync(path.join(root, 'pages/checkout/checkout.js'), 'utf8');
  const markup = fs.readFileSync(path.join(root, 'pages/checkout/checkout.wxml'), 'utf8');

  assert.doesNotMatch(source, /utils\/packages/);
  assert.doesNotMatch(source, /PACKAGES/);
  assert.match(markup, /catalogLoading/);
  assert.match(markup, /catalogBlocked/);
  assert.doesNotMatch(markup, /pkgList/);
});
