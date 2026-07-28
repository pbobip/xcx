const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadPage(relativePath, seed = {}, options = {}) {
  const storage = new Map(Object.entries(seed));
  const calls = [];

  global.wx = {
    cloud: {
      async callFunction(params) {
        calls.push({ type: 'callFunction', name: params.name, data: params.data });
        if (options.cloudCall) return options.cloudCall(params);
        return options.cloudResponse || {
          result: {
            success: true,
            data: {
              user: {
                id: 'users-test',
                platformUserNo: 'BBX-TEST',
                nickname: '微信用户',
                avatarFileId: null
              },
              isFirstLogin: false
            }
          }
        };
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
    redirectTo({ url }) {
      calls.push({ type: 'redirectTo', url });
    },
    switchTab({ url }) {
      calls.push({ type: 'switchTab', url });
    },
    reLaunch({ url }) {
      calls.push({ type: 'reLaunch', url });
    },
    setClipboardData() {},
    showToast() {}
  };
  global.getCurrentPages = () => [{}, {}];
  global.getApp = () => ({ syncMessageBadge() {} });

  let definition;
  global.Page = (page) => {
    definition = page;
  };

  const absolutePath = path.join(root, relativePath);
  delete require.cache[require.resolve(absolutePath)];
  require(absolutePath);

  const instance = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(update) {
      Object.assign(this.data, update);
    }
  });

  return { page: instance, storage, calls };
}

test('游客选择套餐时先进入登录，云端登录后回到确认订单', async () => {
  const detail = loadPage('pages/service-detail/service-detail.js', {}, {
    cloudResponse: {
      result: {
        success: true,
        data: {
          service: {
            id: 'service-val-pro',
            code: 'VAL_PRO',
            name: '钻石段位技术陪',
            subtitle: '技术提升',
            priceCents: 3500,
            originalPriceCents: null,
            unitLabel: '局',
            purchasable: true,
            platforms: ['PC'],
            regions: [],
            descriptionBlocks: [],
            fulfillmentStandard: '按订单约定完成服务',
            purchaseNotice: '仅限成年人下单',
            stats: { orderCount: 0, reviewCount: 0, overallScore: null }
          }
        }
      }
    }
  });

  await detail.page.onLoad({ serviceId: 'service-val-pro' });

  detail.page.onChoosePlan();

  assert.equal(detail.calls.at(-1).url, '/pages/login/login');
  assert.deepEqual(detail.storage.get('bbx_login_return'), {
    page: 'checkout',
    mode: 'redirect'
  });

  const login = loadPage('pages/login/login.js', {
    bbx_login_return: detail.storage.get('bbx_login_return')
  });
  await login.page.onWechatLogin();

  assert.deepEqual(login.calls.find((call) => call.type === 'callFunction'), {
    type: 'callFunction',
    name: 'auth',
    data: { action: 'init', payload: {} }
  });
  assert.deepEqual(login.storage.get('bbx_current_user'), {
    id: 'users-test',
    platformUserNo: 'BBX-TEST',
    nickname: '微信用户',
    avatarFileId: null
  });
  assert.equal(login.storage.has('bbx_login_return'), false);
  assert.deepEqual(login.calls.at(-1), {
    type: 'redirectTo',
    url: '/pages/checkout/checkout'
  });
});

test('游客直接打开确认订单页也不能绕过登录校验', () => {
  const checkout = loadPage('pages/checkout/checkout.js');

  checkout.page.onLoad();

  assert.equal(checkout.calls.at(-1).url, '/pages/login/login');
  assert.deepEqual(checkout.storage.get('bbx_login_return'), {
    page: 'checkout',
    mode: 'back'
  });
});

