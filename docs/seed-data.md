# 开发测试数据方案

## 1. 原则

本文件定义后续初始化 CloudBase 开发环境的数据。它不是正式运营内容，正式价格、素材、协议和营业规则仍需云东确认。

- 公开目录种子数据可以展示，但开发阶段统一标记 `isTest = true`；
- 不伪造真实销量、评分、评价或支付流水；
- 未开放游戏只创建游戏和专区，不创建可购买套餐；
- 代打、余额和邀请开关默认关闭；
- 自动化订单使用独立测试顾客与 `TEST` 支付模式，不进入运营统计；
- 生产环境不得直接导入测试用户、测试订单、测试支付和测试评价。

## 2. 游戏 `games`

| 固定测试 ID | code | 名称 | 版本/平台 | 初始状态 | 排序 |
|---|---|---|---|---|---|
| `game-lol` | `LOL` | 英雄联盟 | PC 国服 | `ACTIVE` | 10 |
| `game-naraka` | `NARAKA` | 永劫无间 | PC 国服 | `ACTIVE` | 20 |
| `game-delta-force` | `DELTA_FORCE` | 三角洲行动 | PC/移动端待确认 | `ACTIVE` | 30 |
| `game-honor-of-kings` | `HONOR_OF_KINGS` | 王者荣耀 | 移动端 | `ACTIVE` | 40 |
| `game-pubg` | `PUBG` | 绝地求生 | PC 版本待确认 | `ACTIVE` | 50 |
| `game-valorant` | `VALORANT` | 无畏契约 | PC 国服 | `ACTIVE` | 60 |

六个游戏可出现在分类左栏，但只有无畏契约有首批可购买套餐。其他游戏显示“暂无开放套餐”，不显示虚构价格。

## 3. 服务类型 `service_types`

| 固定测试 ID | code | 名称 | 风险 | 初始状态 |
|---|---|---|---|---|
| `type-companion` | `COMPANION` | 陪玩 | 常规 | `ACTIVE` |
| `type-escort` | `ESCORT` | 护航 | 常规 | `ACTIVE` |
| `type-coaching` | `COACHING` | 教学 | 常规 | `ACTIVE` |
| `type-boosting` | `BOOSTING` | 代打 | 高风险 | `HIDDEN` |

## 4. 专区 `categories`

### 4.1 游戏专区

| code | 名称 | kind | 关联 | 状态 | 排序 |
|---|---|---|---|---|---|
| `GAME_LOL` | 英雄联盟专区 | `GAME` | `game-lol` | `ACTIVE` | 10 |
| `GAME_NARAKA` | 永劫无间专区 | `GAME` | `game-naraka` | `ACTIVE` | 20 |
| `GAME_DELTA_FORCE` | 三角洲行动专区 | `GAME` | `game-delta-force` | `ACTIVE` | 30 |
| `GAME_HOK` | 王者荣耀专区 | `GAME` | `game-honor-of-kings` | `ACTIVE` | 40 |
| `GAME_PUBG` | 绝地求生专区 | `GAME` | `game-pubg` | `ACTIVE` | 50 |
| `GAME_VALORANT` | 无畏契约专区 | `GAME` | `game-valorant` | `ACTIVE` | 60 |

### 4.2 服务与运营专区

| code | 名称 | kind | 关联 | 状态 | 排序 |
|---|---|---|---|---|---|
| `NEWCOMER` | 新人体验 | `OPERATION` | 无 | `ACTIVE` | 5 |
| `COMPANION` | 陪玩专区 | `SERVICE_TYPE` | `type-companion` | `ACTIVE` | 70 |
| `ESCORT` | 护航专区 | `SERVICE_TYPE` | `type-escort` | `ACTIVE` | 80 |
| `COACHING` | 教学专区 | `SERVICE_TYPE` | `type-coaching` | `ACTIVE` | 90 |
| `HOT_ACTIVITY` | 热门活动 | `OPERATION` | 无 | `ACTIVE` | 100 |

## 5. 无畏契约首批服务套餐 `services`

