const {
  existingServiceIds,
  existingServiceCompliance,
  existingServiceSearchText,
  developmentBanner,
  legacyDevelopmentBannerIds,
  services,
  recommendationUpdates
} = require('./seed-data');

const CONFIRM_TOKEN = 'ISSUE_4_HOME_SEARCH_SEED';
const SEED_VERSION = 'issue-4-v1';

function failure(code, message) {
  return {
    success: false,
    error: { code, message }
  };
}

function createCatalogDevSeedHandler({ cloud, now = () => new Date(), logger = console }) {
  const db = cloud.database();

  return async function main(event = {}) {
    if (event.confirmToken !== CONFIRM_TOKEN) {
      return failure('CONFIRMATION_REQUIRED', '缺少开发种子确认口令');
    }

    const timestamp = now();
    try {
      await Promise.all(existingServiceIds.map((id) => (
        db.collection('services').doc(id).update({
          data: Object.assign({}, existingServiceCompliance, {
            searchText: existingServiceSearchText[id],
            stats: Object.assign({}, existingServiceCompliance.stats),
            seedVersion: SEED_VERSION,
            updatedAt: timestamp
          })
        })
      )));

      await Promise.all(services.map((item) => {
        const { _id, ...serviceData } = item;
        return db.collection('services').doc(_id).set({
          data: Object.assign({}, serviceData, {
            isTest: true,
            seedVersion: SEED_VERSION,
            createdAt: timestamp,
            updatedAt: timestamp
          })
        });
      }));

      await Promise.all(Object.entries(recommendationUpdates).map(([id, serviceIds]) => (
        db.collection('recommendations').doc(id).update({
          data: {
            serviceIds,
            updatedAt: timestamp
          }
        })
      )));

      await db.collection('banners').where({
        _id: db.command.in(legacyDevelopmentBannerIds)
      }).update({
        data: {
          status: 'INACTIVE',
          seedVersion: SEED_VERSION,
          updatedAt: timestamp
        }
      });

      const { _id: bannerId, ...bannerData } = developmentBanner;
      await db.collection('banners').doc(bannerId).set({
        data: Object.assign({}, bannerData, {
          isTest: true,
          seedVersion: SEED_VERSION,
          createdAt: timestamp,
          updatedAt: timestamp
        })
      });

      const gameCoverage = services.reduce((result, item) => {
        result[item.gameId] = (result[item.gameId] || 0) + 1;
        return result;
      }, { 'game-valorant': existingServiceIds.length });

      return {
        success: true,
        data: {
          serviceCount: existingServiceIds.length + services.length,
          newServiceCount: services.length,
          refreshedServiceCount: existingServiceIds.length,
          recommendationCount: Object.keys(recommendationUpdates).length,
          bannerCount: 1,
          gameCoverage
        }
      };
    } catch (error) {
      logger.error('catalog dev seed failed', {
        code: error && error.code ? error.code : 'UNKNOWN'
      });
      return failure('SEED_FAILED', '开发模拟数据初始化失败');
    }
  };
}

module.exports = { createCatalogDevSeedHandler };
