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

function failure(code, message, requestId) {
  return {
    success: false,
    error: { code, message, details: {} },
    requestId: requestId || ''
  };
}

function decodeOffset(cursor) {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    return Number.isInteger(value.offset) && value.offset >= 0 ? value.offset : null;
  } catch (error) {
    return null;
  }
}

function encodeOffset(offset) {
  return Buffer.from(JSON.stringify({ offset })).toString('base64');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pageSettings(payload) {
  const offset = decodeOffset(payload.cursor);
  if (offset === null) return null;
  return {
    limit: Math.min(50, Math.max(1, Number(payload.limit) || 20)),
    offset
  };
}

function pageResult(records, settings) {
  const hasMore = records.length > settings.limit;
  const page = records.slice(0, settings.limit);
  return {
    page,
    nextCursor: hasMore ? encodeOffset(settings.offset + page.length) : null
  };
}

async function readServicePage(db, query, settings) {
  const result = await db
    .collection('services')
    .where(query)
    .orderBy('sort', 'asc')
    .orderBy('_id', 'asc')
    .skip(settings.offset)
    .limit(settings.limit + 1)
    .get();
  return pageResult(result.data, settings);
}

function publicServicePage(paged) {
  return {
    services: paged.page.map(publicServiceSummary),
    nextCursor: paged.nextCursor
  };
}

function createCatalogHandler({ cloud, now = () => new Date(), logger = console }) {
  const db = cloud.database();

  return async function main(event = {}) {
    const payload = event.payload || {};
    try {
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
      const settings = pageSettings(payload);
      if (!settings) return failure('INVALID_ARGUMENT', '分页游标无效', event.requestId);
      const allowedStatuses = ['ACTIVE', 'PAUSED'];
      if (payload.status && !allowedStatuses.includes(payload.status)) {
        return failure('INVALID_ARGUMENT', '服务套餐状态过滤无效', event.requestId);
      }
      const query = {
        status: payload.status || db.command.in(allowedStatuses)
      };
      if (payload.gameId) query.gameId = payload.gameId;
      if (payload.categoryId) query.categoryIds = payload.categoryId;
      if (payload.serviceTypeId) query.serviceTypeId = payload.serviceTypeId;
      const paged = await readServicePage(db, query, settings);

      return {
        success: true,
        data: publicServicePage(paged),
        requestId: event.requestId || ''
      };
    }

    if (event.action === 'service.detail') {
      if (!payload.serviceId && !payload.code) {
        return failure('INVALID_ARGUMENT', '缺少服务套餐标识', event.requestId);
      }
      const query = {
        status: db.command.in(['ACTIVE', 'PAUSED'])
      };
      if (payload.serviceId) query._id = payload.serviceId;
      else query.code = String(payload.code).toUpperCase();
      const result = await db.collection('services').where(query).limit(1).get();
      const record = result.data[0];
      if (!record) {
        return failure('NOT_FOUND', '服务套餐不存在或已下架', event.requestId);
      }

      return {
        success: true,
        data: { service: publicServiceDetail(record) },
        requestId: event.requestId || ''
      };
    }

    if (event.action === 'search') {
      const keyword = String(payload.keyword || '').trim();
      const settings = pageSettings(payload);
      if (!settings) return failure('INVALID_ARGUMENT', '分页游标无效', event.requestId);
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
          { searchKeywords: expression },
          { searchText: expression }
        ]));
      }
      const paged = await readServicePage(db, db.command.and(conditions), settings);

      return {
        success: true,
        data: publicServicePage(paged),
        requestId: event.requestId || ''
      };
    }

    if (event.action === 'home') {
      const settings = pageSettings(payload);
      if (!settings) return failure('INVALID_ARGUMENT', '分页游标无效', event.requestId);
      const timestamp = now();
      const [bannerResult, recommendationResult, latestResult, paged] = await Promise.all([
        db.collection('banners').where({
          status: 'ACTIVE',
          startAt: db.command.lte(timestamp),
          endAt: db.command.gte(timestamp)
        }).orderBy('sort', 'asc').limit(20).get(),
        db.collection('recommendations').where({
          status: 'ACTIVE',
          startAt: db.command.lte(timestamp),
          endAt: db.command.gte(timestamp)
        }).orderBy('sort', 'asc').limit(10).get(),
        db.collection('services')
          .where({ status: db.command.in(['ACTIVE', 'PAUSED']), isLatest: true })
          .orderBy('sort', 'asc')
          .orderBy('_id', 'asc')
          .limit(10)
          .get(),
        readServicePage(
          db,
          { status: db.command.in(['ACTIVE', 'PAUSED']) },
          settings
        )
      ]);
      const recommendedIds = Array.from(new Set(
        recommendationResult.data.flatMap((item) => item.serviceIds || [])
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

      return {
        success: true,
        data: {
          banners: bannerResult.data.map(publicBanner),
          latestServices: latestResult.data.map(publicServiceSummary),
          recommendations: recommendationResult.data.map((item) => ({
            id: item._id,
            code: item.code,
            name: item.name,
            categoryId: item.categoryId || null,
            services: (item.serviceIds || [])
              .map((id) => serviceById.get(id))
              .filter(Boolean)
              .map(publicServiceSummary)
          })),
          services: paged.page.map(publicServiceSummary),
          nextCursor: paged.nextCursor
        },
        requestId: event.requestId || ''
      };
    }

    return failure('INVALID_ARGUMENT', '不支持的目录动作', event.requestId);
    } catch (error) {
      logger.error('catalog action failed', {
        action: event.action || '',
        requestId: event.requestId || '',
        code: error && error.code ? error.code : 'UNKNOWN'
      });
      return failure('INTERNAL_ERROR', '目录服务暂时不可用，请稍后重试', event.requestId);
    }
  };
}

module.exports = { createCatalogHandler };
