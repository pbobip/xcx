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
  const detail = loadPage('pages/service-detail/service-detail.js');

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

test('云端登录顾客选择套餐后可以继续打开确认订单', () => {
  const seed = {
    bbx_current_user: {
      id: 'users-test',
      platformUserNo: 'BBX-TEST',
      nickname: '微信用户',
      avatarFileId: null
    }
  };
  const detail = loadPage('pages/service-detail/service-detail.js', seed);

  detail.page.onChoosePlan();

  assert.equal(detail.calls.at(-1).url, '/pages/checkout/checkout');

  const checkout = loadPage('pages/checkout/checkout.js', seed);
  checkout.page.onLoad();

  assert.equal(
    checkout.calls.some((call) => call.url === '/pages/login/login'),
    false
  );
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

test('我的订单快捷入口会把所选状态带到订单页', () => {
  const profile = loadPage('pages/profile/profile.js');
  profile.page.goOrders({ currentTarget: { dataset: { status: '进行中' } } });

  assert.equal(profile.storage.get('bbx_pending_tab_state'), '进行中');
  assert.equal(profile.calls.at(-1).url, '/pages/orders/orders');

  const orders = loadPage('pages/orders/orders.js', {
    bbx_pending_tab_state: profile.storage.get('bbx_pending_tab_state')
  });
  assert.equal(typeof orders.page.onShow, 'function');
  orders.page.onShow();

  assert.equal(orders.page.data.activeTab, '进行中');
  assert.equal(orders.storage.has('bbx_pending_tab_state'), false);
});

test('订单列表中的演示订单具有不同订单号和服务信息', () => {
  const orders = loadPage('pages/orders/orders.js');
  const orderNumbers = orders.page.data.orders.map((order) => order.orderNo);
  const titles = orders.page.data.orders.map((order) => order.title);

  assert.equal(new Set(orderNumbers).size, orderNumbers.length);
  assert.equal(new Set(titles).size, titles.length);
});

test('点击订单后，详情页读取对应订单而不是固定演示订单', () => {
  const orders = loadPage('pages/orders/orders.js');

  orders.page.goOrderDetail({ currentTarget: { dataset: { index: 1 } } });

  const selected = orders.storage.get('bbx_selected_order');
  assert.equal(selected.orderNo, 'BBX-20260726-002');

  const detail = loadPage('pages/order-detail/order-detail.js', {
    bbx_selected_order: selected
  });
  detail.page.onLoad();

  assert.equal(detail.page.data.order.orderNo, 'BBX-20260726-002');
  assert.equal(detail.page.data.order.title, '钻石段位娱乐陪');
  assert.equal(detail.page.data.progressIndex, 2);
});

test('首页推荐卡打开与卡片文案一致的技术陪套餐', () => {
  const home = loadPage('pages/home/home.js');

  home.page.onFeedTap({ currentTarget: { dataset: { index: 0 } } });

  assert.deepEqual(home.storage.get('bbx_selected_service'), {
    code: 'PRO',
    source: 'home-feed'
  });
  assert.equal(home.calls.at(-1).url, '/pages/service-detail/service-detail');
});

test('支付结果页不向顾客暴露测试状态切换器', () => {
  const result = loadPage('pages/payment-result/payment-result.js');

  assert.equal(result.page.data.tabs, undefined);
  assert.equal(result.page.onStateTap, undefined);
});

test('关键页面保留防重叠布局约束', () => {
  const appStyles = readSource('app.wxss');
  const detailMarkup = readSource('pages/service-detail/service-detail.wxml');
  const careStyles = readSource('components/care-btn/care-btn.wxss');
  const categoryStyles = readSource('pages/categories/categories.wxss');
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

  assert.match(checkoutMarkup, /class="page has-sticky"/);
  assert.match(appStyles, /\.page\.has-sticky\s*\{[^}]*padding-bottom:\s*calc\(188rpx/s);
});