test('云端登录顾客选择套餐后可以继续打开确认订单', async () => {
  const seed = {
    bbx_current_user: {
      id: 'users-test',
      platformUserNo: 'BBX-TEST',
      nickname: '微信用户',
      avatarFileId: null
    }
  };
  const service = {
    id: 'service-val-pro',
    code: 'VAL_PRO',
    name: '钻石段位技术陪',
    subtitle: '技术提升',
    priceCents: 3500,
    originalPriceCents: null,
    minQuantity: 1,
    maxQuantity: 99,
    unitLabel: '局',
    purchasable: true,
    platforms: ['PC'],
    regions: [{ code: 'CN', name: '国服', status: 'ACTIVE' }],
    descriptionBlocks: [],
    fulfillmentStandard: '按订单约定完成服务',
    purchaseNotice: '仅限成年人下单',
    stats: { orderCount: 0, reviewCount: 0, overallScore: null }
  };
  const cloudResponse = { result: { success: true, data: { service } } };
  const detail = loadPage('pages/service-detail/service-detail.js', seed, { cloudResponse });

  await detail.page.onLoad({ serviceId: service.id });

  detail.page.onChoosePlan();

  assert.equal(detail.calls.at(-1).url, '/pages/checkout/checkout');

  const checkout = loadPage('pages/checkout/checkout.js', Object.assign({}, seed, {
    bbx_selected_service: detail.storage.get('bbx_selected_service')
  }), { cloudResponse });
  await checkout.page.onLoad();

  assert.equal(
    checkout.calls.some((call) => call.url === '/pages/login/login'),
    false
  );
  assert.equal(checkout.page.data.catalogBlocked, false);
});

test('访客打开消息页时先登录，登录后返回消息页', async () => {
  const messages = loadPage('pages/messages/messages.js');

  messages.page.onShow();

  assert.equal(messages.calls.at(-1).url, '/pages/login/login');
  assert.deepEqual(messages.storage.get('bbx_login_return'), {
    page: 'messages',
    mode: 'redirect'
  });

  const login = loadPage('pages/login/login.js', {
    bbx_login_return: messages.storage.get('bbx_login_return')
  });
  await login.page.onWechatLogin();

  assert.deepEqual(login.calls.at(-1), {
    type: 'switchTab',
    url: '/pages/messages/messages'
  });
});

test('访客从个人中心进入订单时先登录并保留目标页', () => {
  const profile = loadPage('pages/profile/profile.js');

  profile.page.goOrders({ currentTarget: { dataset: { status: '进行中' } } });

  assert.equal(profile.calls.at(-1).url, '/pages/login/login');
  assert.deepEqual(profile.storage.get('bbx_login_return'), {
    page: 'orders',
    mode: 'redirect'
  });
});

test('访客不能绕过订单、优惠券和投诉等顾客资料页登录门禁', () => {
  const protectedPages = [
    ['pages/orders/orders.js', 'orders', 'onLoad'],
    ['pages/coupons/coupons.js', 'coupons', 'onLoad'],
    ['pages/complaints/complaints.js', 'complaints', 'onLoad'],
    ['pages/complaint-submit/complaint-submit.js', 'complaint-submit', 'onLoad'],
    ['pages/order-detail/order-detail.js', 'order-detail', 'onLoad'],
    ['pages/payment-result/payment-result.js', 'payment-result', 'onShow']
  ];

  for (const [relativePath, pageName, lifecycle] of protectedPages) {
    const result = loadPage(relativePath);
    result.page[lifecycle]();
    assert.equal(result.calls.at(-1).url, '/pages/login/login');
    assert.deepEqual(result.storage.get('bbx_login_return'), {
      page: pageName,
      mode: 'back'
    });
  }
});

test('个人中心展示云端登录返回的平台用户资料', () => {
  const profile = loadPage('pages/profile/profile.js', {
    bbx_current_user: {
      id: 'users-test',
      platformUserNo: 'BBX-20260727-ABC123',
      nickname: '云东',
      avatarFileId: null
    }
  });

  profile.page.onShow();

  assert.equal(profile.page.data.loggedIn, true);
  assert.equal(profile.page.data.user.nickname, '云东');
  assert.equal(profile.page.data.user.platformUserNo, 'BBX-20260727-ABC123');
});

