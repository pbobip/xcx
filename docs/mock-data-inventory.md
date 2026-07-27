# 小程序页面数据需求盘点

## 1. 目的与范围

本文件对应 GitHub Issue #1，盘点当前实施项目 `miniprogram-v2` 的 17 个页面、全局状态和本地存储。这里的 “Mock 数据” 包括写死在 JavaScript/WXML 中的演示内容、用本地存储模拟的业务状态以及只有空状态但未来需要云数据的页面。

`miniprogram/` 是早期转换版本，保留作历史参考，不作为后端接入目标；`小程序原型设计/` 是 Web 原型与视觉参考，不作为运行时数据源。

当前结论：微信云开发只完成了环境初始化，云数据库、云函数和正式测试数据尚未建立。页面中仍存在大量本地演示数据，但它们不会出现在 CloudBase 控制台中。

## 2. 数据来源分类

| 类型 | 当前表现 | 处理方式 |
|---|---|---|
| 写死的业务数据 | 套餐、价格、游戏、订单、消息直接写在 JS/WXML | 替换为云函数返回的数据 |
| 本地业务状态 | 登录、未读数、最后订单等写入 `wx` 本地存储 | 业务真相迁移到云端；仅保留导航和短期 UI 状态 |
| 空页面或占位内容 | 优惠券、投诉、协议等没有真实记录 | 建立集合和接口，真实无数据时继续展示空状态 |
| 展示常量 | Tab 名称、按钮文案、状态显示名称、校验提示 | 保留在前端，不为可配置而可配置 |
| P1 预览 | 余额、邀请好友 | 保持功能开关关闭，不纳入首批云端实现 |

## 3. 全局与共用数据

| 位置 | 当前数据 | 问题 | 目标数据/接口 | 处理 |
|---|---|---|---|---|
| `app.js` | 云环境 ID、全局未读数和 Tab 角标 | 未读数默认来自本地值 `2` | `messages` + `customer.message.unreadCount` | 环境 ID 保留；未读数改为云端真值 |
| `app.json` | 首个页面是登录页 | 与“先浏览、支付前登录”冲突 | 无数据库依赖 | Issue #2 将首页调整为第一入口 |
| `utils/packages.js` | 4 个无畏契约套餐及价格 | 套餐、计价和说明全写死 | `services` + `catalog.service.detail` | 云端上线后删除业务常量 |
| `utils/store.js` | 登录、选中套餐、选中订单、最后订单、未读数 | 把业务对象当作本地真相 | `users`、`orders`、`messages` | 只保留登录返回、筛选等短期 UI 状态 |
| `utils/nav.js` | Tab 页面名单与跳转规则 | 不是业务数据 | 无 | 保留前端常量 |
| `care-btn` | 微信原生客服按钮 | 客服账号与营业规则未配置 | `system_settings`（只保存公开配置） | 原生客服能力保留 |
| `bbx-toast` | 组件内部保存提示文案和显示状态 | 仅为短期 UI 状态 | 无 | 保留组件本地状态，不进入云数据库 |

## 4. 页面数据映射

### 4.1 P0 页面

