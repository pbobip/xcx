function publicGame(record) {
  return {
    id: record._id,
    code: record.code,
    name: record.name,
    productVersion: record.productVersion || '',
    platforms: record.platforms || [],
    coverFileId: record.coverFileId || null,
    description: record.description || ''
  };
}

function publicCategory(record) {
  return {
    id: record._id,
    code: record.code,
    name: record.name,
    kind: record.kind,
    gameId: record.gameId || null,
    serviceTypeId: record.serviceTypeId || null,
    iconFileId: record.iconFileId || null
  };
}

function publicServiceSummary(record) {
  return {
    id: record._id,
    code: record.code,
    name: record.name,
    gameId: record.gameId,
    serviceTypeId: record.serviceTypeId || null,
    categoryIds: record.categoryIds || [],
    subtitle: record.subtitle || '',
    mediaFileIds: record.mediaFileIds || [],
    unit: record.unit,
    unitLabel: record.unitLabel,
    priceCents: record.priceCents,
    originalPriceCents: record.originalPriceCents == null ? null : record.originalPriceCents,
    minQuantity: Number(record.minQuantity) || 1,
    maxQuantity: Number(record.maxQuantity) || 99,
    status: record.status,
    purchasable: record.status === 'ACTIVE'
  };
}

function publicServiceDetail(record) {
  return Object.assign(publicServiceSummary(record), {
    platforms: record.platforms || [],
    regions: (record.regions || []).filter((item) => item.status === 'ACTIVE'),
    orderFields: (record.orderFields || []).filter((item) => item.customerVisible !== false),
    fulfillmentStandard: record.fulfillmentStandard || '',
    purchaseNotice: record.purchaseNotice || '',
    descriptionBlocks: record.descriptionBlocks || [],
    stats: Object.assign(
      { orderCount: 0, reviewCount: 0, overallScore: null },
      record.stats || {}
    )
  });
}

function publicBanner(record) {
  return {
    id: record._id,
    title: record.title,
    subtitle: record.subtitle || '',
    imageFileId: record.imageFileId || null,
    targetType: record.targetType || null,
    targetId: record.targetId || null
  };
}

function decodeOffset(cursor) {
  if (!cursor) return 0;
  const value = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
  return Number.isInteger(value.offset) && value.offset >= 0 ? value.offset : 0;
}

