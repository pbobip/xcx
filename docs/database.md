# 微信云开发数据库设计

## 1. 设计目标

本设计服务于单商户自营的游戏服务小程序，使用 CloudBase 文档数据库。顾客端、运营后台和支付通知共享同一套业务数据，但所有受保护读写都经过云函数。

核心约束：

- 金额统一使用整数分，字段以 `Cents` 结尾；
- 日期时间保存为数据库日期类型，展示时再格式化；
- 顾客身份以云函数上下文取得的 `OPENID` 为准；
- 服务订单保存不可变快照，不跟随服务套餐更新；
- 支付、履约和售后状态分别保存；
- 业务写入携带幂等键和版本号，拒绝重复或过期更新；
- 评价、销量和评分只由非测试的真实有效订单产生；
- 顾客端不得直接写业务集合，运营后台也必须通过管理员云函数。

## 2. 公共字段与枚举

所有集合按需要使用：

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | CloudBase 文档 ID |
| `createdAt` | date | 创建时间 |
| `updatedAt` | date | 最后更新时间 |
| `createdBy` | string/null | 管理员或系统主体 ID |
| `updatedBy` | string/null | 最后修改主体 ID |
| `version` | number | 乐观并发版本，从 1 开始 |
| `isTest` | boolean | 是否开发/自动化测试数据 |

### 2.1 内容状态

- `DRAFT`：草稿，仅后台可见；
- `ACTIVE`：已上架/启用；
- `PAUSED`：暂停接单，顾客可看但不能新下单；
- `OFFLINE`：已下架，顾客不可见；
- `HIDDEN`：功能或入口隐藏。

### 2.2 服务订单的三维状态

**支付状态 `paymentStatus`**：

- `UNPAID`：未支付；
- `PAID`：已支付；
- `PARTIALLY_REFUNDED`：部分退款；
- `REFUNDED`：全额退款；
- `CLOSED`：未支付订单已关闭。

**履约状态 `fulfillmentStatus`**：

- `NOT_STARTED`：未进入履约，通常表示订单仍待付款；
- `PENDING_ASSIGNMENT`：待人工派单；
- `WAITING_START`：已派单，待开始；
- `IN_SERVICE`：服务中；
- `WAITING_CONFIRMATION`：已提交完成，待顾客确认；
- `COMPLETED`：已完成；
- `CANCELLED`：履约已取消。

**售后状态 `afterSalesStatus`**：

- `NONE`：无售后；
- `REQUESTED`：顾客已申请；
- `PROCESSING`：处理中；
- `RESOLVED`：已有处理结论；
- `CLOSED`：售后已关闭。

### 2.3 顾客订单标签映射

| 顾客标签 | 状态条件 |
|---|---|
| 待付款 | `paymentStatus = UNPAID` 且履约为 `NOT_STARTED` |
| 待服务 | `paymentStatus = PAID` 且履约为 `PENDING_ASSIGNMENT` 或 `WAITING_START` |
| 进行中 | 履约为 `IN_SERVICE` 或 `WAITING_CONFIRMATION` |
| 已完成 | `fulfillmentStatus = COMPLETED` |
| 全部 | 顾客所有订单，包括关闭、取消、退款和售后状态 |

## 3. 集合总览

| 业务域 | 集合 |
|---|---|
| 用户权限 | `users`、`admin_users`、`roles`、`audit_logs` |
| 内容目录 | `games`、`service_types`、`categories`、`services`、`banners`、`recommendations` |
| 服务人员 | `service_staff` |
| 订单履约 | `orders`、`order_logs`、`dispatch_records` |
| 支付退款 | `payment_records`、`refund_records` |
| 优惠券 | `coupon_templates`、`user_coupons` |
| 评价投诉 | `reviews`、`complaints` |
| 通知设置 | `messages`、`agreements`、`system_settings`、`feedback`、`privacy_requests` |

## 4. 用户与权限

### 4.1 `users`

| 字段 | 类型 | 说明 |
|---|---|---|
| `openid` | string | 微信身份，唯一且不返回其他顾客 |
| `platformUserNo` | string | 面向顾客展示的平台用户 ID，唯一 |
| `nickname` | string | 微信昵称或默认“微信用户” |
| `avatarFileId` | string/null | 头像云文件 ID |
| `status` | string | `ACTIVE`、`DISABLED`、`CANCELLED` |
| `preferences.orderNotifications` | boolean | 站内订单通知偏好 |
| `preferences.recentSearches` | string[] | 最近搜索，最多保留 10 个去重关键词 |
| `agreementConsents` | array | 已同意的协议类型、版本和时间 |
| `lastLoginAt` | date | 最近登录时间 |
| `cancelledAt` | date/null | 注销时间 |

索引：`openid` 唯一；`platformUserNo` 唯一；`status + createdAt`。