| 页面 | 当前来源与状态 | 页面需要的数据 | 目标集合 | 目标云函数动作 | 替换要求 |
|---|---|---|---|---|---|
| 登录 `login` | `bbx_logged_in` 本地布尔值；没有真实用户 | 登录状态、平台用户 ID、头像、昵称、协议版本、登录返回目标 | `users`、`agreements`、`messages` | `auth.init`、`auth.profile` | 使用可信 `OPENID`；首次注册生成欢迎消息；浏览无需登录 |
| 首页 `home` | 横幅文案写死在 WXML；推荐标签和 7 条 feed 写死在 JS | 横幅、最新服务、推荐专区、套餐摘要、上下架、跳转目标、分页 | `banners`、`recommendations`、`categories`、`services` | `catalog.home`、`catalog.service.list` | 运营修改后无需重新发布；下架内容不可见 |
| 分类 `categories` | 6 个游戏、目录和无畏契约价格写死；其他游戏显示待配置 | 游戏、专区、套餐卡、排序、接单状态、分页 | `games`、`categories`、`service_types`、`services` | `catalog.game.list`、`catalog.category.list`、`catalog.service.list` | 游戏与套餐从云端加载；暂停接单禁止下单 |
| 搜索 `search` | 4 条 `RESULTS`、最近词和热门词写死 | 关键词、最近搜索、热门词、套餐结果、匹配数、分页 | `services`、`games`、`categories`、`users`、`system_settings` | `catalog.search`、`customer.searchHistory.list/clear` | 不返回下架套餐；最近搜索按顾客保存 |
| 服务详情 `service-detail` | 套餐来自 `packages.js`；完整价目写死在 WXML；评分为 `—/0` | 套餐媒体、价格、平台/区服、服务类型、履约标准、须知、评分、接单量、评价 | `services`、`reviews`、`agreements` | `catalog.service.detail`、`customer.review.list` | 价格与价目必须来自同一套餐快照；统计只来自真实订单 |
| 确认订单 `checkout` | 套餐、价格、平台、区服写死；前端直接乘价；优惠券固定为空 | 套餐、动态字段、计价单位、数量、平台、区服、游戏 ID、预约、优惠券、协议、服务端报价 | `services`、`coupon_templates`、`user_coupons`、`agreements` | `order.quote`、`coupon.available.list`、`order.create` | 前端金额仅展示；禁止敏感信息；订单保存不可变快照 |
| 支付结果 `payment-result` | 默认订单和“支付成功”写死；读取本地最后订单 | 订单号、支付结果、实付、付款确认时间、待服务状态、未知状态 | `orders`、`payment_records` | `payment.query`、`order.detail` | 仅云端支付结果能显示成功；支持取消和确认中 |
| 我的订单 `orders` | 3 条 `DEMO_ORDERS` 写死 | 五标签订单、订单号、状态、套餐快照、数量、实付、时间、分页 | `orders` | `order.list` | 只能查看本人订单；五标签由三维状态映射 |
| 订单详情 `order-detail` | 默认订单、状态标题、进度写死；退款与评价只 Toast | 订单快照、支付/履约/售后状态、时间线、派单摘要、退款、评价资格、投诉 | `orders`、`order_logs`、`dispatch_records`、`refund_records`、`reviews`、`complaints` | `order.detail`、`order.cancel/confirm/dispute`、`payment.refund.request`、`customer.review.create` | 操作按钮按真实状态显示；游戏 ID 脱敏 |
| 消息 `messages` | 3 条演示消息；未读数来自本地 | 消息类型、标题、摘要、时间、已读、关联对象、跳转目标、未读数 | `messages` | `customer.message.list/read/readAll/unreadCount` | 状态变化产生真实消息；不建设私聊 |
| 我的 `profile` | 用户名、ID 文案和订单数量写死 | 用户资料、平台用户 ID、各状态订单数、功能开关 | `users`、`orders`、`system_settings` | `auth.profile`、`order.summary`、`customer.settings.get` | 订单数实时聚合；P1 入口按开关隐藏 |
| 我的优惠券 `coupons` | 只有三个标签和统一空状态 | 顾客券、模板、状态、面额、门槛、范围、有效期 | `user_coupons`、`coupon_templates` | `coupon.mine.list` | 真实无券时保留空状态；禁止跨用户读取 |
| 我的投诉 `complaints` | 投诉卡文案写死，点击只提示待接后台 | 投诉编号、关联订单、原因、状态、提交时间、客服回复和处理进度 | `complaints` | `customer.complaint.list/detail` | 只显示本人投诉；处理中暂停自动完成 |
| 提交投诉 `complaint-submit` | 订单号与原因列表写死；图片只保留临时路径 | 可投诉订单、原因、说明、图片文件 ID、提交状态 | `orders`、`complaints`、云存储 | `customer.complaint.eligibleOrders/create` | 图片先上传私有路径；服务端校验订单归属和输入 |
| 设置 `settings` | 通知开关存本地；反馈、协议、隐私和注销都是提示 | 通知偏好、协议/隐私版本、反馈、注销与删除请求、品牌与客服公开信息 | `users`、`agreements`、`feedback`、`privacy_requests`、`system_settings` | `customer.settings.get/update`、`customer.agreement.get`、`customer.feedback.create`、`customer.privacyRequest.create` | 退出仅清本地会话；依法保存的订单不删除 |

