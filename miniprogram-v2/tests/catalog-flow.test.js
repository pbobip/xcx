const test = require('node:test');
const assert = require('node:assert/strict');

function createMemoryCloud(seed) {
  const data = Object.fromEntries(
    Object.entries(seed).map(([name, records]) => [
      name,
      records.map((record) => Object.assign({}, record))
    ])
  );

  function matches(record, query) {
    if (query && query.type === 'and') return query.conditions.every((item) => matches(record, item));
    if (query && query.type === 'or') return query.conditions.some((item) => matches(record, item));
    return Object.entries(query).every(([key, value]) => {
      if (value && value.type === 'in') return value.values.includes(record[key]);
      if (value && value.type === 'lte') return record[key] <= value.value;
      if (value && value.type === 'gte') return record[key] >= value.value;
      if (value && value.type === 'regex') {
        const values = Array.isArray(record[key]) ? record[key] : [record[key]];
        return values.some((item) => value.pattern.test(String(item || '')));
      }
      if (Array.isArray(record[key])) return record[key].includes(value);
      return record[key] === value;
    });
  }

  return {
    database() {
      return {
        command: {
          in(values) {
            return { type: 'in', values };
          },
          lte(value) {
            return { type: 'lte', value };
          },
          gte(value) {
            return { type: 'gte', value };
          },
          or(conditions) {
            return { type: 'or', conditions };
          },
          and(conditions) {
            return { type: 'and', conditions };
          }
        },
        RegExp({ regexp, options }) {
          return { type: 'regex', pattern: new RegExp(regexp, options) };
        },
        collection(name) {
          return {
            where(query) {
              let result = (data[name] || []).filter((record) => matches(record, query));
              const orderings = [];
              let offset = 0;
              let size = Infinity;
              return {
                orderBy(field, direction) {
                  orderings.push({ field, direction });
                  return this;
                },
                skip(count) {
                  offset = count;
                  return this;
                },
                limit(count) {
                  size = count;
                  return this;
                },
                async get() {
                  result.sort((left, right) => {
                    for (const { field, direction } of orderings) {
                      const leftValue = left[field];
                      const rightValue = right[field];
                      const compared = typeof leftValue === 'number' && typeof rightValue === 'number'
                        ? leftValue - rightValue
                        : String(leftValue).localeCompare(String(rightValue));
                      if (compared !== 0) return direction === 'desc' ? -compared : compared;
                    }
                    return 0;
                  });
                  return { data: result.slice(offset, offset + size) };
                }
              };
            }
          };
        }
      };
    }
  };
}

test('访客只看到按运营顺序启用的游戏', async () => {
  const { createCatalogHandler } = require('../cloudfunctions/catalog/handler');
  const cloud = createMemoryCloud({
    games: [
      { _id: 'game-valorant', code: 'VALORANT', name: '无畏契约', status: 'ACTIVE', sort: 60 },
      { _id: 'game-lol', code: 'LOL', name: '英雄联盟', status: 'ACTIVE', sort: 10 },
      { _id: 'game-hidden', code: 'HIDDEN', name: '未开放游戏', status: 'HIDDEN', sort: 5 }
    ]
  });
  const main = createCatalogHandler({ cloud });

  const result = await main({ action: 'game.list', payload: {} });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.games, [
    { id: 'game-lol', code: 'LOL', name: '英雄联盟', productVersion: '', platforms: [], coverFileId: null, description: '' },
    { id: 'game-valorant', code: 'VALORANT', name: '无畏契约', productVersion: '', platforms: [], coverFileId: null, description: '' }
  ]);
});

