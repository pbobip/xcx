# 云函数接口设计

## 1. 接口目标

小程序和 Web 运营后台都通过少量按业务域组织的深模块访问云端。调用方只需要知道模块名、动作、输入、输出和错误模式；数据库结构、状态机、事务、权限和微信支付细节隐藏在实现内部。

外部接口模块：`auth`、`catalog`、`order`、`payment`、`fulfillment`、`customer`、`admin`。PRD 草案中的派单模块名 `service` 在此确定为 `fulfillment`，避免与服务套餐动作 `catalog.service.*` 混淆。

## 2. 通用调用约定

小程序调用云函数时发送：

```json
{
  "action": "service.detail",
  "payload": {},
  "requestId": "客户端请求追踪号",
  "idempotencyKey": "仅写操作需要"
}
```

统一成功响应：

```json
{
  "success": true,
  "data": {},
  "requestId": "与服务端日志关联的追踪号"
}
```

统一失败响应：

```json
{
  "success": false,
  "error": {
    "code": "FULFILLMENT_STATUS_CONFLICT",
    "message": "履约状态已变化，请刷新后重试",
    "details": {}
  },
  "requestId": "追踪号"
}
```

约定：

- 顾客身份只从云函数上下文取得，不接受客户端传 `userId/openid` 作为授权依据；
- 管理员动作同时验证后台身份、角色权限和资源范围；
- 列表使用游标分页，默认 20 条，最大 50 条；
- 金额输入输出统一为整数分；
- 日期时间使用 ISO 8601 字符串传输，数据库保存日期类型；
- 写操作返回业务对象的新 `version`，过期版本更新返回冲突；
- 日志不得记录备注全文、游戏 ID 明文、支付密钥或投诉图片内容。

## 3. 身份与用户模块 `auth`

| 动作 | 调用者 | 主要输入 | 主要输出 | 写入/副作用 |
|---|---|---|---|---|
| `init` | 微信用户 | 协议版本（可选） | 登录状态、平台用户 ID、是否首次注册、资料 | 首次建立 `users` 并创建欢迎消息 |
| `profile` | 顾客 | 无 | 昵称、头像、平台用户 ID、偏好、功能开关 | 更新最近登录时间可在 `init` 完成 |
| `profile.update` | 顾客 | 昵称、头像文件 ID | 更新后的资料 | 校验文件归属并更新资料 |
| `preferences.update` | 顾客 | 订单通知偏好、对象版本 | 新版本偏好 | 写用户偏好日志 |
| `agreement.consent` | 顾客 | 协议类型、版本 | 同意记录 | 幂等追加同意记录 |

`init` 是微信身份的主测试接缝：首次调用创建用户，再次调用返回同一用户，伪造用户 ID 不改变结果。

## 4. 目录模块 `catalog`

| 动作 | 身份 | 输入 | 输出 |
|---|---|---|---|
| `home` | 访客可用 | 当前时间、可选游标 | 有效横幅、最新服务、推荐专区、首批套餐 |
| `game.list` | 访客可用 | 无 | 已启用游戏及平台版本 |
| `category.list` | 访客可用 | 可选游戏/类型 | 已启用专区和排序 |
| `service.list` | 访客可用 | 游戏、专区、类型、状态过滤、游标 | 套餐摘要页和下一游标 |
| `service.detail` | 访客可用 | `serviceId` 或唯一 `code` | 套餐详情、价目、动态字段、统计与须知 |
| `search` | 访客可用 | 关键词、游戏/专区筛选、游标 | 按服务标题、游戏、专区、服务类型和运营关键词匹配的套餐与下一游标 |

规则：只返回 `ACTIVE` 或允许顾客查看的 `PAUSED` 内容；`PAUSED` 明确返回 `purchasable = false`；统计排除 `isTest` 数据；下架和草稿不返回。

## 5. 服务订单模块 `order`

### 5.1 计价与创建

| 动作 | 身份 | 输入 | 输出 | 幂等 |
|---|---|---|---|---|
| `quote` | 顾客 | 套餐 ID、数量 | 套餐、数量、云端单价、原价、优惠和应付金额 | 只读，不需要 |
| `create` | 顾客 | 套餐 ID、数量、动态字段值 | 服务订单、付款状态、是否复用原订单 | `idempotencyKey` 必填 |

`quote` 与 `create` 都重新读取当前套餐，不接受前端单价。Issue #5 按当前界面使用 `priceCents × quantity` 计价；选项加价和优惠券计价留给后续任务。确认订单页按套餐 `orderFields` 决定现有平台、区服、游戏 ID、服务时间、预约、备注和成年确认字段是否必填；`create` 再按同一配置校验必填、选项、预约、成年确认和敏感输入并保存不可变订单快照。新订单初始为支付 `UNPAID`、履约 `NOT_STARTED`、售后 `NONE`。

### 5.2 顾客订单

