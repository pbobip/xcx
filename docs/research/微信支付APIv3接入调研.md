# 微信支付 APIv3 接入调研

日期：2026-07-28

对应任务：[GitHub Issue #8：接入微信支付、退款与对账](https://github.com/pbobip/xcx/issues/8)

## 一、结论先行

本项目是普通商户、单商户自营小程序，适用微信支付 APIv3 的小程序支付链路。若实际商户号是服务商或平台收付通模式，接口和字段均需重新核对，不能直接套用本文。

1. 小程序只负责调用 `wx.requestPayment`。创建微信支付订单、生成调起支付签名、查单、关单、退款、通知验签解密和对账全部放在可信服务端；前端 `success` 只表示调起支付后的客户端回调成功，不能把业务订单直接改为已支付。官方也明确要求订单状态以服务端查单和支付成功通知为准。[小程序调起支付](https://pay.weixin.qq.com/doc/v3/merchant/4012791898)、[`wx.requestPayment`](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestPayment.html)
2. 新接入优先使用“微信支付公钥”验证 API 应答和回调签名。微信支付公钥无过期时间、官方推荐使用，新申请商户号默认是公钥模式；已有平台证书模式仍可继续使用，但必须实现证书轮换。商户请求签名始终使用商户 API 证书私钥，这三类材料不能混淆。[证书密钥概览](https://pay.weixin.qq.com/doc/v3/merchant/4024350132)、[公钥模式说明](https://pay.weixin.qq.com/doc/v3/merchant/4013053249)、[新商户默认公钥模式说明](https://pay.weixin.qq.com/doc/v3/merchant/4015419357)
3. 支付通知和退款通知必须先以原始 HTTP 请求体验签，再用 APIv3 密钥执行 `AEAD_AES_256_GCM` 解密。通知可能延迟、重复或漏达；服务端要按通知 ID 和微信业务单号双重去重，并用主动查单补偿。[支付成功通知](https://pay.weixin.qq.com/doc/v3/merchant/4012791902)、[退款结果通知](https://pay.weixin.qq.com/doc/v3/merchant/4012791906)
4. 通知要求 5 秒内应答。推荐在 5 秒内完成“验签、解密、业务字段校验、持久化通知/幂等占位”，返回 `200` 或 `204`，再异步执行非关键工作。失败或超时会按官方间隔最多重试 15 次；已处理的重复通知仍应返回成功。[回调处理规则](https://pay.weixin.qq.com/doc/v3/merchant/4012791902)
5. `time_expire` 只是“最后可支付时间”，不会替商户关闭订单。项目的 30 分钟未支付策略必须由定时任务主动查单并调用关单；只有确认微信订单为 `CLOSED` 后，才能释放优惠券或把本地订单置为已关闭。[JSAPI/小程序下单](https://pay.weixin.qq.com/doc/v3/merchant/4012791897)、[关闭订单](https://pay.weixin.qq.com/doc/v3/merchant/4012791901)
6. 退款申请成功只表示微信已受理，不表示退款完成。全额和部分退款都应以退款通知或退款查询中的 `SUCCESS` 为准；同一退款意图重试必须复用 `out_refund_no`，否则有重复退款风险。[退款申请](https://pay.weixin.qq.com/doc/v3/merchant/4012791903)、[查询单笔退款](https://pay.weixin.qq.com/doc/v3/merchant/4012791904)
7. 交易账单和资金账单是最终对账补偿，不是实时订单状态源。账单下载地址仅 5 分钟有效，文件响应不带微信支付签名，下载后必须用申请账单接口返回的 SHA1 校验完整性。[申请交易账单](https://pay.weixin.qq.com/doc/v3/merchant/4012791907)、[申请资金账单](https://pay.weixin.qq.com/doc/v3/merchant/4012791908)、[下载账单](https://pay.weixin.qq.com/doc/v3/merchant/4012791909)
8. 微信支付官方明确说明 APIv3 暂未提供独立沙箱测试环境和测试参数，生产环境也不支持压测。官方提供 Postman 和安全回显接口用于签名、验签、加解密调试，但它们不能替代真实支付、退款和次日账单验收。因此上线前仍需绑定真实商户号，以 1 分或 2 分测试商品完成小额闭环。[最佳安全实践](https://pay.weixin.qq.com/doc/v3/merchant/4012073699)、[Postman 调试工具](https://pay.weixin.qq.com/doc/v3/merchant/4012076519)、[商户签名验签／加解密测试](https://pay.weixin.qq.com/doc/v3/merchant/4014551946)

## 二、适用范围与信任边界

本文按以下前提调研：

- 普通商户，不是服务商、特约商户或平台收付通；
- 微信小程序使用与商户号已绑定的 AppID；
- 用户已通过小程序登录获得该 AppID 下的 OpenID；
- 服务端通过云函数或独立 HTTPS 服务调用微信支付 APIv3；
- 项目内部优惠券已先由服务端报价，微信支付的 `amount.total` 是内部优惠后的最终应付金额；
- 本文只做接入调研，不修改支付功能。

可信链路应固定为：

`服务端锁定订单金额 → APIv3 小程序下单 → 服务端生成调起参数 → 小程序 wx.requestPayment → 验签支付通知/主动查单 → 幂等更新订单 → 退款通知/退款查单 → T+1 账单对账`

只有以下两类结果可以改变付款真值：

- 已验签、已解密、业务字段校验通过的微信支付通知；
- 已验签且业务字段校验通过的微信支付主动查询应答。

前端回调、用户截图、客服口述、HTTP 请求“已发出”、退款接口返回 `200`，都不能单独作为付款或退款完成依据。

## 三、接口与字段核对

### 3.1 JSAPI/小程序下单

接口：`POST /v3/pay/transactions/jsapi`。[官方接口](https://pay.weixin.qq.com/doc/v3/merchant/4012791897)

关键请求字段：

| 字段 | 要求 | 本项目约束 |
|---|---|---|
| `appid` | 必填，且与 `mchid` 有绑定关系 | 只从安全配置读取，不接受前端传入 |
| `mchid` | 必填，普通商户号 | 只从安全配置读取 |
| `description` | 必填，最长 127 字符，应真实代表商品 | 使用订单快照中的服务名称，不写虚假或敏感信息 |
| `out_trade_no` | 必填，6–32 字符，只允许数字、大小写字母及 `_ - \| *`，同一商户号下唯一 | 一个本地支付订单固定一个值，持久化后不得随重试更换 |
| `time_expire` | 选填，RFC 3339；最早为下单后 1 分钟、最晚为 15 天 | 按项目规则设置为下单后 30 分钟；到期后仍要主动关单 |
| `notify_url` | 必填，公网可访问的完整 HTTPS 地址，不得携带参数 | 指向独立支付通知入口，不做登录态校验 |
| `amount.total` | 必填，单位分，整数且大于 0 | 服务端根据订单快照和优惠券重算，绝不接受前端金额 |
| `amount.currency` | 选填，固定 `CNY` | 显式传 `CNY` |
| `payer.openid` | 必填，是该 `appid` 下的用户标识 | 从服务端登录态取得，不接受任意 OpenID |
| `attach` | 选填，最长 128 字符，查单、通知和账单原样返回 | 只放不敏感的关联标识；不得放密钥、手机号、游戏 ID 或备注全文 |

应答只有 `prepay_id`；官方标明有效期为 2 小时。项目订单只允许支付 30 分钟，因此服务端不能因为 `prepay_id` 仍有效就绕过本地订单截止时间。

幂等与失败处理：

- 本地先以业务订单 ID 建立唯一的 `out_trade_no`，再调用微信；网络超时或 `5xx` 时保留原号，先查单，不创建第二个商户订单号。
- 首次下单未支付时，官方允许使用同一 `out_trade_no` 和与首次完全一致的参数再次下单；若更改 AppID、商户号、金额、商品描述或支付接口，则会报商户订单号重复。项目应保存首次请求快照并按原参数重试，不能重新报价后复用旧号。[JSAPI 支付常见问题](https://pay.weixin.qq.com/doc/v3/merchant/4012791869)
- 若旧订单已超过 `time_expire`，官方建议先关单，再用新商户订单号重新下单；新号必须与旧支付记录建立明确关联。
- 预支付参数只能在本地订单仍为未支付且未关闭时返回。已支付、已关闭或金额版本已变化时禁止再次返回旧参数。

### 3.2 服务端生成小程序调起参数

调用 `wx.requestPayment` 所需字段由服务端生成。[小程序调起支付](https://pay.weixin.qq.com/doc/v3/merchant/4012791898)、[调起支付签名](https://pay.weixin.qq.com/doc/v3/merchant/4012365341)

| 字段 | 规则 |
|---|---|
| `timeStamp` | 自 Unix Epoch 起的秒数字符串，不是毫秒 |
| `nonceStr` | 不超过 32 位的随机串 |
| `package` | 固定格式 `prepay_id=***` |
| `signType` | APIv3 仅使用 `RSA` |
| `paySign` | 对 `appId\ntimeStamp\nnonceStr\npackage\n` 使用商户 API 证书私钥做 SHA256 with RSA 签名，再 Base64 编码 |

调起支付使用的 AppID必须与下单时 `appid` 一致；下单签名与调起支付签名使用的商户 API 证书也应一致。商户私钥只能在服务端使用，小程序只接收上述短期参数。

### 3.3 `wx.requestPayment`

小程序调用：[`wx.requestPayment`](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestPayment.html)。APIv3 的 `signType` 必须是 `RSA`。

客户端回调含义：

- `requestPayment:ok`：仅表示客户端调用支付成功返回，可立即触发服务端查单，但不能直接写 `PAID`；
- `requestPayment:fail cancel`：用户取消收银台，不等于取消业务订单，也不等于微信订单已关闭；
- 其他 `fail`：展示失败或“确认中”，保留订单并允许重新查询/支付。

项目页面在任意前端回调后都应查询服务端的云端确认状态。若短时间仍无法确认，保持“支付确认中”，避免重复付款。

### 3.4 商户请求签名与微信支付应答验签

APIv3 所有商户请求都使用商户 API 证书私钥签名。官方签名串为五行，最后一行也必须以换行结束：[请求签名规则](https://pay.weixin.qq.com/doc/v3/merchant/4012365336)。

```text
HTTP_METHOD\n
URL_PATH_AND_QUERY\n
TIMESTAMP\n
NONCE_STR\n
RAW_REQUEST_BODY\n
```

使用 SHA256 with RSA 签名并 Base64 编码，放入：

```text
Authorization: WECHATPAY2-SHA256-RSA2048 mchid="...",nonce_str="...",signature="...",timestamp="...",serial_no="..."
```

`serial_no` 是商户 API 证书序列号，不是微信支付平台证书序列号或微信支付公钥 ID。

微信支付 API 应答和通知回调的验签串均为三行：

```text
Wechatpay-Timestamp\n
Wechatpay-Nonce\n
RAW_RESPONSE_OR_CALLBACK_BODY\n
```

安全要求：

- 必须使用框架尚未反序列化、重排或重新编码的原始请求体/应答体验签；任何字节变化都会导致验签结果失真。
- 读取 `Wechatpay-Serial`，按当前商户验签模式选择对应的微信支付公钥或平台证书。公钥 ID 以 `PUB_KEY_ID_` 开头；未知序列号必须拒绝，不能回退到“不验签”。
- 检查 `Wechatpay-Timestamp` 防重放。官方建议最多允许 5 分钟时间偏差，并用 NTP 保持服务端时钟准确。[平台证书验签](https://pay.weixin.qq.com/doc/v3/merchant/4013053420)
- 验签失败的 API 应答应丢弃；验签失败的通知返回 `4xx` 或 `5xx`。对官方 `WECHATPAY/SIGNTEST/` 签名探测也必须正常验签并拒绝错误签名，不能做白名单绕过。[微信支付公钥验签](https://pay.weixin.qq.com/doc/v3/merchant/4013053249)
- API 调用的 `2xx` 应答也要验签，不能只验通知；账单文件下载是例外，文件响应不含签名，改用 SHA1 校验。

### 3.5 支付成功通知：验签、解密、幂等

通知类型为 `TRANSACTION.SUCCESS`，通知外层关键字段为 `id`、`create_time`、`event_type`、`resource_type`、`resource` 和 `summary`。`resource` 使用 `AEAD_AES_256_GCM`，包含 `ciphertext`、`nonce`、可能为空的 `associated_data`，需用 32 字符 APIv3 密钥解密。[支付成功通知](https://pay.weixin.qq.com/doc/v3/merchant/4012791902)、[回调报文解密](https://pay.weixin.qq.com/doc/v3/merchant/4012071382)

解密后至少核对：

| 字段 | 校验要求 |
|---|---|
| `appid` | 等于当前小程序 AppID |
| `mchid` | 等于当前商户号 |
| `out_trade_no` | 能唯一定位本地未支付/确认中的订单 |
| `transaction_id` | 保存为微信支付订单号，并建立唯一约束 |
| `trade_type` | 本项目应为 `JSAPI` |
| `trade_state` | 支付成功通知应为 `SUCCESS` |
| `amount.total` | 必须等于服务端订单应付金额，单位分 |
| `amount.currency` | 必须为 `CNY` |
| `payer.openid` | 应与该订单支付用户一致 |
| `success_time` | 保存为微信支付成功时间，不以本地接收时间代替 |

金额比较必须使用 `amount.total`，不能误用 `amount.payer_total`。后者是用户在使用微信支付优惠后的实际现金支付金额，可能低于订单总金额。

幂等键和处理顺序：

1. 先校验时间戳和 `Wechatpay-Serial`；
2. 用原始请求体验签；
3. 解析外层通知并用 APIv3 密钥解密；
4. 校验商户、AppID、订单号、金额、币种、支付者和状态；
5. 以通知 `id` 去重，并以 `transaction_id`、`out_trade_no` 建唯一约束，防止不同通知 ID 重复记账；
6. 在数据库事务中只执行一次 `UNPAID/PAYMENT_PENDING → PAID`，同时核销锁定优惠券、写支付记录和订单日志；
7. 持久化完成后返回 `200` 或 `204`；消息推送等非关键副作用异步执行，且也要带幂等键。

微信支付要求 5 秒内应答。失败或超时会按 `15s/15s/30s/3m/10m/20m/30m/30m/30m/60m/3h/3h/3h/6h/6h` 重试，最多 15 次。相同通知已处理时仍应返回成功。商户不能只依赖通知，必须结合查单补偿。

`notify_url` 必须是公网可访问的完整 HTTPS 地址，不能带参数，也不能依赖用户登录态。若经过 CDN、WAF 或反向代理，必须确认不会过滤 `Wechatpay-*` 请求头、修改原始请求体或阻断微信回调。[回调通知注意事项](https://pay.weixin.qq.com/doc/v3/merchant/4012075420)

### 3.6 主动查单

未支付订单只能按商户订单号查询：`GET /v3/pay/transactions/out-trade-no/{out_trade_no}?mchid=...`；支付成功后也可按 `transaction_id` 查询。[商户订单号查询](https://pay.weixin.qq.com/doc/v3/merchant/4012791900)、[微信支付订单号查询](https://pay.weixin.qq.com/doc/v3/merchant/4012791899)

关键应答字段为 `appid`、`mchid`、`out_trade_no`、支付成功后出现的 `transaction_id`、`trade_type`、`trade_state`、`success_time`、`payer` 和 `amount`。应答必须先验签，再做与支付通知相同的商户、订单和金额校验。

官方交易状态：

| `trade_state` | 官方含义 | 本项目处理 |
|---|---|---|
| `SUCCESS` | 支付成功 | 幂等确认 `PAID` |
| `REFUND` | 转入退款 | 不能直接认定“已全额退款”；结合退款单和成功退款累计金额 |
| `NOTPAY` | 未支付 | 保持未支付；到期时进入关单流程 |
| `CLOSED` | 已关闭 | 关闭本地订单并按规则释放优惠券 |
| `REVOKED` | 已撤销，仅付款码支付 | 小程序链路不应出现，记录异常并人工核对 |
| `USERPAYING` | 用户支付中，仅付款码支付 | 小程序链路不应出现，不擅自推进状态 |
| `PAYERROR` | 支付失败，仅付款码支付 | 小程序链路不应出现，记录异常并人工核对 |

主动查单触发点：

- `wx.requestPayment` 的成功、取消和失败回调之后；
- 前端轮询支付结果时；
- 预支付请求超时或 API 应答验签失败后；
- 未支付订单即将超时时；
- 已超过截止时间准备关单前；
- 支付通知延迟、遗漏或业务处理失败时；
- 每日账单发现本地与微信不一致时。

微信支付官方《支付回调和查单实现指引》给出的一种轮询示例是下单后 `5 秒、30 秒、1 分钟、3 分钟、5 分钟、10 分钟、30 分钟` 查单；另一种后台方案是每 30 秒扫描最近 10 分钟的未支付订单，查询 10 次仍未成功后停止查询并关单。项目可结合 30 分钟超时策略调整调度，但必须保留退避、停止条件和关单前的最后一次查单。[支付回调和查单实现指引](https://pay.weixin.qq.com/doc/v3/merchant/4012075249)

网络失败、`5xx`、应答签名失败或无法匹配订单都属于“未知”，不得当作未支付或已关闭。

查单返回 `ORDER_NOT_EXIST` 也不等于订单已关闭。它只说明当前商户订单号在微信侧不存在，应核对商户号、订单号和预支付调用记录；在无法证明下单从未成功前，仍按未知结果处理。

### 3.7 超时关单

接口：`POST /v3/pay/transactions/out-trade-no/{out_trade_no}/close`，请求体只需 `mchid`，成功返回 `204 No Content`。[关闭订单](https://pay.weixin.qq.com/doc/v3/merchant/4012791901)

官方只允许关闭未支付订单，典型场景包括用户主动取消业务订单和订单超时未支付。`time_expire` 到期并不自动执行关单。

官方常见问题明确说明关单接口支持重入，因此相同 `out_trade_no` 的重复关单应保持本地幂等；仍需正确处理已支付、订单不存在和网络结果未知等分支。[JSAPI 支付常见问题](https://pay.weixin.qq.com/doc/v3/merchant/4012791869)

项目关单流程：

1. 30 分钟定时任务锁定本地订单，先按 `out_trade_no` 查单；
2. `SUCCESS`：确认支付，禁止关单和退券；
3. `CLOSED`：幂等关闭本地订单并释放优惠券；
4. `NOTPAY`：调用关单；
5. 关单返回 `204` 后再次查单或将已验证的关单结果作为关闭依据；
6. 关单超时、`5xx` 或 `TRADE_ERROR`：保持确认中并再次查单，不能先释放优惠券。

支付成功与关单可能并发。状态更新必须以微信的最终交易状态和数据库条件更新为准，不能让迟到的“本地超时任务”覆盖已经确认的支付成功。

### 3.8 全额和部分退款

接口：`POST /v3/refund/domestic/refunds`。支付成功后 365 天内可以申请全部或部分原路退款；一笔订单最多支持 50 次部分退款，多次部分退款需更换 `out_refund_no`，并间隔至少 1 分钟。[退款申请](https://pay.weixin.qq.com/doc/v3/merchant/4012791903)

关键请求字段：

| 字段 | 要求 |
|---|---|
| `transaction_id` / `out_trade_no` | 二选一，推荐保存并优先使用微信支付订单号 |
| `out_refund_no` | 必填，最长 64 字节，只允许数字、大小写字母及 `_ - \| * @`，商户系统内唯一；同一退款号多次请求只退一笔 |
| `reason` | 选填，最长 80 字节，会展示给用户 |
| `notify_url` | 选填，公网 HTTPS 且不能带参数；传入后优先于商户平台配置 |
| `amount.refund` | 本次退款金额，单位分，整数，不得超过原订单支付金额 |
| `amount.total` | 原支付订单总金额，单位分 |
| `amount.currency` | 固定 `CNY` |
| `goods_detail` | 仅指定商品退款时传，并与下单商品明细一致 |

项目还必须在本地事务中校验“已成功退款金额 + 本次申请金额 ≤ 原订单金额”，并锁定待退款额度，防止两个并发退款分别通过检查。

退款幂等要求：

- 一个业务退款意图固定一个 `out_refund_no`；网络超时、`5xx` 或重试时必须复用原退款号和原参数。
- 不得因为“没有收到退款通知”生成新退款号。先查询原退款号；官方也明确警告更换退款号可能导致重复退款资金损失。
- 退款申请接口返回成功仅表示受理成功，保存 `refund_id` 和当前 `status`，但只有 `SUCCESS` 才累计成功退款金额。
- 全额退款条件是“所有成功退款单的 `amount.refund` 累计等于原订单 `amount.total`”，而不是支付订单查询出现 `REFUND` 就直接判定全额退款。

退款状态：

| 状态 | 含义 | 处理 |
|---|---|---|
| `PROCESSING` | 退款处理中 | 保持待确认，继续查单 |
| `SUCCESS` | 退款成功 | 幂等累计成功退款金额，计算部分/全额退款 |
| `CLOSED` | 退款关闭 | 释放该退款意图锁定的待退款额度，不累计成功金额 |
| `ABNORMAL` | 退款异常 | 不认定成功；进入人工处理或异常退款流程 |

查询接口：`GET /v3/refund/domestic/refunds/{out_refund_no}`。官方建议开始时每 1 分钟查询一次；超过 5 分钟仍为处理中后，按 5、10、20、30 分钟等间隔逐步衰减。零钱退款通常 5 分钟内到账，银行卡通常 1–3 个工作日。[查询单笔退款](https://pay.weixin.qq.com/doc/v3/merchant/4012791904)

### 3.9 退款结果通知

退款状态变为成功、关闭或异常时，微信会通知：

- `REFUND.SUCCESS`
- `REFUND.CLOSED`
- `REFUND.ABNORMAL`

通知验签、5 秒应答、最多 15 次重试、AES-256-GCM 解密规则与支付通知相同。[退款结果通知](https://pay.weixin.qq.com/doc/v3/merchant/4012791906)

解密后至少校验 `mchid`、`out_trade_no`、`transaction_id`、`out_refund_no`、`refund_id`、`refund_status` 和 `amount.total/refund/payer_total/payer_refund`。

幂等和乱序处理：

- 以通知 `id` 去重，以 `refund_id` 和 `out_refund_no` 建唯一约束；
- `PROCESSING` 不能覆盖已知终态；迟到的重复终态只返回成功，不重复累计金额或发送消息；
- 收到无法解释的状态倒退、金额变化或订单映射冲突时，暂停本地状态推进，主动查询退款单并记录审计告警；
- 退款通知可能早于本地支付通知的业务处理完成，处理器应按 `out_trade_no/transaction_id` 关联或先持久化待处理事件，不能丢弃；
- `payer_refund` 是用户实际收到的现金金额，可能因微信支付优惠与 `amount.refund` 不同。业务退款进度应使用订单口径的 `amount.refund`，同时保存现金到账口径供客服和财务解释。

### 3.10 交易账单、资金账单和文件下载

交易账单：`GET /v3/bill/tradebill`。[申请交易账单](https://pay.weixin.qq.com/doc/v3/merchant/4012791907)

| 参数 | 规则 |
|---|---|
| `bill_date` | 必填，`yyyy-MM-dd`，仅可申请三个月内账单 |
| `bill_type` | `ALL`、`SUCCESS`、`REFUND`，默认 `ALL` |
| `tar_type` | 可选 `GZIP`，不传则返回未压缩文件 |

交易账单通常在次日 10 点后获取，只包含支付成功订单；退款明细记录发起退款成功时的快照，出账后退款状态不会更新，最新退款结果仍要查退款单。账单金额字段单位是“元”，与 API 请求/通知的“分”不同，解析时必须使用十进制定点金额，不能用浮点数。

资金账单：`GET /v3/bill/fundflowbill`。[申请资金账单](https://pay.weixin.qq.com/doc/v3/merchant/4012791908)

| 参数 | 规则 |
|---|---|
| `bill_date` | 必填，`yyyy-MM-dd`，仅可申请三个月内账单 |
| `account_type` | `BASIC`、`OPERATION`、`FEES`，默认 `BASIC` |
| `tar_type` | 可选 `GZIP` |

资金账单记录账户资金变动、业务单号、收支金额、记账时间和余额，建议次日 10 点后申请；官方给出的商户号维度频率限制为 3 QPS。

两类申请接口都返回：

- `hash_type`：固定 `SHA1`；
- `hash_value`：账单文件摘要；
- `download_url`：仅 5 分钟有效。

下载步骤：[下载账单](https://pay.weixin.qq.com/doc/v3/merchant/4012791909)

1. 对完整 `download_url` 的路径和查询串按 APIv3 规则签名；
2. 在 5 分钟内下载文件；
3. 文件下载响应不含 `Wechatpay-Signature`，因此不能走普通应答验签；
4. 解压后计算 SHA1，与申请接口返回的 `hash_value` 比对；不一致则丢弃文件并重新申请；
5. 按 `out_trade_no`、`transaction_id`、`out_refund_no`、`refund_id` 与本地流水核对，差异进入可重跑的对账任务和人工告警。

账单状态和错误处理：

- `NO_STATEMENT_EXIST`：指定日期没有对应交易、退款或资金变动，记录“无账单”结果，不无限重试；
- `STATEMENT_CREATING`：账单仍在生成，次日 10 点后退避重试；
- `FREQUENCY_LIMITED`：降低频率，资金账单尤其不得超过官方 3 QPS 限制；
- 下载时 `INVALID_REQUEST`：下载地址可能过期，重新申请新的 `download_url`；
- 下载时 `NO_AUTH`：申请账单和下载账单的商户身份不一致，停止处理并告警。

### 3.11 跨接口 HTTP 状态与重试原则

- `2xx`：先验证微信应答签名和业务字段，再提交本地状态；退款申请的 `200` 仍只代表受理。
- `400`：按返回错误码修正参数或业务前置条件，不盲目重试；`OUT_TRADE_NO_USED` 先查原订单，不能换号再次扣款。
- `401 SIGN_ERROR`：停止业务推进，检查签名串、商户证书私钥与序列号、时钟和原始 body；不能降级为免验签。
- `403`：权限或业务规则限制，记录 Request-ID 并由商户管理员核对产品权限和交易状态。
- `404 ORDER_NOT_EXIST/RESOURCE_NOT_EXISTS`：核对商户号和业务单号，不把不存在误判为关闭或退款成功。
- `429 FREQUENCY_LIMITED`：指数退避并加随机抖动，不生成新的商户订单号或退款单号。
- `500 SYSTEM_ERROR`、连接超时或连接中断：结果未知；以相同业务参数和相同幂等单号查单/重试，绝不创建第二笔资金意图。

以上错误码定义分别见[小程序下单](https://pay.weixin.qq.com/doc/v3/merchant/4012791897)、[商户订单号查单](https://pay.weixin.qq.com/doc/v3/merchant/4012791900)、[关闭订单](https://pay.weixin.qq.com/doc/v3/merchant/4012791901)、[退款申请](https://pay.weixin.qq.com/doc/v3/merchant/4012791903)和[账单接口](https://pay.weixin.qq.com/doc/v3/merchant/4012791907)。

## 四、本地状态、幂等与乱序约束

### 4.1 建议的支付真值映射

| 本地状态 | 可靠进入条件 | 禁止做法 |
|---|---|---|
| `UNPAID` | 本地建单成功，微信查单为 `NOTPAY` 或尚未下单 | 不能因前端取消直接关闭 |
| `PAYMENT_PENDING` | 已发起预支付但可靠结果未知 | 不能显示为已支付或重复生成新支付单 |
| `PAID` | 已验签通知或查单为 `SUCCESS`，且金额/商户/订单校验通过 | 不能由 `wx.requestPayment success` 直接进入 |
| `PARTIALLY_REFUNDED` | 成功退款累计金额大于 0 且小于订单总额 | 不能由退款申请已受理进入 |
| `REFUNDED` | 成功退款累计金额等于订单总额 | 不能只凭支付查询的 `REFUND` 进入 |
| `CLOSED` | 关单成功或查单明确为 `CLOSED` | 不能因本地超时直接进入 |

外部调用的网络失败、超时、应答验签失败、未知序列号、金额不匹配和状态冲突都进入“确认中/人工核对”，不把未知强行映射成失败。

### 4.2 幂等键

| 业务 | 主幂等键 | 次级唯一约束 |
|---|---|---|
| 预支付 | 本地订单 ID / `out_trade_no` | 同一订单同一金额版本只存在一个有效支付记录 |
| 支付通知 | 通知 `id` | `transaction_id` 唯一，`out_trade_no` 唯一映射 |
| 查单同步 | `out_trade_no + trade_state + transaction_id` | 条件状态更新，重复同步无副作用 |
| 关单 | `out_trade_no` | 只允许未支付状态执行 |
| 退款申请 | 业务退款 ID / `out_refund_no` | `refund_id` 唯一；并发锁定剩余可退款金额 |
| 退款通知 | 通知 `id` | `refund_id`、`out_refund_no` 唯一 |
| 账单 | `bill_date + bill_type/account_type + tar_type` | `hash_value` 校验和归档版本 |

### 4.3 必须覆盖的乱序场景

微信支付官方文档明确承诺通知可能重复，并要求主动查单补偿，但没有承诺支付通知、退款通知与查询结果按业务发生顺序抵达。以下规则是依据官方状态含义和重复投递机制推导出的项目工程约束，不是对微信通知顺序的额外假设。

1. 前端先返回 `success`，支付通知稍后到：页面显示确认中并主动查单，通知和查单谁先确认都只推进一次。
2. 前端返回 `cancel`，但用户实际已扣款：不能取消订单；查单/通知最终推进为已支付。
3. 30 分钟关单任务与支付成功同时发生：先查单；关单失败或结果未知时不释放券，支付成功具有优先保护。
4. 同一支付通知重复 15 次：只首次记账、核券和发消息，其余直接成功应答。
5. 不同通知 ID 指向同一 `transaction_id`：以微信交易号唯一约束阻止重复记账。
6. 退款通知早于支付通知业务落库：先持久化退款事件或按微信订单号补查，不丢弃、不创建孤立退款。
7. 退款 `SUCCESS` 后收到迟到的 `PROCESSING` 查询结果：终态不回退；重新查退款并记录异常。
8. 两个部分退款并发：在本地事务中锁定剩余可退款额度，避免累计超过订单总金额。
9. T+1 交易账单中的退款状态已过时：账单只用于发现差异，最终状态再调用退款查询确认。

## 五、密钥、证书和敏感配置管理

### 5.1 材料用途

| 材料 | 是否秘密 | 用途与约束 |
|---|---|---|
| 商户 API 证书私钥 `apiclient_key.pem` | 是 | 商户请求和小程序 `paySign` 的 RSA 签名；绝不进入小程序、Git、数据库普通字段或日志 |
| 商户 API 证书序列号 | 否，但需与私钥成对 | 写入 `Authorization.serial_no`；轮换时与私钥一起替换 |
| APIv3 密钥 | 是 | 解密支付/退款通知和平台证书；32 位字母数字串，不支持找回，只能重设 |
| 微信支付公钥 `pub_key.pem` 与公钥 ID | 公钥本身非秘密，但需保证完整性 | 验证微信支付应答和通知签名；新接入推荐 |
| 微信支付平台证书 | 公钥证书非秘密，但需保证完整性 | 公钥模式的替代方案；有 5 年有效期，需平滑轮换 |
| `mchid`、小程序 AppID | 不是密钥 | 固定服务端配置；仍不可由前端任意覆盖 |
| OpenID、微信订单号、账单文件 | 业务敏感数据 | 最小权限读取、脱敏日志、按财务和隐私期限保存 |

官方说明商户 API 证书和平台证书有效期均为 5 年；商户 API 证书最多 3 份同时生效；微信支付公钥无过期时间且官方推荐。APIv3 密钥只用于解密，不用于商户请求签名。[证书密钥概览](https://pay.weixin.qq.com/doc/v3/merchant/4024350132)、[配置 APIv3 密钥](https://pay.weixin.qq.com/doc/v3/merchant/4012072195)

### 5.2 部署和轮换要求

- 私钥和 APIv3 密钥只放在服务端密钥管理或受保护的运行时配置中，按最小权限授予支付云函数；不在后台页面回显。
- 公钥/平台证书使用只读部署，保存序列号或公钥 ID 到密钥映射；未知 `Wechatpay-Serial` 一律拒绝并告警。
- 日志只记录请求 ID、商户订单号、微信订单号、状态码和脱敏错误；不记录私钥、APIv3 密钥、完整 `Authorization`、原始账单、完整 OpenID 或支付通知密文/明文。
- 商户 API 证书到期前申请新证书，私钥和序列号一起切换，观察旧证书昨日调用量为 0 后再作废。官方支持最多 3 份证书并行，适合灰度切换。[申请商户 API 证书](https://pay.weixin.qq.com/doc/v3/merchant/4012072428)
- APIv3 密钥重设会影响全部回调和平台证书解密，必须先协调停机/双环境部署和验证，不可由运营人员直接修改。
- 若商户当前仍是平台证书模式，需在过期前完成新旧证书共存和按 `Wechatpay-Serial` 选证书验签；若切换公钥模式，切换灰度期间同时支持平台证书和公钥验签。
- 怀疑泄露时立即作废商户 API 证书或重设 APIv3 密钥，同时排查日志、CI、构建产物和历史提交。官方明确禁止把证书/密钥上传 GitHub 或写入前端代码。

截至调研日，可核验的微信支付官方 GitHub 组织提供 [Java](https://github.com/wechatpay-apiv3/wechatpay-java)、[Go](https://github.com/wechatpay-apiv3/wechatpay-go)、[PHP](https://github.com/wechatpay-apiv3/wechatpay-php) SDK 和官方工具。当前项目若继续使用 Node.js 云函数，应严格按官方 API 规则实现或选择经专项审计的适配层，并用官方安全回显接口验证签名、验签和解密；不能因没有直接套用的官方 Node SDK 而省略验签。

## 六、测试环境限制与验收方案

### 6.1 能离线或无资金验证的内容

- 使用官方文档示例和固定测试密钥验证请求签名串、调起支付签名串、回调验签串的换行和 Base64 结果；
- 使用官方 `POST /v3/security/echo` 验证商户签名、微信应答验签、公钥/平台证书加密、APIv3 密钥解密和可选回调接收；一次调用不能混用公钥和平台证书模式。[安全回显接口](https://pay.weixin.qq.com/doc/v3/merchant/4014551946)
- 使用官方 Postman 集合调试 APIv3 请求。私钥变量必须用私有工作区、`secret` 类型和仅本地 `Current Value`，不能上传公共工作区。[Postman 调试工具](https://pay.weixin.qq.com/doc/v3/merchant/4012076519)
- 用本地合同测试模拟正确签名、错误签名、过期时间戳、未知序列号、密文篡改、错误 APIv3 密钥、重复通知、不同通知 ID 同交易号、乱序和数据库事务重试。

这些测试能证明协议实现和业务状态机，但不能证明 AppID/商户号绑定、支付权限、真实扣款、原路退款、回调公网链路和账单出账正常。

### 6.2 官方环境限制的实施结论

- 微信支付官方明确写明：“APIv3 暂未提供独立的沙箱测试环境和测试参数”，且“生产环境不支持压测”。测试必须限制频率和资金风险，不能用真实商户做负载测试。[最佳安全实践](https://pay.weixin.qq.com/doc/v3/merchant/4012073699)
- 微信支付没有线上支付回调测试接口；官方建议在生产环境通过真实支付验证回调地址。`/v3/security/echo` 只能验证安全协议，不能模拟支付成功或退款资金流。[JSAPI 支付常见问题](https://pay.weixin.qq.com/doc/v3/merchant/4012791869)
- 官方 JSAPI 常见问题要求支付不要在模拟器中发起，应使用真机。小程序真实验收也应在实际微信客户端、已绑定 AppID 和真实商户号下完成，不能把开发者工具里的页面流程当作支付验收。
- `wx.requestPayment` 需要小程序在公众平台申请接入微信支付，AppID 必须与下单 AppID 一致且与商户号绑定。
- 交易类小程序还需满足公众平台交易类小程序运营规范和订单发货管理要求，否则正式环境的小程序支付权限可能受限。[小程序调起支付](https://pay.weixin.qq.com/doc/v3/merchant/4012791898)
- API 下单最小金额是大于 0 的整数分，因此 1 分可作为最小真实支付用例；部分退款闭环至少使用 2 分订单。
- 交易账单次日生成，账单验收天然是 T+1，无法在支付当刻完成。

### 6.3 真实小额验收清单

1. **配置验收**：确认商户号、AppID 绑定、微信支付产品权限、公钥模式或平台证书模式、APIv3 密钥、商户 API 证书、HTTPS 支付/退款通知地址均有效。
2. **未支付与关单**：创建 1 分订单，用户取消收银台；确认前端取消不改支付真值，查单为 `NOTPAY`，超时后关单为 `CLOSED`，优惠券只退回一次。
3. **支付成功**：创建 1 分订单完成真实付款；验证 `wx.requestPayment` 返回、支付通知、主动查单、`transaction_id`、金额和支付时间一致，只产生一次支付记录、券核销和消息。
4. **重复与延迟**：用保存的脱敏通知夹具在测试环境重复触发业务处理，覆盖同通知 ID、不同通知 ID 同交易号、查单先到/通知后到；所有副作用仍为一次。
5. **签名失败**：篡改原始 body、时间戳、签名和 `Wechatpay-Serial`，确认全部拒绝且不会写订单状态；正常探测前缀也不能绕过验签。
6. **全额退款**：对一笔 1 分已支付订单申请 1 分退款；重复使用同一 `out_refund_no`，确认只退一次，并以通知/查询 `SUCCESS` 后更新为全额退款。
7. **部分退款**：创建 2 分订单，先退 1 分，至少间隔 1 分钟后用新 `out_refund_no` 再退 1 分；第一次为部分退款，累计成功金额等于 2 分后才为全额退款。
8. **乱序退款**：覆盖退款通知先到、查询先到、迟到 `PROCESSING`、重复 `SUCCESS` 和 `ABNORMAL/CLOSED`，不重复累计、不回退终态。
9. **关单竞态**：在订单截止附近并发支付与关单，确认已付款订单不会被关闭或退券，未知结果保持确认中并查单。
10. **T+1 对账**：次日 10 点后申请 `ALL` 交易账单和 `BASIC` 资金账单，在 5 分钟内下载、验 SHA1，核对支付、退款、手续费和资金余额；退款快照不一致时再查退款单。

真实验收要使用专用测试商品、测试顾客和清晰的订单备注，金额最小化，但资金仍是真实扣付和原路退回。不要用生产顾客订单制造失败、异常或并发场景。

## 七、实施前仍需用户提供或确认的商户资料

以下资料属于 Issue #8 的外部前置条件。敏感项不要粘贴到聊天、GitHub Issue、代码仓库或普通数据库，应由商户超级管理员/安全联系人直接写入生产密钥管理：

1. 商户模式确认：普通直连商户，还是服务商/特约商户/平台收付通；本文默认普通直连商户。
2. 微信支付商户号 `mchid`，以及已与该商户号绑定的小程序 AppID。
3. 小程序微信支付产品权限和当前可用状态；若属于交易类小程序，还需确认订单发货管理等平台要求已满足。
4. 商户 API 证书序列号，以及对应的 `apiclient_key.pem` 私钥文件；私钥仅由授权人员写入密钥管理。
5. 已设置的 32 位 APIv3 密钥；若未设置，需由超级管理员与技术负责人共同设置。
6. 当前验签模式：推荐提供微信支付公钥文件和 `PUB_KEY_ID_...`；若仍用平台证书，则提供当前有效证书集合及序列号，并确认轮换计划。
7. 公网可访问的 HTTPS 域名与最终路径：支付通知 URL、退款通知 URL；同时确认 CDN/WAF/防火墙不会修改请求体或过滤 `Wechatpay-*` 头。
8. 有权进行真实小额支付的测试微信号、小程序体验版/正式版访问权限，以及可执行退款的商户管理员。
9. 真实小额验收预算与授权：至少允许 1 分全额退款订单和 2 分两次部分退款订单，并允许等待 T+1 账单验收。
10. 退款资金账户和可用余额条件、财务对账负责人、异常退款人工处理负责人。
11. 支付通知、退款通知和账单数据的合规保存期限、财务访问权限与告警接收人。

在以上资料未齐前，可以实现并验证本地状态机、签名夹具、通知幂等和错误处理，但不能宣称真实支付、退款或对账已经验收通过。

## 八、官方资料索引

### 小程序支付链路

- [JSAPI/小程序下单](https://pay.weixin.qq.com/doc/v3/merchant/4012791897)
- [小程序调起支付](https://pay.weixin.qq.com/doc/v3/merchant/4012791898)
- [`wx.requestPayment`](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestPayment.html)
- [JSAPI 支付常见问题](https://pay.weixin.qq.com/doc/v3/merchant/4012791869)
- [商户订单号查询订单](https://pay.weixin.qq.com/doc/v3/merchant/4012791900)
- [支付回调和查单实现指引](https://pay.weixin.qq.com/doc/v3/merchant/4012075249)
- [关闭订单](https://pay.weixin.qq.com/doc/v3/merchant/4012791901)
- [支付成功回调通知](https://pay.weixin.qq.com/doc/v3/merchant/4012791902)

### 退款与账单

- [退款申请](https://pay.weixin.qq.com/doc/v3/merchant/4012791903)
- [查询单笔退款](https://pay.weixin.qq.com/doc/v3/merchant/4012791904)
- [退款结果回调通知](https://pay.weixin.qq.com/doc/v3/merchant/4012791906)
- [申请交易账单](https://pay.weixin.qq.com/doc/v3/merchant/4012791907)
- [申请资金账单](https://pay.weixin.qq.com/doc/v3/merchant/4012791908)
- [下载账单](https://pay.weixin.qq.com/doc/v3/merchant/4012791909)

### 签名、验签与密钥

- [APIv3 如何签名和验签](https://pay.weixin.qq.com/doc/v3/merchant/4012365342)
- [Body 请求签名规则](https://pay.weixin.qq.com/doc/v3/merchant/4012365336)
- [小程序调起支付签名](https://pay.weixin.qq.com/doc/v3/merchant/4012365341)
- [微信支付公钥验签](https://pay.weixin.qq.com/doc/v3/merchant/4013053249)
- [新商户默认公钥模式说明](https://pay.weixin.qq.com/doc/v3/merchant/4015419357)
- [平台证书验签](https://pay.weixin.qq.com/doc/v3/merchant/4013053420)
- [回调报文和平台证书解密](https://pay.weixin.qq.com/doc/v3/merchant/4012071382)
- [证书密钥概览](https://pay.weixin.qq.com/doc/v3/merchant/4024350132)
- [配置 APIv3 密钥](https://pay.weixin.qq.com/doc/v3/merchant/4012072195)
- [申请商户 API 证书](https://pay.weixin.qq.com/doc/v3/merchant/4012072428)
- [回调通知注意事项](https://pay.weixin.qq.com/doc/v3/merchant/4012075420)
- [最佳安全实践](https://pay.weixin.qq.com/doc/v3/merchant/4012073699)

### 官方工具和 SDK

- [商户签名验签／加解密测试](https://pay.weixin.qq.com/doc/v3/merchant/4014551946)
- [Postman 调试工具](https://pay.weixin.qq.com/doc/v3/merchant/4012076519)
- [微信支付 APIv3 官方 GitHub 组织](https://github.com/wechatpay-apiv3)
- [微信支付 APIv3 Java SDK](https://github.com/wechatpay-apiv3/wechatpay-java)
- [微信支付 APIv3 Go SDK](https://github.com/wechatpay-apiv3/wechatpay-go)
- [微信支付 APIv3 PHP SDK](https://github.com/wechatpay-apiv3/wechatpay-php)