function encodeOffset(offset) {
  return Buffer.from(JSON.stringify({ offset })).toString('base64');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createCatalogHandler({ cloud, now = () => new Date() }) {
  const db = cloud.database();

  return async function main(event = {}) {
    const payload = event.payload || {};
    if (event.action === 'game.list') {
      const result = await db
        .collection('games')
        .where({ status: 'ACTIVE' })
        .orderBy('sort', 'asc')
        .get();

      return {
        success: true,
        data: { games: result.data.map(publicGame) },
        requestId: event.requestId || ''
      };
    }

    if (event.action === 'category.list') {
      const query = { status: 'ACTIVE' };
      if (payload.gameId) query.gameId = payload.gameId;
      if (payload.serviceTypeId) query.serviceTypeId = payload.serviceTypeId;
      if (payload.kind) query.kind = payload.kind;
      const result = await db
        .collection('categories')
        .where(query)
        .orderBy('sort', 'asc')
        .get();

      return {
        success: true,
        data: { categories: result.data.map(publicCategory) },
        requestId: event.requestId || ''
      };
    }

    if (event.action === 'service.list') {
      const limit = Math.min(50, Math.max(1, Number(payload.limit) || 20));
      const offset = decodeOffset(payload.cursor);
      const query = { status: db.command.in(['ACTIVE', 'PAUSED']) };
      if (payload.gameId) query.gameId = payload.gameId;
      if (payload.categoryId) query.categoryIds = payload.categoryId;
      if (payload.serviceTypeId) query.serviceTypeId = payload.serviceTypeId;
      const result = await db
        .collection('services')
        .where(query)
        .orderBy('sort', 'asc')
        .orderBy('_id', 'asc')
        .skip(offset)
        .limit(limit + 1)
        .get();
      const hasMore = result.data.length > limit;
      const page = result.data.slice(0, limit);

      return {
        success: true,
        data: {
          services: page.map(publicServiceSummary),
          nextCursor: hasMore ? encodeOffset(offset + page.length) : null
        },
        requestId: event.requestId || ''
      };
    }

    if (event.action === 'service.detail') {
      if (!payload.serviceId && !payload.code) {
        return {
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: '缺少服务套餐标识', details: {} },
          requestId: event.requestId || ''
        };
      }
      const query = {
        status: db.command.in(['ACTIVE', 'PAUSED'])
      };
      if (payload.serviceId) query._id = payload.serviceId;
      else query.code = String(payload.code).toUpperCase();
      const result = await db.collection('services').where(query).limit(1).get();
      const record = result.data[0];
      if (!record) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: '服务套餐不存在或已下架', details: {} },
          requestId: event.requestId || ''
        };
      }

      return {
        success: true,
        data: { service: publicServiceDetail(record) },
        requestId: event.requestId || ''
      };
    }

    if (event.action === 'search') {
      const keyword = String(payload.keyword || '').trim();
      const limit = Math.min(50, Math.max(1, Number(payload.limit) || 20));
      const offset = decodeOffset(payload.cursor);
      const conditions = [
        { status: db.command.in(['ACTIVE', 'PAUSED']) }
      ];
      if (payload.gameId) conditions.push({ gameId: payload.gameId });
      if (payload.categoryId) conditions.push({ categoryIds: payload.categoryId });
      if (keyword) {
        const expression = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' });
        conditions.push(db.command.or([
          { name: expression },
          { subtitle: expression },
          { searchKeywords: expression }
        ]));
      }
      const result = await db
        .collection('services')
        .where(db.command.and(conditions))
        .orderBy('sort', 'asc')
        .orderBy('_id', 'asc')
        .skip(offset)
        .limit(limit + 1)
        .get();
      const hasMore = result.data.length > limit;
      const page = result.data.slice(0, limit);

      return {
        success: true,
        data: {
          services: page.map(publicServiceSummary),
          nextCursor: hasMore ? encodeOffset(offset + page.length) : null
        },
        requestId: event.requestId || ''
      };
    }

    if (event.action === 'home') {
      const limit = Math.min(50, Math.max(1, Number(payload.limit) || 20));
      const timestamp = now();
      const [bannerResult, recommendationResult, latestResult, serviceResult] = await Promise.all([
        db.collection('banners').where({ status: 'ACTIVE' }).orderBy('sort', 'asc').limit(20).get(),
        db.collection('recommendations').where({ status: 'ACTIVE' }).orderBy('sort', 'asc').limit(10).get(),
        db.collection('services')
          .where({ status: db.command.in(['ACTIVE', 'PAUSED']), isLatest: true })
          .orderBy('sort', 'asc')
          .orderBy('_id', 'asc')
          .limit(10)
          .get(),
        db.collection('services')
          .where({ status: db.command.in(['ACTIVE', 'PAUSED']) })
          .orderBy('sort', 'asc')
          .orderBy('_id', 'asc')
          .limit(limit + 1)
          .get()
      ]);
      const activeRecommendations = recommendationResult.data.filter(
        (item) => (!item.startAt || item.startAt <= timestamp) && (!item.endAt || item.endAt >= timestamp)
      );
      const recommendedIds = Array.from(new Set(
        activeRecommendations.flatMap((item) => item.serviceIds || [])
      ));
      let recommendedServices = [];
      if (recommendedIds.length) {
        const recommendedResult = await db.collection('services')
          .where({
            _id: db.command.in(recommendedIds),
            status: db.command.in(['ACTIVE', 'PAUSED'])
          })
          .orderBy('sort', 'asc')
          .orderBy('_id', 'asc')
          .limit(50)
          .get();
        recommendedServices = recommendedResult.data;
      }
      const serviceById = new Map(recommendedServices.map((item) => [item._id, item]));
      const hasMore = serviceResult.data.length > limit;
      const page = serviceResult.data.slice(0, limit);

      return {
        success: true,
        data: {
          banners: bannerResult.data
            .filter((item) => (!item.startAt || item.startAt <= timestamp) && (!item.endAt || item.endAt >= timestamp))
            .map(publicBanner),
          latestServices: latestResult.data.map(publicServiceSummary),
          recommendations: activeRecommendations.map((item) => ({
            id: item._id,
            code: item.code,
            name: item.name,
            categoryId: item.categoryId || null,
            services: (item.serviceIds || [])
              .map((id) => serviceById.get(id))
              .filter(Boolean)
              .map(publicServiceSummary)
          })),
          services: page.map(publicServiceSummary),
          nextCursor: hasMore ? encodeOffset(page.length) : null
        },
        requestId: event.requestId || ''
      };
    }

    return {
      success: false,
      error: { code: 'INVALID_ARGUMENT', message: '不支持的目录动作', details: {} },
      requestId: event.requestId || ''
    };
  };
}

module.exports = { createCatalogHandler };