| 动作 | 输入 | 输出 | 允许状态 |
|---|---|---|---|
| `summary` | 无 | 五标签数量 | 所有本人订单 |
| `list` | 标签、游标 | 本人订单摘要与下一游标 | 所有本人订单 |
| `detail` | 订单 ID/订单号 | 快照、三维状态、时间线、可用动作 | 本人订单 |
| `cancel` | 订单 ID、原因、版本 | 关闭后的订单 | 未支付且未关闭 |
| `confirm` | 订单 ID、版本 | 完成后的订单 | 待确认且无处理中异议 |
| `dispute` | 订单 ID、原因、说明、版本 | 更新后的售后状态 | 待确认或允许售后的状态 |

所有动作先验证订单属于当前 `OPENID` 对应顾客。状态变化通过单一状态机并写 `order_logs`。

## 6. 优惠券接口（由 `customer` 与 `order` 协作）

| 动作 | 输入 | 输出 |
|---|---|---|
| `coupon.mine.list` | 状态、游标 | 顾客券、模板快照、下一游标 |
| `coupon.available.list` | 套餐 ID、数量 | 可用券和不可用原因 |

锁券、核销、退回不是顾客可直接调用的公开动作，由 `order.create`、支付确认和订单关闭在事务内完成。

## 7. 支付模块 `payment`

| 动作 | 调用者 | 输入 | 输出/副作用 | 幂等 |
|---|---|---|---|---|
| `prepay.create` | 顾客 | 订单 ID | 微信调起支付参数 | 按订单号复用有效预支付 |
| `query` | 顾客/系统 | 订单 ID | 云端确认的支付结果 | 只读或同步一次状态 |
| `close` | 系统/管理员 | 订单 ID | 关闭结果 | 重复关闭返回当前结果 |
| `refund.request` | 客服/管理员 | 订单 ID、金额、原因 | 退款申请记录 | `idempotencyKey` 必填 |
| `refund.query` | 财务/系统 | 退款记录 ID | 退款结果 | 只读或同步一次状态 |

微信支付通知和退款通知是独立 HTTP 接口，不由小程序调用。处理步骤固定为：验签 → 解密 → 校验商户号/订单号/金额 → 按通知 ID 幂等 → 事务更新支付记录、服务订单、优惠券和系统消息 → 返回微信要求的确认结果。首次确认支付成功时，支付状态变为 `PAID`，履约状态从 `NOT_STARTED` 进入 `PENDING_ASSIGNMENT`。

客户端点击“支付完成”不能直接修改 `paymentStatus`。

## 8. 派单与履约模块 `fulfillment`

| 动作 | 权限 | 输入 | 输出 |
|---|---|---|---|
| `staff.listAvailable` | 派单员 | 游戏、平台、时间 | 可用内部服务人员（内部字段） |
| `assign` | 派单员 | 订单 ID、人员 ID、线下确认标记、版本 | 派单记录和新履约状态 |
| `reassign` | 派单员 | 订单 ID、新人员 ID、原因、版本 | 新派单记录和当前履约状态 |
| `start` | 派单员/运营 | 订单 ID、版本 | 服务中订单 |
| `submitCompletion` | 派单员/运营 | 订单 ID、公开完成摘要、版本 | 待确认订单 |
| `forceComplete` | 高权限管理员 | 订单 ID、依据、版本 | 完成订单与审计记录 |

只有 `paymentStatus = PAID` 的非测试订单可以进入真实派单。每次变化同时写派单记录、订单日志和顾客系统消息。

## 9. 顾客互动模块 `customer`

### 9.1 搜索记录

| 动作 | 输入 | 输出 |
|---|---|---|
| `searchHistory.list` | 无 | 当前顾客最近搜索；访客返回空数组 |
| `searchHistory.record` | 规范化关键词 | 去重且最多 10 个的最近搜索 |
| `searchHistory.clear` | 无 | 空数组 |

热门关键词不是顾客数据，由 `catalog.home` 或 `catalog.search` 从运营配置返回。

### 9.2 系统消息

| 动作 | 输入 | 输出 |
|---|---|---|
| `message.list` | 游标 | 本人消息和下一游标 |
| `message.unreadCount` | 无 | 未读数 |
| `message.read` | 消息 ID | 更新后的消息 |
| `message.readAll` | 无 | 未读数 0 |

### 9.3 评价

| 动作 | 输入 | 输出 |
|---|---|---|
| `review.list` | 套餐 ID、游标 | 可见真实评价、评分样本数 |
| `review.create` | 订单 ID、三维评分、正文、展示昵称选择 | 新评价 |
| `review.followUp` | 评价 ID、追评正文 | 追评结果 |

只有本人已完成且未评价的订单可以调用 `review.create`。评分聚合由云端更新，后台没有修改星级接口。

### 9.4 投诉、反馈与隐私

| 动作 | 输入 | 输出 |
|---|---|---|
| `complaint.eligibleOrders` | 无 | 当前顾客可投诉订单 |
| `complaint.create` | 订单 ID、原因、说明、凭证文件 ID | 新投诉与暂停自动完成结果 |
| `complaint.list` | 状态、游标 | 本人投诉 |
| `complaint.detail` | 投诉 ID | 顾客可见处理时间线 |
| `feedback.create` | 类别、内容、可选联系方式 | 反馈编号 |
| `agreement.get` | 类型 | 当前生效协议 |
| `privacyRequest.create` | 请求类型、说明 | 隐私请求编号 |