test('个人中心订单汇总失败时展示未知计数而不是误导性的零', async () => {
  const profile = loadPage('pages/profile/profile.js', {}, {
    cloudCall: async () => {
      throw new Error('network unavailable');
    }
  });

  await profile.page.loadOrderCounts();

  assert.deepEqual(profile.page.data.quicks.map((item) => item.count), ['—', '—', '—', '—']);
  assert.match(profile.page.data.orderCountsError, /加载失败/);
  assert.match(readSource('pages/profile/profile.wxml'), /\{\{orderCountsError\}\}/);
});

test('我的订单快捷入口会把所选状态带到订单页', () => {
  const profile = loadPage('pages/profile/profile.js', {
    bbx_current_user: {
      id: 'users-test',
      platformUserNo: 'BBX-TEST',
      nickname: '微信用户',
      avatarFileId: null
    }
  });
  profile.page.goOrders({ currentTarget: { dataset: { status: '进行中' } } });

  assert.equal(profile.storage.get('bbx_pending_tab_state'), '进行中');
  assert.equal(profile.calls.at(-1).url, '/pages/orders/orders');

  const orders = loadPage('pages/orders/orders.js', {
    bbx_pending_tab_state: profile.storage.get('bbx_pending_tab_state')
  });
  assert.equal(typeof orders.page.onShow, 'function');
  orders.page.onShow();

  assert.equal(orders.page.data.activeTab, '进行中');
  assert.equal(orders.page.data.activeTabKey, 'inProgress');
  assert.equal(orders.storage.has('bbx_pending_tab_state'), false);
});

test('订单列表初始为空，数据由云端加载', () => {
  const orders = loadPage('pages/orders/orders.js');
  assert.deepEqual(orders.page.data.orders, []);
  assert.equal(orders.page.data.empty, false);
  assert.equal(typeof orders.page.loadOrders, 'function');
  assert.equal(typeof orders.page.loadSummary, 'function');
});

test('顾客订单加载失败后可从错误状态重试并恢复列表', async () => {
  let attempts = 0;
  const orders = loadPage('pages/orders/orders.js', {}, {
    cloudCall: async ({ data }) => {
      if (data.action !== 'list') return { result: { success: true, data: { counts: {} } } };
      attempts += 1;
      if (attempts === 1) throw new Error('network unavailable');
      return {
        result: {
          success: true,
          data: {
            orders: [{
              _id: 'order-1',
              orderNo: 'BBX-TEST-001',
              paymentStatus: 'UNPAID',
              fulfillmentStatus: 'NOT_STARTED',
              afterSalesStatus: 'NONE',
              serviceSnapshot: { code: 'VAL_PRO', name: '钻石段位技术陪', unitLabel: '局' },
              quantity: 1,
              payableAmountCents: 3500,
              version: 1
            }],
            nextCursor: null
          }
        }
      };
    }
  });

  await orders.page.loadOrders(null);

  assert.match(orders.page.data.error, /网络异常/);
  assert.match(readSource('pages/orders/orders.wxml'), /bindtap="retry"/);

  await orders.page.retry();

  assert.equal(orders.page.data.error, '');
  assert.equal(orders.page.data.orders[0].orderNo, 'BBX-TEST-001');
});

test('订单详情页通过 URL 参数 orderNo 从云端加载', () => {
  const detail = loadPage('pages/order-detail/order-detail.js', {
    bbx_current_user: {
      id: 'users-test',
      platformUserNo: 'BBX-TEST',
      nickname: '微信用户',
      avatarFileId: null
    }
  });
  detail.page.onLoad({ orderNo: 'BBX-20260727-182734-ERI36I' });

  // 验证调用了 order.detail 云函数
  const detailCall = detail.calls.find(
    (c) => c.type === 'callFunction' && c.data && c.data.action === 'detail'
  );
  assert.ok(detailCall, '应该调用 order.detail 云函数');
  assert.equal(detailCall.data.payload.orderNo, 'BBX-20260727-182734-ERI36I');
});

