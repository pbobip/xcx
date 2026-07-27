const test = require('node:test');
const assert = require('node:assert/strict');

function createMemoryCloud() {
  const data = {
    services: [
      { _id: 'service-val-basic', isTest: false, purchaseNotice: '', stats: { orderCount: 9 } },
      { _id: 'service-val-fun', isTest: false, purchaseNotice: '', stats: { orderCount: 9 } },
      { _id: 'service-val-pro', isTest: false, purchaseNotice: '', stats: { orderCount: 9 } },
      { _id: 'service-val-sweet', isTest: false, purchaseNotice: '', stats: { orderCount: 9 } }
    ],
    recommendations: [
      { _id: 'recommendation-home-main', serviceIds: ['legacy-main'] },
      { _id: 'recommendation-home-latest', serviceIds: ['legacy-latest'] },
      { _id: 'recommendation-home-newcomer', serviceIds: [] }
    ],
    banners: [
      { _id: 'banner-dev-valorant', status: 'ACTIVE', isTest: true }
    ]
  };

  return {
    data,
    cloud: {
      database() {
        return {
          command: {
            in(values) {
              return { operator: 'in', values };
            }
          },
          collection(name) {
            return {
              where(query) {
                return {
                  async update({ data: update }) {
                    const ids = query._id.values;
                    let updated = 0;
                    data[name].forEach((item) => {
                      if (!ids.includes(item._id)) return;
                      Object.assign(item, update);
                      updated += 1;
                    });
                    return { stats: { updated } };
                  }
                };
              },
              doc(id) {
                return {
                  async set({ data: record }) {
                    if (Object.prototype.hasOwnProperty.call(record, '_id')) {
                      throw new Error('database document data cannot contain _id');
                    }
                    const index = data[name].findIndex((item) => item._id === id);
                    const next = Object.assign({ _id: id }, record);
                    if (index === -1) data[name].push(next);
                    else data[name][index] = next;
                    return { _id: id };
                  },
                  async update({ data: update }) {
                    const record = data[name].find((item) => item._id === id);
                    if (!record) throw new Error(`missing ${name}/${id}`);
                    Object.assign(record, update);
                    return { stats: { updated: 1 } };
                  }
                };
              }
            };
          }
        };
      }
    }
  };
}

test('全游戏开发种子覆盖六游戏与五类专区且不伪造经营数据', () => {
  const {
    existingServiceIds,
    services,
    recommendationUpdates
  } = require('../cloudfunctions/catalog-dev-seed/seed-data');
  const ids = services.map((item) => item._id);
  const codes = services.map((item) => item.code);
  const countByGame = services.reduce((result, item) => {
    result[item.gameId] = (result[item.gameId] || 0) + 1;
    return result;
  }, {});
  const categoryIds = new Set(services.flatMap((item) => item.categoryIds));

  assert.equal(services.length, 11);
  assert.deepEqual(existingServiceIds, [
    'service-val-basic',
    'service-val-fun',
    'service-val-pro',
    'service-val-sweet'
  ]);
  assert.equal(new Set(ids).size, services.length);
  assert.equal(new Set(codes).size, services.length);
  assert.deepEqual(countByGame, {
    'game-valorant': 1,
    'game-lol': 2,
    'game-naraka': 2,
    'game-delta-force': 2,
    'game-honor-of-kings': 2,
    'game-pubg': 2
  });
  for (const categoryId of [
    'category-newcomer',
    'category-companion',
    'category-escort',
    'category-coaching',
    'category-hot-activity'
  ]) {
    assert.equal(categoryIds.has(categoryId), true, categoryId);
  }
  for (const service of services) {
    assert.equal(service.status, 'ACTIVE');
    assert.match(service.purchaseNotice, /开发模拟数据/);
    assert.deepEqual(service.stats, {
      orderCount: 0,
      reviewCount: 0,
      overallScore: null,
      serviceScore: null,
      attitudeScore: null,
      communicationScore: null
    });
    assert.doesNotMatch(JSON.stringify(service.orderFields), /密码|验证码/);
    assert.notEqual(service.serviceTypeId, 'type-boosting');
  }
  assert.deepEqual(Object.keys(recommendationUpdates).sort(), [
    'recommendation-home-latest',
    'recommendation-home-main',
    'recommendation-home-newcomer'
  ]);
  const recommendationServiceIds = Object.values(recommendationUpdates).flat();
  assert.equal(
    new Set(recommendationServiceIds).size,
    recommendationServiceIds.length,
    '首页各推荐位之间不能重复套餐'
  );
});

