# 云函数目录

本项目使用微信云开发，默认环境为：

`cloud1-d5gmfvq70c644d633`

后续新增云函数时，每个云函数放在本目录下的独立子目录中，例如：

```text
cloudfunctions/
  login/
    index.js
    package.json
```

在微信开发者工具中右键云函数目录，可选择“上传并部署：云端安装依赖”。

## `auth` 身份云函数

`auth` 通过微信云函数上下文取得可信 `OPENID`，支持动作：

- `init`：首次登录在同一数据库事务内建立顾客并生成注册成功系统消息；重复登录返回同一顾客。

部署前在开发环境建立：

- `users` 集合：`openid`、`platformUserNo` 使用唯一索引；
- `messages` 集合：建立 `userId + isRead + createdAt` 查询索引；
- 两个集合均设置为仅云函数可读写。

然后右键 `cloudfunctions/auth`，选择“上传并部署：云端安装依赖”。

## `catalog` 目录云函数

`catalog` 向访客提供经过上下架过滤的公开目录，支持动作：

- `home`：有效横幅、最新服务、推荐位和首批服务套餐；
- `game.list`、`category.list`：已启用游戏与专区；
- `service.list`、`service.detail`：服务套餐分页列表与详情；
- `search`：按关键词、游戏或专区搜索服务套餐。

目录集合为 `games`、`service_types`、`categories`、`services`、`banners`、`recommendations`，全部设置为仅云函数可读写。开发测试内容以仓库根目录的 `docs/seed-data.md` 为准；暂停套餐可以浏览但不可下单，下架和草稿内容不会返回给顾客端。

部署方式与 `auth` 相同：右键 `cloudfunctions/catalog`，选择“上传并部署：云端安装依赖”。

## `order` 服务订单云函数

`order` 使用可信微信身份处理当前套餐计价和真实建单，支持动作：

- `quote`：重新读取启用套餐，以整数分计算 `priceCents × quantity`；
- `create`：重新计价、校验套餐动态字段和敏感输入，在事务内创建未付款服务订单与创建日志，并以 `userId + idempotencyKey` 防止重复建单。

部署前建立 `orders`、`order_logs` 集合并设置为仅云函数可读写。`orders` 至少建立 `orderNo` 唯一索引和 `userId + idempotencyKey` 唯一索引。然后右键 `cloudfunctions/order`，选择“上传并部署：云端安装依赖”。

## `catalog-dev-seed` 开发模拟数据初始化

`catalog-dev-seed` 只用于开发环境补充六款游戏的模拟套餐。调用时必须传入：

```json
{
  "confirmToken": "ISSUE_4_HOME_SEARCH_SEED"
}
```

它使用固定文档 ID 写入 11 个模拟套餐，刷新原有 4 个无畏契约套餐的开发合规标记与复合搜索文本，更新 3 个互不重复的首页推荐位，并写入 1 条原创开发横幅，因此可以重复执行且不会产生重复记录。15 个套餐统一标记 `isTest = true`，销量和评价统计保持为空或零。

只可将该函数临时部署到开发环境 `cloud1-d5gmfvq70c644d633`。执行成功并通过 `catalog` 读取验收后，应立即从云端删除该函数；源代码保留在仓库中用于重新初始化。正式环境不得部署或调用。

## `payment` 微信支付云函数

`payment` 按普通直连商户模式接入微信支付 APIv3，提供：

- `prepay.create`、`query`、`close`；
- `refund.request`、`refund.query`；
- `reconcile.daily`；
- 独立的 `/payment/notify` 与 `/refund/notify` HTTPS 路径。

部署前建立 `payment_records`、`refund_records`、`reconciliation_records` 集合并设置为仅云函数可读写，同时按 `docs/database.md` 建立唯一索引。通知路径必须保留原始 HTTP Body，不能先解析再重新序列化。

以下配置必须由授权人员直接写入云端安全配置，不得提交到版本库、普通数据库或前端：

- `WECHAT_PAY_MCHID`
- `WECHAT_PAY_MERCHANT_SERIAL_NO`
- `WECHAT_PAY_PRIVATE_KEY`
- `WECHAT_PAY_API_V3_KEY`
- `WECHAT_PAY_PUBLIC_KEY_ID`
- `WECHAT_PAY_PUBLIC_KEY`
- `WECHAT_PAY_NOTIFY_URL`
- `WECHAT_REFUND_NOTIFY_URL`

可选的 `WECHAT_PAY_APPID` 默认使用项目 AppID `wx373cd5ed5680a30d`。正式配置缺失时云函数会拒绝启动真实支付，不会回退到测试付款。
