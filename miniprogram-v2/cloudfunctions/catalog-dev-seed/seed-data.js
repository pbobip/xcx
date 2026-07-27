const ZERO_STATS = {
  orderCount: 0,
  reviewCount: 0,
  overallScore: null,
  serviceScore: null,
  attitudeScore: null,
  communicationScore: null
};

const DEVELOPMENT_NOTICE = '开发模拟数据，价格和规则仅用于界面与流程联调，不代表正式运营报价或承诺。';

const GAME_NAMES = {
  'game-valorant': '无畏契约',
  'game-lol': '英雄联盟',
  'game-naraka': '永劫无间',
  'game-delta-force': '三角洲行动',
  'game-honor-of-kings': '王者荣耀',
  'game-pubg': '绝地求生'
};

const SERVICE_TYPE_NAMES = {
  'type-companion': '陪玩',
  'type-escort': '护航',
  'type-coaching': '教学'
};

const CATEGORY_NAMES = {
  'category-newcomer': '新人体验',
  'category-game-valorant': '无畏契约专区',
  'category-game-lol': '英雄联盟专区',
  'category-game-naraka': '永劫无间专区',
  'category-game-delta-force': '三角洲行动专区',
  'category-game-hok': '王者荣耀专区',
  'category-game-pubg': '绝地求生专区',
  'category-companion': '陪玩专区',
  'category-escort': '护航专区',
  'category-coaching': '教学专区',
  'category-hot-activity': '热门活动'
};

function serviceSearchText({ code, name, subtitle, gameId, serviceTypeId, categoryIds }) {
  return [
    code,
    name,
    subtitle,
    GAME_NAMES[gameId],
    SERVICE_TYPE_NAMES[serviceTypeId],
    ...(categoryIds || []).map((id) => CATEGORY_NAMES[id])
  ].filter(Boolean).join(' ');
}

function orderFields(platforms, regions) {
  return [
    {
      key: 'platform',
      label: '游戏平台',
      type: 'SINGLE',
      required: true,
      options: platforms.map((value) => ({ value, label: value === 'PC' ? '电脑端' : '移动端' })),
      placeholder: '',
      validation: {},
      affectsPrice: false,
      customerVisible: true,
      sort: 10
    },
    {
      key: 'region',
      label: '游戏区服',
      type: 'SINGLE',
      required: true,
      options: regions.map((item) => ({ value: item.code, label: item.name })),
      placeholder: '',
      validation: {},
      affectsPrice: false,
      customerVisible: true,
      sort: 20
    },
    {
      key: 'gameId',
      label: '游戏文字 ID',
      type: 'TEXT',
      required: true,
      options: [],
      placeholder: '填写游戏昵称或文字 ID',
      validation: { minLength: 1, maxLength: 40, rejectSensitiveCredentials: true },
      affectsPrice: false,
      customerVisible: true,
      sort: 30
    },
    {
      key: 'serviceMode',
      label: '服务时间',
      type: 'SINGLE',
      required: true,
      options: [
        { value: 'IMMEDIATE', label: '立即服务' },
        { value: 'RESERVATION', label: '预约时间' }
      ],
      placeholder: '',
      validation: {},
      affectsPrice: false,
      customerVisible: true,
      sort: 40
    },
    {
      key: 'scheduledAt',
      label: '预约时间',
      type: 'DATETIME',
      required: false,
      options: [],
      placeholder: '选择预约时间',
      validation: { requiredWhen: { field: 'serviceMode', equals: 'RESERVATION' } },
      affectsPrice: false,
      customerVisible: true,
      sort: 50
    },
    {
      key: 'customerNote',
      label: '点单备注',
      type: 'TEXT',
      required: false,
      options: [],
      placeholder: '填写位置、偏好或称呼',
      validation: { maxLength: 200, rejectSensitiveCredentials: true },
      affectsPrice: false,
      customerVisible: true,
      sort: 60
    },
    {
      key: 'adultConfirmed',
      label: '成年确认',
      type: 'SINGLE',
      required: true,
      options: [{ value: 'CONFIRMED', label: '本人已成年' }],
      placeholder: '',
      validation: {},
      affectsPrice: false,
      customerVisible: true,
      sort: 70
    }
  ];
}

function createServiceSeed({
  _id,
  code,
  name,
  gameId,
  serviceTypeId,
  categoryIds,
  subtitle,
  unit,
  unitLabel,
  priceCents,
  platforms,
  regions,
  minQuantity = 1,
  maxQuantity = 8,
  isLatest = false,
  sort
}) {
  return {
    _id,
    code,
    name,
    gameId,
    serviceTypeId,
    categoryIds,
    subtitle,
    mediaFileIds: [],
    unit,
    unitLabel,
    priceCents,
    originalPriceCents: null,
    minQuantity,
    maxQuantity,
    platforms,
    regions,
    orderFields: orderFields(platforms, regions),
    fulfillmentStandard: '由平台人工派单，按开发模拟订单约定的数量、时间和服务说明完成。',
    purchaseNotice: DEVELOPMENT_NOTICE,
    descriptionBlocks: [
      {
        type: 'TEXT',
        title: '开发模拟说明',
        content: '正式上线前将由运营人员替换价格、区服、素材和履约标准。'
      }
    ],
    searchKeywords: [name, subtitle],
    searchText: serviceSearchText({
      code,
      name,
      subtitle,
      gameId,
      serviceTypeId,
      categoryIds
    }),
    status: 'ACTIVE',
    isLatest,
    sort,
    stats: Object.assign({}, ZERO_STATS)
  };
}

