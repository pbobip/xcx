# 开发测试数据方案

## 1. 原则

本文件定义后续初始化 CloudBase 开发环境的数据。它不是正式运营内容，正式价格、素材、协议和营业规则仍需云东确认。

- 公开目录种子数据可以展示，但开发阶段统一标记 `isTest = true`；
- 不伪造真实销量、评分、评价或支付流水；
- 六款游戏在开发环境均创建可购买的模拟套餐，所有套餐必须明确显示“开发模拟数据”；
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

六个游戏均出现在专区页左栏。开发环境提供覆盖六款游戏的模拟套餐，用于联调专区、搜索、详情和下单流程；这些价格不是正式运营报价。

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

## 5. 开发模拟服务套餐 `services`

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

### 5.1 六游戏补充套餐

在上述 4 个无畏契约原型套餐之外，开发环境再创建 11 个固定 ID 套餐，总数为 15。新增套餐全部使用 `isTest = true`、零销量、零评价、空评分，并在购买须知中显示“开发模拟数据，非正式运营报价”。

| 固定测试 ID | 名称 | 游戏 | 类型 | 单位 | 单价 | 主要专区 |
|---|---|---|---|---|---:|---|
| `service-dev-newcomer` | 新人体验陪玩 | 无畏契约 | 陪玩 | 局 | 900 分 | 新人体验、陪玩 |
| `service-lol-companion` | 英雄联盟双排陪玩 | 英雄联盟 | 陪玩 | 小时 | 3900 分 | 陪玩 |
| `service-lol-coaching` | 英雄联盟基础教学 | 英雄联盟 | 教学 | 小时 | 6900 分 | 教学 |
| `service-naraka-companion` | 永劫无间组队陪玩 | 永劫无间 | 陪玩 | 小时 | 4500 分 | 陪玩 |
| `service-naraka-escort` | 永劫无间任务护航 | 永劫无间 | 护航 | 任务 | 5900 分 | 护航 |
| `service-delta-escort` | 三角洲行动任务护航 | 三角洲行动 | 护航 | 任务 | 6800 分 | 护航、热门活动 |
| `service-delta-coaching` | 三角洲行动战术教学 | 三角洲行动 | 教学 | 小时 | 5900 分 | 教学 |
| `service-hok-companion` | 王者荣耀娱乐陪玩 | 王者荣耀 | 陪玩 | 局 | 1900 分 | 陪玩 |
| `service-hok-coaching` | 王者荣耀基础教学 | 王者荣耀 | 教学 | 小时 | 4900 分 | 教学 |
| `service-pubg-companion` | 绝地求生组队陪玩 | 绝地求生 | 陪玩 | 小时 | 4500 分 | 陪玩 |
| `service-pubg-coaching` | 绝地求生战术教学 | 绝地求生 | 教学 | 小时 | 6500 分 | 教学 |

所有新增套餐只收集平台、区服、游戏文字 ID、服务时间、预约时间、备注和成年确认，不收集账号密码或验证码。代打套餐继续隐藏。

### 5.2 动态下单字段

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

横幅与推荐位均填写覆盖当前开发周期的 `startAt/endAt`，前台只返回当前时间处于有效期内的配置。

### 6.2 推荐位 `recommendations`

| code | 名称 | 套餐顺序 | 状态 |
|---|---|---|---|
| `HOME_RECOMMENDED` | 推荐 | 英雄联盟教学、永劫无间护航、三角洲教学、王者荣耀教学、无畏契约技术陪、绝地求生教学 | `ACTIVE` |
| `HOME_LATEST` | 最新服务 | 无畏契约基础陪玩及其余五款游戏各 1 个模拟套餐 | `ACTIVE` |
| `HOME_NEWCOMER` | 新人体验 | 新人体验陪玩 | `ACTIVE` |

三个推荐位的套餐 ID 不交叉；空推荐位不展示空白卡片。

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
| 未付款 | `UNPAID` | `NOT_STARTED` | `NONE` | 继续支付、取消、关单 |
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
5. 导入 15 个六游戏开发模拟套餐；
6. 上传原创占位素材并回填云文件 ID；
7. 导入横幅、推荐位和测试优惠券模板；
8. 运行目录读取验收；
9. 按需创建自动化测试夹具并在测试后清理。

## 11. 种子数据验收

- 专区页左栏按预期显示六个游戏；
- 六款游戏都至少显示两个可购买测试套餐，无畏契约共显示五个；
- 云端目录共返回 15 个套餐，其中新增 11 个均为 `isTest = true`；
- 原有四个无畏契约套餐价格仍分别显示 10 元/局、25 元/局、35 元/局、52 元/小时；
- 新增套餐均显示“开发模拟数据，非正式运营报价”；
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