投诉凭证上传前先申请受限云存储路径，创建投诉时验证文件归属和数量。

## 10. 运营后台模块 `admin`

### 10.1 身份与权限

| 动作 | 输出/作用 |
|---|---|
| `session` | 当前管理员、角色和权限 |
| `user.list/get` | 脱敏顾客查询，仅授权角色可用 |
| `role.list/save` | 超级管理员维护角色权限 |

每个后台动作都先调用同一权限判定实现，并将管理员、动作、目标、理由、请求 ID 和结果写入审计日志。

### 10.2 内容运营

| 动作组 | 允许操作 |
|---|---|
| `game.*` | 列表、新增、编辑、排序、启停 |
| `serviceType.*` | 列表、编辑、排序、启停；代打开关受额外权限控制 |
| `category.*` | 列表、新增、编辑、排序、启停 |
| `service.*` | 列表、新增、编辑、复制、上下架、暂停接单 |
| `banner.*` | 列表、新增、编辑、排序、启停和有效期 |
| `recommendation.*` | 列表、编辑套餐集合、排序和有效期 |
| `agreement.*` | 草稿、发布新版本、查看同意统计 |

套餐保存由云端校验价格、动态字段、区服、履约标准和状态，不允许前端直接写集合。

### 10.3 订单、人员与售后

| 动作组 | 允许操作 |
|---|---|
| `order.list/detail` | 筛选待付款、待派单、预约临近、进行中和售后订单 |
| `staff.*` | 维护人员、擅长游戏、平台、可用状态和内部备注 |
| `dispatch.*` | 调用 `fulfillment` 模块的派单与改派能力 |
| `refund.*` | 发起、审批、查询退款；金额权限按角色控制 |
| `coupon.*` | 维护模板、发放、作废未使用券 |
| `review.*` | 审核违规内容；不能修改星级和订单关联 |
| `complaint.*` | 分配客服、回复、给出结论和关闭 |
| `settings.*` | 营业时间、时限、客服和功能开关 |

## 11. 错误码

| 错误码 | 含义 |
|---|---|
| `UNAUTHENTICATED` | 需要登录 |
| `FORBIDDEN` | 无权访问或操作 |
| `INVALID_ARGUMENT` | 参数或动态字段校验失败 |
| `NOT_FOUND` | 资源不存在或对调用者不可见 |
| `CONFLICT` | 通用版本/并发冲突 |
| `SERVICE_OFFLINE` | 套餐已下架 |
| `SERVICE_PAUSED` | 套餐暂停接单 |
| `SENSITIVE_CONTENT` | 输入包含禁止的敏感信息 |
| `COUPON_NOT_APPLICABLE` | 优惠券不适用 |
| `COUPON_ALREADY_USED` | 优惠券已核销或被其他订单锁定 |
| `PAYMENT_STATUS_CONFLICT` | 当前支付状态不允许操作 |
| `FULFILLMENT_STATUS_CONFLICT` | 当前履约状态不允许操作 |
| `AFTER_SALES_STATUS_CONFLICT` | 当前售后状态不允许操作 |
| `PAYMENT_PENDING` | 支付结果尚未确认 |
| `PAYMENT_AMOUNT_MISMATCH` | 支付通知金额不一致 |
| `DUPLICATE_REQUEST` | 幂等键已处理且请求内容不同 |
| `RATE_LIMITED` | 请求过于频繁 |
| `INTERNAL_ERROR` | 未预期错误，返回追踪号，不泄露内部信息 |

## 12. 幂等与并发

- `order.create`：`userId + idempotencyKey` 唯一；相同请求返回原订单，不同内容返回冲突；
- 支付通知：按微信通知 ID 和交易号去重；
- 退款：按平台退款号和幂等键去重，累计退款不得超过实付；
- 优惠券：锁定、核销、退回与支付状态、履约状态在事务中一致更新；
- 派单和状态变化：校验订单 `version`，成功后加一；
- 消息：业务事件带唯一事件键，避免重复生成同类通知；
- 评价：`orderId` 唯一；
- 投诉：同一订单最多一个未关闭投诉。

## 13. 测试接缝

后续 TDD 只从调用方可见的云函数接口验证行为，不直接断言内部辅助函数：

1. `auth.init`：首次/重复登录与身份隔离；
2. `catalog.home/service.list/service.detail`：上下架、分页和配置变化；
3. `order.quote/create/detail`：服务端计价、快照、敏感输入和幂等；
4. `payment` 通知接口：验签后的金额校验、重复和乱序；
5. `fulfillment.assign/start/submitCompletion`：付款前不可派单和履约状态机；
6. `customer.review.create/complaint.create`：订单归属、资格和暂停自动完成；
7. `admin`：角色权限、敏感字段和审计结果。

这些接缝需要在对应 GitHub Issue 开始实现前再次由云东确认，确认后按一个行为一个红绿循环推进。