### 4.2 `admin_users`

字段：`authSubjectId`、`displayName`、`roleIds[]`、`status`、`lastLoginAt`。不保存明文密码；身份由 CloudBase 身份能力或经批准的管理员认证适配器提供。

索引：`authSubjectId` 唯一；`status`。

### 4.3 `roles`

字段：`code`、`name`、`permissions[]`、`description`、`status`。首版角色为 `SUPER_ADMIN`、`OPERATOR`、`DISPATCHER`、`CUSTOMER_SERVICE`、`FINANCE`。

索引：`code` 唯一。

### 4.4 `audit_logs`

字段：`actorId`、`actorRoleCodes[]`、`action`、`targetType`、`targetId`、`beforeSummary`、`afterSummary`、`reason`、`requestId`、`result`、`ipHash`。摘要必须脱敏，不保存密钥、密码、验证码或投诉图片内容。

索引：`actorId + createdAt`；`targetType + targetId + createdAt`；`action + createdAt`；`requestId`。

## 5. 内容目录

### 5.1 `games`

字段：`code`、`name`、`productVersion`、`platforms[]`、`coverFileId`、`description`、`status`、`sort`。

索引：`code` 唯一；`status + sort`。

### 5.2 `service_types`

字段：`code`、`name`、`description`、`riskLevel`、`status`、`sort`。初始类型为陪玩、护航、教学、代打；代打为 `HIDDEN`。

索引：`code` 唯一；`status + sort`。

### 5.3 `categories`

字段：`code`、`name`、`kind`（`GAME`/`SERVICE_TYPE`/`OPERATION`）、`gameId`、`serviceTypeId`、`iconFileId`、`status`、`sort`。

索引：`code` 唯一；`status + sort`；`gameId + status`；`serviceTypeId + status`。

### 5.4 `services`

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | string | 套餐编码，唯一 |
| `name` | string | 服务套餐名称 |
| `gameId` | string | 主游戏 ID |
| `serviceTypeId` | string | 服务类型 ID |
| `categoryIds` | string[] | 所属专区 |
| `subtitle` | string | 卡片摘要 |
| `mediaFileIds` | string[] | 图片或视频云文件 ID |
| `unit` | string | `ROUND`、`HOUR`、`PACKAGE`、`TASK` |
| `unitLabel` | string | 顾客看到的“局/小时/份/任务” |
| `priceCents` | number | 当前单价，整数分 |
| `originalPriceCents` | number/null | 可验证的原价；无原价时为空 |
| `minQuantity` / `maxQuantity` | number | 可购买数量范围 |
| `platforms` | string[] | 可接平台 |
| `regions` | object[] | 可接区服，含 code/name/status |
| `orderFields` | object[] | 动态下单字段定义 |
| `fulfillmentStandard` | string | 履约与验收标准 |
| `purchaseNotice` | string | 下单须知 |
| `descriptionBlocks` | object[] | 详情内容块 |
| `searchKeywords` | string[] | 运营搜索关键词 |
| `searchText` | string | 服务标题、编码、游戏、专区、服务类型和运营关键词组成的复合检索文本 |
| `status` | string | 内容状态 |
| `isLatest` | boolean | 是否进入最新服务 |
| `sort` | number | 排序值 |
| `stats` | object | 派生的有效订单数、评价数、三维评分和综合评分 |

`orderFields` 子项包含：`key`、`label`、`type`（`SINGLE`/`MULTIPLE`/`TEXT`/`NUMBER`/`DATETIME`/`NOTICE`）、`required`、`options[]`、`placeholder`、`validation`、`affectsPrice`、`customerVisible`、`sort`。

`searchText` 由可信云端写接口生成，不由小程序提交。游戏、专区或服务类型改名后，后台必须同步重建相关套餐的 `searchText`。

索引：`code` 唯一；`status + sort`；`gameId + status + sort`；`serviceTypeId + status + sort`；`categoryIds + status`；`isLatest + status + sort`。

### 5.5 `banners`

字段：`title`、`subtitle`、`imageFileId`、`targetType`、`targetId`、`startAt`、`endAt`、`status`、`sort`。

索引：`status + startAt + endAt + sort`。

### 5.6 `recommendations`

字段：`code`、`name`、`serviceIds[]`、`categoryId`、`startAt`、`endAt`、`status`、`sort`。

索引：`code` 唯一；`status + sort`；`status + startAt + endAt + sort`。

## 6. 服务人员与订单履约

### 6.1 `service_staff`

字段：`staffNo`、`displayName`、`avatarFileId`、`gameIds[]`、`platforms[]`、`skills[]`、`availabilityStatus`、`internalContactEncrypted`、`internalNotes`、`status`。

索引：`staffNo` 唯一；`status + availabilityStatus`；`gameIds + status`。私人联系方式不得返回顾客端。

