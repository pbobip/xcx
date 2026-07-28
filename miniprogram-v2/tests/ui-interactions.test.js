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
    requestPayment(params) {
      calls.push({
        type: 'requestPayment',
        timeStamp: params.timeStamp,
        nonceStr: params.nonceStr,
        package: params.package,
        signType: params.signType,
        paySign: params.paySign
      });
      if (options.requestPayment) return options.requestPayment(params);
      if (params.success) params.success({ errMsg: 'requestPayment:ok' });
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
    showModal(params) {
      calls.push({ type: 'showModal', title: params.title });
      if (params.success) params.success({ confirm: true, cancel: false });
    },
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

test('顾客在我的优惠券页按状态查看云端券规则', async () => {
  const coupons = loadPage('pages/coupons/coupons.js', {
    bbx_current_user: {
      id: 'users-test',
      platformUserNo: 'BBX-TEST',
      nickname: '微信用户',
      avatarFileId: null
    }
  }, {
    cloudCall: async ({ data }) => {
      assert.equal(data.action, 'coupon.mine.list');
      assert.equal(data.payload.status, 'unused');
      return {
        result: {
          success: true,
          data: {
            coupons: [
              {
                id: 'coupon-newcomer',
                status: 'AVAILABLE',
                validFrom: '2026-07-01T00:00:00.000Z',
                validTo: '2026-08-31T23:59:59.000Z',
                template: {
                  id: 'template-newcomer',
                  code: 'NEWCOMER_10',
                  name: '新人立减 10 元',
                  type: 'FIXED',
                  discountCents: 1000,
                  thresholdCents: 0,
                  gameIds: [],
                  categoryIds: [],
                  serviceIds: []
                }
              },
              {
                id: 'coupon-future',
                status: 'AVAILABLE',
                available: false,
                unavailableReason: '优惠券尚未生效',
                validFrom: '2026-08-01T00:00:00.000Z',
                validTo: '2026-08-31T23:59:59.000Z',
                template: {
                  name: '八月活动券',
                  type: 'FIXED',
                  discountCents: 500,
                  thresholdCents: 0,
                  gameIds: [],
                  categoryIds: [],
                  serviceIds: []
                }
              }
            ],
            nextCursor: null
          }
        }
      };
    }
  });

  await coupons.page.onShow();

  assert.deepEqual(coupons.page.data.coupons[0], {
    id: 'coupon-newcomer',
    name: '新人立减 10 元',
    amountText: '¥10',
    thresholdText: '无门槛',
    scopeText: '全部服务套餐',
    validText: '2026-07-01 至 2026-08-31',
    statusText: '可使用'
  });
  assert.equal(coupons.page.data.coupons[1].statusText, '优惠券尚未生效');
  assert.match(readSource('pages/coupons/coupons.wxml'), /coupon\.amountText/);
});

test('顾客切换优惠券标签失败时不会看到上一标签数据并可重新加载', async () => {
  let usedAttempts = 0;
  const coupons = loadPage('pages/coupons/coupons.js', {
    bbx_current_user: {
      id: 'users-test',
      platformUserNo: 'BBX-TEST',
      nickname: '微信用户',
      avatarFileId: null
    }
  }, {
    cloudCall: async ({ data }) => {
      const status = data.payload.status;
      if (status === 'used' && usedAttempts++ === 0) {
        return {
          result: {
            success: false,
            error: { code: 'INTERNAL_ERROR', message: '网络繁忙，请稍后重试' }
          }
        };
      }
      const records = {
        unused: [{
          id: 'coupon-unused', status: 'AVAILABLE',
          validFrom: '2026-07-01T00:00:00.000Z',
          validTo: '2026-08-31T23:59:59.000Z',
          template: {
            name: '未使用券', type: 'FIXED', discountCents: 500,
            thresholdCents: 0, gameIds: [], categoryIds: [], serviceIds: []
          }
        }],
        used: [{
          id: 'coupon-used', status: 'USED',
          validFrom: '2026-06-01T00:00:00.000Z',
          validTo: '2026-07-31T23:59:59.000Z',
          template: {
            name: '已使用券', type: 'THRESHOLD', discountCents: 1000,
            thresholdCents: 5000, gameIds: [], categoryIds: [], serviceIds: []
          }
        }]
      };
      return {
        result: {
          success: true,
          data: { coupons: records[status] || [], nextCursor: null }
        }
      };
    }
  });

  await coupons.page.onShow();
  assert.equal(coupons.page.data.coupons[0].id, 'coupon-unused');

  await coupons.page.onTabTap({ currentTarget: { dataset: { index: 1 } } });

  assert.equal(coupons.page.data.activeTab, 1);
  assert.deepEqual(coupons.page.data.coupons, []);
  assert.match(coupons.page.data.error, /网络繁忙/);

  await coupons.page.retry();

  assert.equal(coupons.page.data.error, '');
  assert.equal(coupons.page.data.coupons[0].id, 'coupon-used');
  assert.equal(coupons.page.data.coupons[0].statusText, '已使用');
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

test('顾客订单详情加载失败后可从错误状态重试并恢复快照', async () => {
  let attempts = 0;
  const detail = loadPage('pages/order-detail/order-detail.js', {
    bbx_current_user: {
      id: 'users-test',
      platformUserNo: 'BBX-TEST',
      nickname: '微信用户',
      avatarFileId: null
    }
  }, {
    cloudCall: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network unavailable');
      return {
        result: {
          success: true,
          data: {
            order: {
              id: 'order-1',
              orderNo: 'BBX-TEST-001',
              paymentStatus: 'UNPAID',
              fulfillmentStatus: 'NOT_STARTED',
              afterSalesStatus: 'NONE',
              version: 1,
              snapshot: {
                service: { code: 'VAL_PRO', name: '钻石段位技术陪', unitLabel: '局' },
                pricing: { quantity: 1, payableAmountCents: 3500 },
                orderValues: { platform: 'PC', region: '国服' },
                fulfillmentStandard: '按订单约定完成服务'
              }
            },
            timeline: []
          }
        }
      };
    }
  });

  detail.page.onLoad({ orderNo: 'BBX-TEST-001' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(detail.page.data.error, /网络异常/);
  assert.match(readSource('pages/order-detail/order-detail.wxml'), /bindtap="retry"/);

  await detail.page.retry();

  assert.equal(detail.page.data.error, '');
  assert.equal(detail.page.data.title, '钻石段位技术陪');
});

test('顾客可在订单详情看到云端返回的操作记录消息', async () => {
  const detail = loadPage('pages/order-detail/order-detail.js', {
    bbx_current_user: {
      id: 'users-test',
      platformUserNo: 'BBX-TEST',
      nickname: '微信用户',
      avatarFileId: null
    }
  }, {
    cloudResponse: {
      result: {
        success: true,
        data: {
          order: {
            id: 'order-1',
            orderNo: 'BBX-TEST-001',
            paymentStatus: 'UNPAID',
            fulfillmentStatus: 'NOT_STARTED',
            afterSalesStatus: 'NONE',
            version: 1,
            snapshot: {
              service: { name: '匹配 / 下三 / 黄金', unitLabel: '局' },
              pricing: { quantity: 2, payableAmountCents: 2000 }
            }
          },
          timeline: [{
            action: 'CREATE',
            message: '服务订单已创建，等待付款',
            createdAt: '2026-07-27T18:27:34.098Z'
          }]
        }
      }
    }
  });

  await detail.page.onLoad({ orderNo: 'BBX-TEST-001' });

  assert.deepEqual(detail.page.data.timeline, [{
    customerMessage: '服务订单已创建，等待付款',
    createdAt: '2026-07-27T18:27:34.098Z'
  }]);
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

test('支付结果页不向顾客暴露测试状态切换器且只按云端查单显示结果', () => {
  const result = loadPage('pages/payment-result/payment-result.js');
  const source = readSource('pages/payment-result/payment-result.js');

  assert.equal(result.page.data.tabs, undefined);
  assert.equal(result.page.onStateTap, undefined);
  assert.doesNotMatch(source, /BBX-DEMO-001/);
  assert.match(source, /payment\.call\('query'/);
  assert.match(source, /result\.order\.paymentStatus === 'PAID'/);
  assert.match(source, /服务订单已创建/);
});

test('支付结果页查看订单时携带新建服务订单 ID', () => {
  const result = loadPage('pages/payment-result/payment-result.js', {
    bbx_current_user: { id: 'users-test' },
    bbx_last_order: {
      id: 'orders-1',
      orderNo: 'BBX-20260728-000001',
      title: '钻石段位技术陪',
      qty: 1,
      unit: '局',
      total: 25
    }
  });

  result.page.onShow();
  result.page.onViewOrder();

  assert.deepEqual(result.calls.at(-1), {
    type: 'navigateTo',
    url: '/pages/order-detail/order-detail?orderId=orders-1'
  });
});

test('支付结果页调起微信支付后只使用云端查单结果显示支付成功', async () => {
  const result = loadPage('pages/payment-result/payment-result.js', {
    bbx_current_user: { id: 'users-test' },
    bbx_last_order: {
      id: 'orders-1',
      orderNo: 'BBX-20260728-000001',
      title: '钻石段位技术陪',
      qty: 1,
      unit: '局',
      total: 25,
      paymentStatus: 'UNPAID'
    }
  }, {
    cloudCall({ name, data }) {
      assert.equal(name, 'payment');
      if (data.action === 'prepay.create') {
        return Promise.resolve({ result: {
          success: true,
          data: {
            payment: { status: 'PREPAY' },
            paymentParams: {
              timeStamp: '1785254400', nonceStr: 'nonce-001',
              package: 'prepay_id=wx-prepay-001', signType: 'RSA', paySign: 'signed-params'
            }
          }
        } });
      }
      assert.equal(data.action, 'query');
      return Promise.resolve({ result: {
        success: true,
        data: {
          payment: { status: 'SUCCESS' },
          order: {
            id: 'orders-1', orderNo: 'BBX-20260728-000001',
            paymentStatus: 'PAID', fulfillmentStatus: 'PENDING_ASSIGNMENT',
            paidAmountCents: 2500
          }
        }
      } });
    }
  });

  result.page.onShow();
  await result.page.onPay();

  assert.equal(result.page.data.title, '支付成功');
  assert.equal(result.page.data.paymentState, 'PAID');
  assert.equal(result.storage.get('bbx_last_order').paymentStatus, 'PAID');
  assert.equal(result.calls.some((call) => call.type === 'requestPayment'), true);
  assert.deepEqual(
    result.calls.filter((call) => call.type === 'callFunction').map((call) => call.data.action),
    ['prepay.create', 'query']
  );
});

test('订单详情取消已有预支付的服务订单时转由支付模块安全关单', async () => {
  const result = loadPage('pages/order-detail/order-detail.js', {
    bbx_current_user: { id: 'users-test' }
  }, {
    cloudCall({ name, data }) {
      if (name === 'order' && data.action === 'cancel') {
        return Promise.resolve({ result: {
          success: false,
          error: { code: 'PAYMENT_CLOSE_REQUIRED', message: '请先关闭支付' }
        } });
      }
      assert.equal(name, 'payment');
      assert.equal(data.action, 'close');
      return Promise.resolve({ result: {
        success: true,
        data: { order: { id: 'orders-1', paymentStatus: 'CLOSED' } }
      } });
    }
  });
  result.page._orderId = 'orders-1';
  result.page._orderNo = 'BBX-20260728-000001';
  result.page._version = 1;
  result.page.loadOrder = () => {};

  result.page.cancelOrder();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    result.calls.filter((call) => call.type === 'callFunction').map((call) => [call.name, call.data.action]),
    [['order', 'cancel'], ['payment', 'close']]
  );
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