以下价格来自现有原型，仅用于开发联调；正式上线前必须由运营重新确认。

| 固定测试 ID | code | 名称 | 类型 | 单位 | 单价 | 原型说明 | 状态 |
|---|---|---|---|---|---:|---|---|
| `service-val-basic` | `VAL_BASIC` | 匹配 / 下三 / 黄金 | 陪玩 | 局 | 1000 分 | 可另按 20 元/小时咨询 | `ACTIVE` |
| `service-val-fun` | `VAL_FUN` | 钻石段位娱乐陪 | 陪玩 | 局 | 2500 分 | 轻松组队，以娱乐体验为主 | `ACTIVE` |
| `service-val-pro` | `VAL_PRO` | 钻石段位技术陪 | 陪玩 | 局 | 3500 分 | 技术 C：白金或人前五 | `ACTIVE` |
| `service-val-sweet` | `VAL_SWEET` | 甜蜜单陪玩 | 陪玩 | 小时 | 5200 分 | 可在备注中指定称呼 | `ACTIVE` |

公共字段：

- `gameId = game-valorant`；
- `serviceTypeId = type-companion`；
- `categoryIds` 至少包含 `GAME_VALORANT` 与 `COMPANION`；
- `platforms = ["PC"]`；
- `regions = [{ code: "CN", name: "无畏契约国服", status: "ACTIVE" }]`；
- `minQuantity = 1`，`maxQuantity = 99`；
- `stats = { orderCount: 0, reviewCount: 0, overallScore: null }`；
- `isTest = true`，正式确认并替换素材后才改为非测试运营数据。

### 5.1 动态下单字段

四个套餐初始共享：

| key | 名称 | 类型 | 必填 | 规则 |
|---|---|---|---|---|
| `platform` | 游戏平台 | `SINGLE` | 是 | 只能选择套餐支持的平台 |
| `region` | 游戏区服 | `SINGLE` | 是 | 只能选择启用区服 |
| `gameId` | 游戏文字 ID | `TEXT` | 是 | 1–40 字，不允许密码或验证码 |
| `serviceMode` | 服务时间 | `SINGLE` | 是 | `IMMEDIATE` 或 `RESERVATION` |
| `scheduledAt` | 预约时间 | `DATETIME` | 条件必填 | 预约模式必填；有效范围待确认 |
| `customerNote` | 点单备注 | `TEXT` | 否 | 最多 200 字，拦截敏感信息 |
| `adultConfirmed` | 成年确认 | `SINGLE` | 是 | 必须为确认状态 |

## 6. 首页种子配置

### 6.1 横幅 `banners`

开发阶段创建 1 条原创占位横幅：

| title | subtitle | targetType | targetId | 状态 |
|---|---|---|---|---|
| 爆爆熊电竞 · 无畏契约陪玩 | 娱乐陪、技术陪和甜蜜单 | `CATEGORY` | `GAME_VALORANT` | `ACTIVE` |

图片使用项目自有或原创占位素材，不能使用参考小程序素材。

### 6.2 推荐位 `recommendations`

| code | 名称 | 套餐顺序 | 状态 |
|---|---|---|---|
| `HOME_RECOMMENDED` | 推荐 | `VAL_PRO`、`VAL_FUN`、`VAL_SWEET` | `ACTIVE` |
| `HOME_LATEST` | 最新服务 | `VAL_BASIC`、`VAL_FUN`、`VAL_PRO` | `ACTIVE` |
| `HOME_NEWCOMER` | 新人体验 | 初始为空 | `ACTIVE` |

空推荐位不展示空白卡片。

## 7. 优惠券模板 `coupon_templates`

创建一张联调券但不自动发给真实顾客：

| code | 名称 | 类型 | 优惠 | 门槛 | 适用范围 | 状态 |
|---|---|---|---:|---:|---|---|
| `DEV_NEW_500` | 开发联调 5 元券 | `THRESHOLD` | 500 分 | 3000 分 | 无畏契约陪玩套餐 | `ACTIVE` |