test('首页云端推荐卡打开与卡片文案一致的技术陪套餐', async () => {
  const service = {
    id: 'service-val-pro',
    code: 'VAL_PRO',
    name: '钻石段位技术陪',
    subtitle: '技术提升',
    priceCents: 3500,
    unitLabel: '局',
    purchasable: true
  };
  const latestService = Object.assign({}, service, {
    id: 'service-latest',
    code: 'LATEST',
    name: '最新服务套餐'
  });
  const home = loadPage('pages/home/home.js', {}, {
    cloudResponse: {
      result: {
        success: true,
        data: {
          banners: [],
          latestServices: [latestService],
          recommendations: [
            { id: 'recommend-main', code: 'HOME_RECOMMENDED', name: '推荐', services: [service] }
          ],
          services: [latestService, service],
          nextCursor: null
        }
      }
    }
  });

  await home.page.onLoad();

  home.page.onFeedTap({ currentTarget: { dataset: { index: 0 } } });

  assert.deepEqual(home.storage.get('bbx_selected_service'), {
    id: 'service-val-pro',
    code: 'VAL_PRO',
    source: 'home-feed'
  });
  assert.equal(home.calls.at(-1).url, '/pages/service-detail/service-detail');
});

test('支付结果页不向顾客暴露测试状态切换器', () => {
  const result = loadPage('pages/payment-result/payment-result.js');
  const source = readSource('pages/payment-result/payment-result.js');

  assert.equal(result.page.data.tabs, undefined);
  assert.equal(result.page.onStateTap, undefined);
  assert.doesNotMatch(source, /BBX-DEMO-001/);
  assert.doesNotMatch(source, /支付成功/);
  assert.match(source, /订单已创建/);
});

test('关键页面保留防重叠布局约束', () => {
  const appStyles = readSource('app.wxss');
  const detailMarkup = readSource('pages/service-detail/service-detail.wxml');
  const careStyles = readSource('components/care-btn/care-btn.wxss');
  const categoryStyles = readSource('pages/categories/categories.wxss');
  const homeStyles = readSource('pages/home/home.wxss');
  const checkoutMarkup = readSource('pages/checkout/checkout.wxml');

  assert.match(detailMarkup, /class="sticky-action service-actions"/);
  assert.equal((detailMarkup.match(/hover-class="sticky-btn-hover"/g) || []).length, 2);
  assert.match(appStyles, /\.sticky-action\.service-actions\s*\{[^}]*grid-template-columns:/s);
  const pressedRule = appStyles.match(/\.sticky-btn-hover\s*\{[^}]*\}/s)[0];
  assert.doesNotMatch(pressedRule, /transform\s*:/);

  assert.doesNotMatch(careStyles, /position\s*:\s*fixed/);
  for (const page of ['home', 'categories', 'messages', 'profile']) {
    assert.match(readSource(`pages/${page}/${page}.wxml`), /<care-btn\s*\/>/);
  }

  assert.match(categoryStyles, /\.category-list \.service-card\s*\{[^}]*display:\s*flex/s);
  assert.match(categoryStyles, /flex-direction:\s*column/);
  assert.match(categoryStyles, /white-space:\s*normal/);

  assert.match(homeStyles, /\.reference-card\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(homeStyles, /\.reference-card\s*\{[^}]*grid-template-columns:/s);
  assert.match(homeStyles, /\.reference-cover\s*\{[^}]*flex:\s*0\s+0\s+164rpx/s);
  assert.match(homeStyles, /\.reference-cover\s*\{[^}]*width:\s*164rpx/s);
  assert.match(homeStyles, /\.reference-cover\s*\{[^}]*height:\s*164rpx/s);
  assert.match(homeStyles, /\.reference-copy\s*\{[^}]*flex:\s*1/s);
  assert.match(homeStyles, /\.reference-code\s*\{[^}]*word-break:\s*break-all/s);
  assert.doesNotMatch(homeStyles, /\.reference-cover\s+text\s*\{/);

  assert.match(checkoutMarkup, /class="page has-sticky"/);
  assert.match(appStyles, /\.page\.has-sticky\s*\{[^}]*padding-bottom:\s*calc\(188rpx/s);
});