### 4.2 P1 页面

| 页面 | 当前状态 | 未来数据 | P0 处理 |
|---|---|---|---|
| 余额 `balance` | 3 条能力说明写死，无账户和流水 | 余额账户、充值、消费、退款、抵扣 | 功能开关保持关闭，个人中心隐藏入口，不建真实余额数据 |
| 邀请 `invite` | 固定分享文案，可调微信分享 | 邀请关系、邀请奖励券、风控结果 | 功能开关保持关闭，不记录邀请关系，不发放奖励 |

## 5. 本地存储迁移表

| 本地键 | 当前用途 | 云端真值 | 最终处理 |
|---|---|---|---|
| `bbx_unread_messages` | Tab 未读角标 | `messages.isRead` 聚合 | 删除业务真值；可保留短期显示缓存但必须以云端刷新 |
| `bbx_logged_in` | 模拟登录 | 微信身份 + `users` | 删除；不能用本地布尔值授权 |
| `bbx_login_return` | 登录后返回页面 | 无 | 保留为短期导航状态 |
| `bbx_selected_service` | 页面间传整份套餐选择 | `services._id` | 改为路由携带 `serviceId`，本地仅可缓存 ID |
| `bbx_pending_tab_state` | 订单页预选标签 | 无 | 可保留为短期 UI 状态或路由参数 |
| `bbx_selected_order` | 页面间传订单对象 | `orders._id` | 改为路由携带 `orderId` 并重新查询 |
| `bbx_last_order` | 模拟支付结果与订单详情 | `orders` + `payment_records` | 删除业务真值；支付结果按订单号查询 |
| `bbx_notify_on` | 通知偏好 | `users.preferences.orderNotifications` | 登录后保存云端；未登录可使用本地默认值 |

## 6. 不迁移到数据库的内容

以下内容属于稳定的前端界面语言或交互规则，不应为了后台可配置而增加复杂度：

- Tab 名称与顺序：首页、分类、我的、消息；
- 通用按钮名称、空状态结构、加载和错误组件；
- 状态码到顾客文案的前端映射；
- 数量步进器的交互形式；
- “禁止填写密码、验证码、支付凭证”等安全校验规则；
- P1 未启用时的功能说明页；
- 原生微信客服按钮的交互方式。

品牌名、客服公开信息、协议版本、营业时间和功能开关属于运营配置，进入 `system_settings` 或 `agreements`。

## 7. 实施顺序

1. 先按 `database.md` 建立集合、索引、权限和测试数据；
2. 建立 `auth` 与 `catalog` 云函数，替换身份和目录数据；
3. 建立订单、优惠券、支付、派单、消息、评价和投诉接口；
4. 每替换一页，就删除对应本地业务真值并保留可验证的空状态；
5. P0 完成后再次扫描，确保没有 `DEMO`、演示订单或会影响真实统计的硬编码数据。

## 8. 待运营确认

- 首批实际开放的 1–2 个游戏及具体端游/手游版本；
- 各套餐最终价格、计价单位、平台、区服和履约标准；
- 营业时间、预约规则、派单承诺和自动完成时限；
- 投诉图片、日志和非必要用户资料的保存期限；
- 正式协议、隐私政策、客服配置与品牌素材；
- 代打是否需要登录顾客账号；不能安全授权时保持关闭。