test('开发种子必须使用确认口令且不会执行数据库写入', async () => {
  const { createCatalogDevSeedHandler } = require('../cloudfunctions/catalog-dev-seed/handler');
  const memory = createMemoryCloud();
  const main = createCatalogDevSeedHandler({ cloud: memory.cloud });

  const result = await main({ confirmToken: 'wrong-token' });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CONFIRMATION_REQUIRED');
  assert.equal(memory.data.services.length, 4);
  assert.equal(memory.data.services.every((item) => item.isTest === false), true);
  assert.deepEqual(memory.data.recommendations[0].serviceIds, ['legacy-main']);
});

test('重复执行开发种子只保留固定套餐并刷新三个首页推荐位', async () => {
  const { createCatalogDevSeedHandler } = require('../cloudfunctions/catalog-dev-seed/handler');
  const memory = createMemoryCloud();
  const timestamp = new Date('2026-07-27T08:00:00.000Z');
  const main = createCatalogDevSeedHandler({
    cloud: memory.cloud,
    now: () => timestamp
  });

  const first = await main({ confirmToken: 'ISSUE_4_HOME_SEARCH_SEED' });
  const second = await main({ confirmToken: 'ISSUE_4_HOME_SEARCH_SEED' });

  assert.equal(first.success, true);
  assert.deepEqual(first.data, {
    serviceCount: 15,
    newServiceCount: 11,
    refreshedServiceCount: 4,
    recommendationCount: 3,
    bannerCount: 1,
    gameCoverage: {
      'game-valorant': 5,
      'game-lol': 2,
      'game-naraka': 2,
      'game-delta-force': 2,
      'game-honor-of-kings': 2,
      'game-pubg': 2
    }
  });
  assert.deepEqual(second.data, first.data);
  assert.equal(memory.data.services.length, 15);
  assert.equal(new Set(memory.data.services.map((item) => item._id)).size, 15);
  assert.equal(memory.data.services.every((item) => item.isTest === true), true);
  assert.equal(memory.data.services.every((item) => item.seedVersion === 'issue-4-v1'), true);
  assert.equal(memory.data.services.every((item) => item.updatedAt === timestamp), true);
  assert.equal(memory.data.services.every((item) => /开发模拟数据/.test(item.purchaseNotice)), true);
  assert.equal(memory.data.services.every((item) => item.stats.orderCount === 0), true);
  assert.deepEqual(
    memory.data.recommendations.map((item) => item.serviceIds),
    [
      [
        'service-lol-coaching',
        'service-naraka-escort',
        'service-delta-coaching',
        'service-hok-coaching',
        'service-val-pro',
        'service-pubg-coaching'
      ],
      [
        'service-val-basic',
        'service-lol-companion',
        'service-naraka-companion',
        'service-delta-escort',
        'service-hok-companion',
        'service-pubg-companion'
      ],
      ['service-dev-newcomer']
    ]
  );
});

test('开发种子补全套餐搜索文本并只启用本期固定首页横幅', async () => {
  const { createCatalogDevSeedHandler } = require('../cloudfunctions/catalog-dev-seed/handler');
  const memory = createMemoryCloud();
  const main = createCatalogDevSeedHandler({
    cloud: memory.cloud,
    now: () => new Date('2026-07-27T08:00:00.000Z')
  });

  await main({ confirmToken: 'ISSUE_4_HOME_SEARCH_SEED' });
  await main({ confirmToken: 'ISSUE_4_HOME_SEARCH_SEED' });

  assert.equal(memory.data.services.length, 15);
  assert.equal(
    memory.data.services.every((item) => typeof item.searchText === 'string' && item.searchText.length > 0),
    true
  );
  assert.match(
    memory.data.services.find((item) => item._id === 'service-lol-companion').searchText,
    /英雄联盟.*陪玩专区/
  );
  assert.match(
    memory.data.services.find((item) => item._id === 'service-delta-escort').searchText,
    /三角洲行动.*护航专区.*热门活动/
  );
  const activeBanners = memory.data.banners.filter((item) => item.status === 'ACTIVE');
  assert.equal(activeBanners.length, 1);
  assert.deepEqual(
    {
      id: activeBanners[0]._id,
      targetType: activeBanners[0].targetType,
      targetId: activeBanners[0].targetId,
      status: activeBanners[0].status,
      isTest: activeBanners[0].isTest
    },
    {
      id: 'banner-home-valorant',
      targetType: 'CATEGORY',
      targetId: 'GAME_VALORANT',
      status: 'ACTIVE',
      isTest: true
    }
  );
  assert.equal(
    memory.data.banners.find((item) => item._id === 'banner-dev-valorant').status,
    'INACTIVE'
  );
});