### 6.2 `orders`

| 字段 | 类型 | 说明 |
|---|---|---|
| `orderNo` | string | 平台订单号，唯一 |
| `userId` | string | 顾客 ID |
| `serviceId` | string | 服务套餐来源引用，仅用于追踪 |
| `snapshot` | object | 套餐、价格、字段、标准、须知和协议的不可变快照 |
| `quantity` | number | 购买数量 |
| `unitPriceCents` | number | 下单单价 |
| `originalAmountCents` | number | 优惠前金额 |
| `discountAmountCents` | number | 优惠金额 |
| `payableAmountCents` | number | 应付金额 |
| `paidAmountCents` | number | 实付金额 |
| `refundedAmountCents` | number | 已退款金额 |
| `userCouponId` | string/null | 使用的顾客券 |
| `orderValues` | object | 动态下单字段值；敏感字段禁止写入 |
| `serviceMode` | string | `IMMEDIATE` 或 `RESERVATION` |
| `scheduledAt` | date/null | 预约时间 |
| `customerNote` | string | 过滤后的备注 |
| `paymentStatus` | string | 支付状态 |
| `fulfillmentStatus` | string | 履约状态 |
| `afterSalesStatus` | string | 售后状态 |
| `assignedStaffId` | string/null | 当前内部服务人员 |
| `paidAt` / `startedAt` / `completedAt` / `closedAt` | date/null | 关键时间 |
| `idempotencyKey` | string | 建单幂等键 |

索引：`orderNo` 唯一；`userId + createdAt`；`userId + paymentStatus + fulfillmentStatus + createdAt`；`paymentStatus + fulfillmentStatus + scheduledAt`；`assignedStaffId + fulfillmentStatus`；`idempotencyKey + userId` 唯一。

### 6.3 `order_logs`

字段：`orderId`、`orderNo`、`action`、`statusDimension`（`PAYMENT`/`FULFILLMENT`/`AFTER_SALES`）、`fromStatus`、`toStatus`、`actorType`、`actorId`、`customerVisible`、`customerMessage`、`internalReason`、`requestId`。一个动作同时改变多个维度时，按维度写多条共享同一 `requestId` 的日志。

索引：`orderId + createdAt`；`actorId + createdAt`；`requestId`。

### 6.4 `dispatch_records`

字段：`orderId`、`staffId`、`action`（`ASSIGN`/`REASSIGN`/`UNASSIGN`）、`confirmedOffline`、`reason`、`operatorId`、`assignedAt`、`endedAt`。

索引：`orderId + assignedAt`；`staffId + assignedAt`。

## 7. 支付与退款

### 7.1 `payment_records`

字段：`orderId`、`orderNo`、`outTradeNo`、`transactionId`、`amountCents`、`status`、`prepayId`、`notifyId`、`paidAt`、`lastQueriedAt`、`rawSummary`、`requestId`。`rawSummary` 只保存排障所需的脱敏摘要。

索引：`outTradeNo` 唯一；`transactionId` 唯一（允许付款前为空）；`orderId + createdAt`；`notifyId` 唯一。

### 7.2 `refund_records`

字段：`orderId`、`refundNo`、`outRefundNo`、`refundId`、`amountCents`、`reason`、`status`、`requestedBy`、`approvedBy`、`notifyId`、`refundedAt`、`requestId`。

索引：`outRefundNo` 唯一；`refundId` 唯一（允许申请前为空）；`orderId + createdAt`；`notifyId` 唯一。

## 8. 优惠券

### 8.1 `coupon_templates`

字段：`code`、`name`、`type`（`FIXED`/`THRESHOLD`）、`discountCents`、`thresholdCents`、`gameIds[]`、`categoryIds[]`、`serviceIds[]`、`validFrom`、`validTo`、`perUserLimit`、`totalLimit`、`issuedCount`、`status`。

索引：`code` 唯一；`status + validFrom + validTo`。

### 8.2 `user_coupons`

字段：`userId`、`templateId`、`status`（`AVAILABLE`/`LOCKED`/`USED`/`EXPIRED`/`VOID`）、`validFrom`、`validTo`、`lockedOrderId`、`usedOrderId`、`lockedAt`、`usedAt`、`grantSource`。

索引：`userId + status + validTo`；`lockedOrderId`；`usedOrderId`。锁券、核销和退回必须在云函数事务中完成。

## 9. 评价与投诉

### 9.1 `reviews`

字段：`orderId`、`userId`、`serviceId`、`technicalScore`、`attitudeScore`、`responseScore`、`overallScore`、`content`、`displayNameMode`、`status`（`PENDING`/`VISIBLE`/`HIDDEN`）、`followUpContent`、`followedUpAt`。

索引：`orderId` 唯一；`serviceId + status + createdAt`；`userId + createdAt`。