const services = [
  createServiceSeed({
    _id: 'service-dev-newcomer',
    code: 'DEV_NEWCOMER_TRIAL',
    name: '新人体验陪玩',
    gameId: 'game-valorant',
    serviceTypeId: 'type-companion',
    categoryIds: ['category-newcomer', 'category-game-valorant', 'category-companion'],
    subtitle: '开发体验套餐｜按局计价',
    unit: 'ROUND',
    unitLabel: '局',
    priceCents: 900,
    platforms: ['PC'],
    regions: [{ code: 'VAL_CN', name: '无畏契约国服', status: 'ACTIVE' }],
    maxQuantity: 10,
    sort: 100
  }),
  createServiceSeed({
    _id: 'service-lol-companion',
    code: 'LOL_COMPANION_HOUR',
    name: '英雄联盟双排陪玩',
    gameId: 'game-lol',
    serviceTypeId: 'type-companion',
    categoryIds: ['category-game-lol', 'category-companion'],
    subtitle: '双排组队开发演示｜按小时计价',
    unit: 'HOUR',
    unitLabel: '小时',
    priceCents: 3900,
    platforms: ['PC'],
    regions: [{ code: 'LOL_CN', name: '英雄联盟国服', status: 'ACTIVE' }],
    isLatest: true,
    sort: 110
  }),
  createServiceSeed({
    _id: 'service-lol-coaching',
    code: 'LOL_COACHING_HOUR',
    name: '英雄联盟基础教学',
    gameId: 'game-lol',
    serviceTypeId: 'type-coaching',
    categoryIds: ['category-game-lol', 'category-coaching'],
    subtitle: '基础意识与对线复盘开发演示',
    unit: 'HOUR',
    unitLabel: '小时',
    priceCents: 6900,
    platforms: ['PC'],
    regions: [{ code: 'LOL_CN', name: '英雄联盟国服', status: 'ACTIVE' }],
    sort: 120
  }),
  createServiceSeed({
    _id: 'service-naraka-companion',
    code: 'NARAKA_COMPANION_HOUR',
    name: '永劫无间组队陪玩',
    gameId: 'game-naraka',
    serviceTypeId: 'type-companion',
    categoryIds: ['category-game-naraka', 'category-companion'],
    subtitle: '组队娱乐开发演示｜按小时计价',
    unit: 'HOUR',
    unitLabel: '小时',
    priceCents: 4500,
    platforms: ['PC'],
    regions: [{ code: 'NARAKA_CN', name: '永劫无间国服', status: 'ACTIVE' }],
    isLatest: true,
    sort: 130
  }),
  createServiceSeed({
    _id: 'service-naraka-escort',
    code: 'NARAKA_ESCORT_TASK',
    name: '永劫无间任务护航',
    gameId: 'game-naraka',
    serviceTypeId: 'type-escort',
    categoryIds: ['category-game-naraka', 'category-escort'],
    subtitle: '指定任务范围开发演示｜按任务计价',
    unit: 'TASK',
    unitLabel: '任务',
    priceCents: 5900,
    platforms: ['PC'],
    regions: [{ code: 'NARAKA_CN', name: '永劫无间国服', status: 'ACTIVE' }],
    maxQuantity: 5,
    sort: 140
  }),
  createServiceSeed({
    _id: 'service-delta-escort',
    code: 'DELTA_ESCORT_TASK',
    name: '三角洲行动任务护航',
    gameId: 'game-delta-force',
    serviceTypeId: 'type-escort',
    categoryIds: ['category-game-delta-force', 'category-escort', 'category-hot-activity'],
    subtitle: '周末热门活动开发演示｜按任务计价',
    unit: 'TASK',
    unitLabel: '任务',
    priceCents: 6800,
    platforms: ['PC'],
    regions: [{ code: 'DELTA_PC_CN', name: 'PC 开发测试区服', status: 'ACTIVE' }],
    maxQuantity: 5,
    isLatest: true,
    sort: 150
  }),
  createServiceSeed({
    _id: 'service-delta-coaching',
    code: 'DELTA_COACHING_HOUR',
    name: '三角洲行动战术教学',
    gameId: 'game-delta-force',
    serviceTypeId: 'type-coaching',
    categoryIds: ['category-game-delta-force', 'category-coaching'],
    subtitle: '基础路线与协作教学开发演示',
    unit: 'HOUR',
    unitLabel: '小时',
    priceCents: 5900,
    platforms: ['PC'],
    regions: [{ code: 'DELTA_PC_CN', name: 'PC 开发测试区服', status: 'ACTIVE' }],
    sort: 160
  }),
  createServiceSeed({
    _id: 'service-hok-companion',
    code: 'HOK_COMPANION_ROUND',
    name: '王者荣耀娱乐陪玩',
    gameId: 'game-honor-of-kings',
    serviceTypeId: 'type-companion',
    categoryIds: ['category-game-hok', 'category-companion'],
    subtitle: '移动端组队开发演示｜按局计价',
    unit: 'ROUND',
    unitLabel: '局',
    priceCents: 1900,
    platforms: ['MOBILE'],
    regions: [
      { code: 'HOK_QQ', name: 'QQ 区开发演示', status: 'ACTIVE' },
      { code: 'HOK_WECHAT', name: '微信区开发演示', status: 'ACTIVE' }
    ],
    maxQuantity: 20,
    isLatest: true,
    sort: 170
  }),
  createServiceSeed({
    _id: 'service-hok-coaching',
    code: 'HOK_COACHING_HOUR',
    name: '王者荣耀基础教学',
    gameId: 'game-honor-of-kings',
    serviceTypeId: 'type-coaching',
    categoryIds: ['category-game-hok', 'category-coaching'],
    subtitle: '英雄与基础意识教学开发演示',
    unit: 'HOUR',
    unitLabel: '小时',
    priceCents: 4900,
    platforms: ['MOBILE'],
    regions: [
      { code: 'HOK_QQ', name: 'QQ 区开发演示', status: 'ACTIVE' },
      { code: 'HOK_WECHAT', name: '微信区开发演示', status: 'ACTIVE' }
    ],
    sort: 180
  }),
  createServiceSeed({
    _id: 'service-pubg-companion',
    code: 'PUBG_COMPANION_HOUR',
    name: '绝地求生组队陪玩',
    gameId: 'game-pubg',
    serviceTypeId: 'type-companion',
    categoryIds: ['category-game-pubg', 'category-companion'],
    subtitle: '组队娱乐开发演示｜按小时计价',
    unit: 'HOUR',
    unitLabel: '小时',
    priceCents: 4500,
    platforms: ['PC'],
    regions: [{ code: 'PUBG_DEV', name: 'PC 版本开发演示', status: 'ACTIVE' }],
    isLatest: true,
    sort: 190
  }),
  createServiceSeed({
    _id: 'service-pubg-coaching',
    code: 'PUBG_COACHING_HOUR',
    name: '绝地求生战术教学',
    gameId: 'game-pubg',
    serviceTypeId: 'type-coaching',
    categoryIds: ['category-game-pubg', 'category-coaching'],
    subtitle: '基础战术与复盘教学开发演示',
    unit: 'HOUR',
    unitLabel: '小时',
    priceCents: 6500,
    platforms: ['PC'],
    regions: [{ code: 'PUBG_DEV', name: 'PC 版本开发演示', status: 'ACTIVE' }],
    sort: 200
  })
];