test('访客可按游戏读取启用的专区', async () => {
  const { createCatalogHandler } = require('../cloudfunctions/catalog/handler');
  const cloud = createMemoryCloud({
    categories: [
      { _id: 'category-valorant', code: 'GAME_VALORANT', name: '无畏契约专区', kind: 'GAME', gameId: 'game-valorant', status: 'ACTIVE', sort: 60 },
      { _id: 'category-lol', code: 'GAME_LOL', name: '英雄联盟专区', kind: 'GAME', gameId: 'game-lol', status: 'ACTIVE', sort: 10 },
      { _id: 'category-offline', code: 'OLD', name: '已停用专区', kind: 'GAME', gameId: 'game-valorant', status: 'OFFLINE', sort: 1 }
    ]
  });
  const main = createCatalogHandler({ cloud });

  const result = await main({
    action: 'category.list',
    payload: { gameId: 'game-valorant' }
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.categories, [
    {
      id: 'category-valorant',
      code: 'GAME_VALORANT',
      name: '无畏契约专区',
      kind: 'GAME',
      gameId: 'game-valorant',
      serviceTypeId: null,
      iconFileId: null
    }
  ]);
});

test('套餐列表隐藏下架内容并用游标分页返回暂停接单状态', async () => {
  const { createCatalogHandler } = require('../cloudfunctions/catalog/handler');
  const cloud = createMemoryCloud({
    services: [
      { _id: 'service-a', code: 'VAL_A', name: '基础陪玩', gameId: 'game-valorant', status: 'ACTIVE', sort: 10, priceCents: 1000, unit: 'ROUND', unitLabel: '局' },
      { _id: 'service-b', code: 'VAL_B', name: '暂停套餐', gameId: 'game-valorant', status: 'PAUSED', sort: 20, priceCents: 2000, unit: 'ROUND', unitLabel: '局' },
      { _id: 'service-c', code: 'VAL_C', name: '进阶陪玩', gameId: 'game-valorant', status: 'ACTIVE', sort: 30, priceCents: 3000, unit: 'HOUR', unitLabel: '小时' },
      { _id: 'service-offline', code: 'OLD', name: '已下架套餐', gameId: 'game-valorant', status: 'OFFLINE', sort: 1, priceCents: 1, unit: 'ROUND', unitLabel: '局' }
    ]
  });
  const main = createCatalogHandler({ cloud });

  const first = await main({
    action: 'service.list',
    payload: { gameId: 'game-valorant', limit: 2 }
  });
  const second = await main({
    action: 'service.list',
    payload: { gameId: 'game-valorant', limit: 2, cursor: first.data.nextCursor }
  });

  assert.deepEqual(first.data.services.map((item) => item.code), ['VAL_A', 'VAL_B']);
  assert.equal(first.data.services[0].purchasable, true);
  assert.equal(first.data.services[1].purchasable, false);
  assert.equal(typeof first.data.nextCursor, 'string');
  assert.deepEqual(second.data.services.map((item) => item.code), ['VAL_C']);
  assert.equal(second.data.nextCursor, null);
});

test('套餐详情允许查看暂停套餐但拒绝下架套餐', async () => {
  const { createCatalogHandler } = require('../cloudfunctions/catalog/handler');
  const cloud = createMemoryCloud({
    services: [
      {
        _id: 'service-paused',
        code: 'VAL_PAUSED',
        name: '暂停接单套餐',
        gameId: 'game-valorant',
        serviceTypeId: 'type-companion',
        categoryIds: ['category-valorant'],
        subtitle: '仍可查看详情',
        unit: 'ROUND',
        unitLabel: '局',
        priceCents: 2500,
        status: 'PAUSED',
        platforms: ['PC'],
        regions: [{ code: 'CN', name: '国服', status: 'ACTIVE' }],
        orderFields: [{ key: 'gameId', label: '游戏文字 ID', type: 'TEXT', required: true }],
        fulfillmentStandard: '按订单约定完成服务',
        purchaseNotice: '仅限成年人下单',
        descriptionBlocks: [{ type: 'TEXT', title: '服务说明', content: '开发测试内容' }],
        stats: { orderCount: 0, reviewCount: 0, overallScore: null },
        sort: 10
      },
      { _id: 'service-offline', code: 'VAL_OFFLINE', name: '下架套餐', gameId: 'game-valorant', unit: 'ROUND', unitLabel: '局', priceCents: 1, status: 'OFFLINE', sort: 20 }
    ]
  });
  const main = createCatalogHandler({ cloud });

  const paused = await main({
    action: 'service.detail',
    payload: { code: 'VAL_PAUSED' }
  });
  const offline = await main({
    action: 'service.detail',
    payload: { serviceId: 'service-offline' }
  });

  assert.equal(paused.success, true);
  assert.equal(paused.data.service.purchasable, false);
  assert.deepEqual(paused.data.service.platforms, ['PC']);
  assert.equal(paused.data.service.stats.orderCount, 0);
  assert.equal(offline.success, false);
  assert.equal(offline.error.code, 'NOT_FOUND');
});

test('搜索只返回可见套餐并支持分页', async () => {
  const { createCatalogHandler } = require('../cloudfunctions/catalog/handler');
  const cloud = createMemoryCloud({
    services: [
      { _id: 'service-fun', code: 'VAL_FUN', name: '钻石段位娱乐陪', subtitle: '轻松组队', searchKeywords: ['钻石', '娱乐陪'], gameId: 'game-valorant', status: 'ACTIVE', sort: 10, priceCents: 2500, unit: 'ROUND', unitLabel: '局' },
      { _id: 'service-pro', code: 'VAL_PRO', name: '钻石段位技术陪', subtitle: '技术提升', searchKeywords: ['钻石', '技术陪'], gameId: 'game-valorant', status: 'PAUSED', sort: 20, priceCents: 3500, unit: 'ROUND', unitLabel: '局' },
      { _id: 'service-offline', code: 'VAL_OLD', name: '钻石下架套餐', subtitle: '', searchKeywords: ['钻石'], gameId: 'game-valorant', status: 'OFFLINE', sort: 1, priceCents: 1, unit: 'ROUND', unitLabel: '局' },
      { _id: 'service-other', code: 'VAL_BASIC', name: '基础陪玩', subtitle: '', searchKeywords: ['黄金'], gameId: 'game-valorant', status: 'ACTIVE', sort: 30, priceCents: 1000, unit: 'ROUND', unitLabel: '局' }
    ]
  });
  const main = createCatalogHandler({ cloud });

  const first = await main({ action: 'search', payload: { keyword: '钻石', limit: 1 } });
  const second = await main({
    action: 'search',
    payload: { keyword: '钻石', limit: 1, cursor: first.data.nextCursor }
  });

  assert.deepEqual(first.data.services.map((item) => item.code), ['VAL_FUN']);
  assert.deepEqual(second.data.services.map((item) => item.code), ['VAL_PRO']);
  assert.equal(second.data.services[0].purchasable, false);
  assert.equal(second.data.nextCursor, null);
});

test('搜索覆盖服务标题、游戏、专区、服务类型和运营关键词', async () => {
  const { createCatalogHandler } = require('../cloudfunctions/catalog/handler');
  const cloud = createMemoryCloud({
    services: [
      {
        _id: 'service-lol-companion',
        code: 'LOL_COMPANION_HOUR',
        name: '双排组队',
        subtitle: '轻松沟通',
        searchKeywords: ['上分搭子'],
        searchText: '双排组队 轻松沟通 英雄联盟 陪玩专区 陪玩 上分搭子',
        gameId: 'game-lol',
        serviceTypeId: 'type-companion',
        categoryIds: ['category-game-lol', 'category-companion'],
        status: 'ACTIVE',
        sort: 10,
        priceCents: 3900,
        unit: 'HOUR',
        unitLabel: '小时'
      }
    ]
  });
  const main = createCatalogHandler({ cloud });

  const keywords = ['双排组队', '英雄联盟', '陪玩专区', '陪玩', '上分搭子'];
  for (const keyword of keywords) {
    const result = await main({ action: 'search', payload: { keyword } });
    assert.deepEqual(
      result.data.services.map((item) => item.code),
      ['LOL_COMPANION_HOUR'],
      `关键词 ${keyword} 应命中服务套餐`
    );
  }
});

test('首页只组合有效横幅、推荐位和可见套餐', async () => {
  const { createCatalogHandler } = require('../cloudfunctions/catalog/handler');
  const cloud = createMemoryCloud({
    banners: [
      { _id: 'banner-priority', title: '优先活动', subtitle: '优先展示', targetType: 'CATEGORY', targetId: 'category-game-valorant', status: 'ACTIVE', sort: 5, startAt: new Date('2026-07-01T00:00:00.000Z'), endAt: new Date('2026-08-01T00:00:00.000Z') },
      { _id: 'banner-current', title: '当前活动', subtitle: '开发测试', targetType: 'SERVICE', targetId: 'service-pro', status: 'ACTIVE', sort: 10, startAt: new Date('2026-07-01T00:00:00.000Z'), endAt: new Date('2026-08-01T00:00:00.000Z') },
      { _id: 'banner-expired', title: '过期活动', subtitle: '', targetType: 'NONE', targetId: null, status: 'ACTIVE', sort: 1, startAt: new Date('2026-06-01T00:00:00.000Z'), endAt: new Date('2026-06-30T00:00:00.000Z') },
      { _id: 'banner-disabled', title: '停用活动', subtitle: '', targetType: 'NONE', targetId: null, status: 'DISABLED', sort: 2, startAt: new Date('2026-07-01T00:00:00.000Z'), endAt: new Date('2026-08-01T00:00:00.000Z') }
    ],
    recommendations: [
      { _id: 'recommend-main', code: 'HOME_RECOMMENDED', name: '推荐', serviceIds: ['service-pro', 'service-offline'], categoryId: null, status: 'ACTIVE', sort: 10, startAt: new Date('2026-07-01T00:00:00.000Z'), endAt: new Date('2026-08-01T00:00:00.000Z') }
    ],
    services: [
      { _id: 'service-pro', code: 'VAL_PRO', name: '技术陪', subtitle: '钻石段位', gameId: 'game-valorant', status: 'ACTIVE', isLatest: true, sort: 10, priceCents: 3500, unit: 'ROUND', unitLabel: '局' },
      { _id: 'service-offline', code: 'VAL_OLD', name: '下架套餐', subtitle: '', gameId: 'game-valorant', status: 'OFFLINE', isLatest: true, sort: 1, priceCents: 1, unit: 'ROUND', unitLabel: '局' }
    ]
  });
  const main = createCatalogHandler({
    cloud,
    now: () => new Date('2026-07-27T00:00:00.000Z')
  });

  const result = await main({ action: 'home', payload: { limit: 10 } });

  assert.deepEqual(result.data.banners.map((item) => item.title), ['优先活动', '当前活动']);
  assert.deepEqual(result.data.latestServices.map((item) => item.code), ['VAL_PRO']);
  assert.deepEqual(
    result.data.recommendations[0].services.map((item) => item.code),
    ['VAL_PRO']
  );
  assert.deepEqual(result.data.services.map((item) => item.code), ['VAL_PRO']);
});

test('目录分页拒绝畸形游标且套餐列表支持可见状态过滤', async () => {
  const { createCatalogHandler } = require('../cloudfunctions/catalog/handler');
  const cloud = createMemoryCloud({
    services: [
      { _id: 'service-active', code: 'ACTIVE_ONE', name: '可购买套餐', gameId: 'game-1', status: 'ACTIVE', sort: 10, priceCents: 1000, unit: 'ROUND', unitLabel: '局' },
      { _id: 'service-paused', code: 'PAUSED_ONE', name: '暂停套餐', gameId: 'game-1', status: 'PAUSED', sort: 20, priceCents: 1000, unit: 'ROUND', unitLabel: '局' }
    ]
  });
  const main = createCatalogHandler({ cloud });

  const invalid = await main({ action: 'service.list', payload: { cursor: 'not-a-cursor' } });
  const paused = await main({ action: 'service.list', payload: { status: 'PAUSED' } });

  assert.equal(invalid.success, false);
  assert.equal(invalid.error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(paused.data.services.map((item) => item.code), ['PAUSED_ONE']);
});

test('首页服务列表消费返回的游标继续加载下一页', async () => {
  const { createCatalogHandler } = require('../cloudfunctions/catalog/handler');
  const now = new Date('2026-07-27T00:00:00.000Z');
  const cloud = createMemoryCloud({
    banners: [],
    recommendations: [],
    services: [
      { _id: 'service-a', code: 'A', name: '套餐 A', gameId: 'game-1', status: 'ACTIVE', isLatest: true, sort: 10, priceCents: 1000, unit: 'ROUND', unitLabel: '局' },
      { _id: 'service-b', code: 'B', name: '套餐 B', gameId: 'game-1', status: 'ACTIVE', isLatest: false, sort: 20, priceCents: 2000, unit: 'ROUND', unitLabel: '局' },
      { _id: 'service-c', code: 'C', name: '套餐 C', gameId: 'game-1', status: 'ACTIVE', isLatest: false, sort: 30, priceCents: 3000, unit: 'ROUND', unitLabel: '局' }
    ]
  });
  const main = createCatalogHandler({ cloud, now: () => now });

  const first = await main({ action: 'home', payload: { limit: 2 } });
  const second = await main({
    action: 'home',
    payload: { limit: 2, cursor: first.data.nextCursor }
  });

  assert.deepEqual(first.data.services.map((item) => item.code), ['A', 'B']);
  assert.deepEqual(second.data.services.map((item) => item.code), ['C']);
  assert.equal(second.data.nextCursor, null);
});

test('云数据库异常转换为统一内部错误且不泄露底层信息', async () => {
  const { createCatalogHandler } = require('../cloudfunctions/catalog/handler');
  const main = createCatalogHandler({
    cloud: {
      database() {
        return {
          collection() {
            throw new Error('database credential detail');
          }
        };
      }
    },
    logger: { error() {} }
  });

  const result = await main({ action: 'game.list', requestId: 'request-test' });

  assert.deepEqual(result, {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: '目录服务暂时不可用，请稍后重试',
      details: {}
    },
    requestId: 'request-test'
  });
});