### 9.2 `complaints`

字段：`complaintNo`、`orderId`、`userId`、`reasonCode`、`description`、`evidenceFileIds[]`、`status`、`customerVisibleReplies[]`、`internalNotes[]`、`assignedAdminId`、`resolvedAt`、`resolution`。

索引：`complaintNo` 唯一；`userId + createdAt`；`orderId + status`；`assignedAdminId + status`。同一订单同一时刻最多一个未关闭投诉，由云函数保证。

## 10. 消息、协议与设置

### 10.1 `messages`

字段：`userId`、`type`、`title`、`summary`、`relatedType`、`relatedId`、`targetPage`、`targetParams`、`isRead`、`readAt`、`sentAt`。

索引：`userId + createdAt`；`userId + isRead + createdAt`。

### 10.2 `agreements`

字段：`type`（`USER_AGREEMENT`/`PRIVACY_POLICY`/`SERVICE_RULES`）、`version`、`title`、`content`、`effectiveAt`、`status`。

索引：`type + version` 唯一；`type + status + effectiveAt`。

### 10.3 `system_settings`

按文档保存受控配置：`key`、`value`、`valueType`、`description`、`status`。初始配置包括品牌公开信息、营业时间、派单承诺、自动完成时限、客服配置和功能开关。

索引：`key` 唯一。

### 10.4 `feedback`

字段：`userId`、`category`、`content`、`contact`（可选且脱敏）、`status`、`assignedAdminId`、`reply`。

索引：`userId + createdAt`；`status + createdAt`。

### 10.5 `privacy_requests`

字段：`userId`、`type`（`CANCEL_ACCOUNT`/`DELETE_NON_REQUIRED_DATA`/`EXPORT_DATA`）、`status`、`requestNote`、`handledBy`、`handledAt`、`resultSummary`。

索引：`userId + createdAt`；`status + createdAt`。

## 11. 云存储

| 路径前缀 | 内容 | 访问规则 |
|---|---|---|
| `public/games/` | 游戏封面 | 顾客可读取，管理员写入 |
| `public/services/` | 套餐媒体 | 顾客可读取，管理员写入 |
| `public/banners/` | 横幅 | 顾客可读取，管理员写入 |
| `private/avatars/{userId}/` | 顾客头像 | 本人和授权后台读取 |
| `private/complaints/{userId}/{complaintId}/` | 投诉凭证 | 本人及授权客服通过临时链接读取 |

不得上传密码、验证码、支付凭证或无关身份证件。投诉凭证保存期限由运营与合规确认；开发阶段不得写死为永久保存。

## 12. 权限矩阵

| 数据 | 访客 | 顾客 | 运营/派单/客服 | 财务 | 超级管理员 |
|---|---|---|---|---|---|
| 公开目录、横幅、有效协议 | 经 `catalog` 读取 | 经 `catalog` 读取 | 管理员云函数维护 | 只读 | 全部 |
| 用户资料 | 无 | 仅本人 | 脱敏且按需 | 不可见 | 按合规流程 |
| 服务订单 | 无 | 仅本人 | 按职责读取/更新 | 支付摘要只读 | 全部 |
| 支付退款 | 无 | 本人订单摘要 | 客服可发起建议 | 查询、退款和对账 | 全部 |
| 内部服务人员 | 无 | 仅允许公开的昵称 | 派单需要的内部资料 | 不可见 | 全部 |
| 投诉凭证 | 无 | 仅本人 | 授权客服 | 不可见 | 按需 |
| 密钥与证书 | 无 | 无 | 无 | 无明文显示 | 仅云端安全配置，不经后台回显 |

CloudBase 集合权限默认设为“仅云函数可读写”。公开数据也通过 `catalog` 云函数提供，以保持过滤、排序和下架规则的一致接口。

## 13. 数据生命周期与真实性

- 套餐、专区和游戏使用状态控制，不物理删除已被订单引用的数据；
- 订单、支付、退款、派单和审计日志按法律与财务要求保留，具体年限待确认；
- 注销顾客不删除依法必须保留的交易记录，只删除或匿名化非必要资料；
- 测试数据必须 `isTest = true`，不得进入销量、评分、财务和运营报表；
- 只有 `PAID` 且非测试订单能进入派单；
- 只有真实 `COMPLETED` 订单能增加累计接单并产生评价；
- 后台无直接编辑 `services.stats` 的入口，统计由受控聚合任务更新。

## 14. 待确认参数

- 未支付订单关闭时间；
- 派单超时时间、预约提前确认时间和自动完成时限；
- 退款审批额度和角色；
- 投诉凭证、普通日志和非必要资料保存期限；
- 生产环境是否新建独立 CloudBase 环境；
- 正式管理员认证方式与首个超级管理员账号建立流程。