const existingServiceIds = [
  'service-val-basic',
  'service-val-fun',
  'service-val-pro',
  'service-val-sweet'
];

const existingServiceCompliance = {
  isTest: true,
  purchaseNotice: DEVELOPMENT_NOTICE,
  stats: Object.assign({}, ZERO_STATS)
};

const existingServiceSearchText = {
  'service-val-basic': 'VAL_BASIC 匹配 下三 黄金 无畏契约 陪玩 无畏契约专区 陪玩专区',
  'service-val-fun': 'VAL_FUN 钻石段位娱乐陪 无畏契约 陪玩 无畏契约专区 陪玩专区',
  'service-val-pro': 'VAL_PRO 钻石段位技术陪 无畏契约 陪玩 无畏契约专区 陪玩专区',
  'service-val-sweet': 'VAL_SWEET 甜蜜单陪玩 无畏契约 陪玩 无畏契约专区 陪玩专区'
};

const developmentBanner = {
  _id: 'banner-home-valorant',
  title: '爆爆熊电竞 · 无畏契约陪玩',
  subtitle: '陪玩、护航与教学开发模拟内容',
  imageFileId: null,
  targetType: 'CATEGORY',
  targetId: 'GAME_VALORANT',
  startAt: new Date('2026-01-01T00:00:00.000Z'),
  endAt: new Date('2099-12-31T23:59:59.999Z'),
  status: 'ACTIVE',
  sort: 10
};

const legacyDevelopmentBannerIds = ['banner-dev-valorant'];

const recommendationUpdates = {
  'recommendation-home-main': [
    'service-lol-coaching',
    'service-naraka-escort',
    'service-delta-coaching',
    'service-hok-coaching',
    'service-val-pro',
    'service-pubg-coaching'
  ],
  'recommendation-home-latest': [
    'service-val-basic',
    'service-lol-companion',
    'service-naraka-companion',
    'service-delta-escort',
    'service-hok-companion',
    'service-pubg-companion'
  ],
  'recommendation-home-newcomer': ['service-dev-newcomer']
};

module.exports = {
  existingServiceIds,
  existingServiceCompliance,
  existingServiceSearchText,
  developmentBanner,
  legacyDevelopmentBannerIds,
  services,
  recommendationUpdates
};