模板标记 `isTest = true`。只有测试顾客通过开发种子流程获得，不能进入正式营销统计。

## 8. 协议与系统设置

### 8.1 协议 `agreements`

创建三个 `DRAFT` 占位版本：用户协议、隐私政策、服务规则。内容明确标注“开发占位，非正式法律文本”，不得在正式版本中错误发布为生效协议。

### 8.2 设置 `system_settings`

| key | 开发值 | 说明 |
|---|---|---|
| `brand.publicName` | 爆爆熊电竞 | 待品牌最终确认 |
| `feature.balance` | `false` | P1 关闭 |
| `feature.invite` | `false` | P1 关闭 |
| `feature.boosting.global` | `false` | 代打全局关闭 |
| `feature.subscriptionMessage` | `false` | P1 关闭 |
| `business.isOpen` | `true` | 开发环境允许浏览 |
| `business.assignmentPromiseMinutes` | `null` | 待运营确认，前端不得宣传固定时限 |
| `business.autoCompleteHours` | `null` | 待运营确认，未设置时不自动完成 |

## 9. 自动化测试夹具

以下数据只由测试建立和清理，必须 `isTest = true`，不得作为开发环境默认运营内容长期展示。

### 9.1 测试顾客

- 顾客 A：验证本人订单、优惠券、消息和投诉；
- 顾客 B：验证跨用户读取被拒绝；
- 禁用顾客：验证账号状态限制。

测试 `openid` 使用测试适配器提供，不能伪装成真实微信 `OPENID`。

### 9.2 测试服务订单

| 场景 | 支付状态 | 履约状态 | 售后状态 | 用途 |
|---|---|---|---|---|
| 未付款 | `UNPAID` | `PENDING_ASSIGNMENT` | `NONE` | 继续支付、取消、关单 |
| 已付款待派单 | `PAID` | `PENDING_ASSIGNMENT` | `NONE` | 派单队列 |
| 已派单待开始 | `PAID` | `WAITING_START` | `NONE` | 改派与开始 |
| 服务中 | `PAID` | `IN_SERVICE` | `NONE` | 进度与投诉 |
| 待确认 | `PAID` | `WAITING_CONFIRMATION` | `NONE` | 确认或异议 |
| 已完成 | `PAID` | `COMPLETED` | `NONE` | 评价资格 |
| 投诉中 | `PAID` | `IN_SERVICE` | `PROCESSING` | 暂停自动完成 |
| 部分退款 | `PARTIALLY_REFUNDED` | `COMPLETED` | `RESOLVED` | 金额与对账 |

测试付款记录使用 `paymentMode = TEST`，不得生成真实微信交易号，不得计入财务报表。

## 10. 初始化顺序

1. 创建集合与索引；
2. 应用“仅云函数可读写”的集合权限；
3. 导入角色、系统设置和协议草稿；
4. 导入游戏、服务类型和专区；
5. 导入无畏契约套餐；
6. 上传原创占位素材并回填云文件 ID；
7. 导入横幅、推荐位和测试优惠券模板；
8. 运行目录读取验收；
9. 按需创建自动化测试夹具并在测试后清理。

## 11. 种子数据验收

- 分类左栏按预期显示六个游戏；
- 只有无畏契约显示四个可购买测试套餐；
- 四个套餐价格分别显示 10 元/局、25 元/局、35 元/局、52 元/小时；
- 首页横幅和推荐位来自云端；
- 下架任一套餐后，列表和搜索不再返回；
- 暂停任一套餐后，详情可查看但不能创建新订单；
- 评分、累计接单和真实评价保持 0/空，不因种子数据增加；
- 余额、邀请和代打入口保持关闭。

## 12. 正式运营替换清单

正式上线前必须替换或确认：

- 游戏具体版本、平台和区服；
- 套餐名称、价格、履约标准、营业时间和派单承诺；
- 正式 Logo、横幅、封面和详情素材授权；
- 用户协议、隐私政策和服务规则；
- 客服账号和投诉流程；
- 优惠券规则与预算；
- 开发测试标记和全部自动化夹具。
