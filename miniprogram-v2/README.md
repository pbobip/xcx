# 爆爆熊电竞 · 微信小程序 V2

由 `D:\脚本\xcx\小程序原型设计` 中的 17 个 HTML 产品页面转换而来。项目使用原生微信小程序页面、原生顶部导航和原生四栏 TabBar，不保留 Web 手机壳、假状态栏或手写底部主导航。

## 导入

1. 打开微信开发者工具并导入本目录。
2. 默认使用 `touristappid`；接入真实登录、客服和支付前再替换为正式 AppID。
3. 编译入口为 `pages/login/login`。

## 页面映射

- `login.html` → `pages/login/login`
- `home.html` → `pages/home/home`
- `categories.html` → `pages/categories/categories`
- `messages.html` → `pages/messages/messages`
- `profile.html` → `pages/profile/profile`
- 其余搜索、服务、下单、支付、订单、优惠券、投诉、设置、余额和邀请页面均按 HTML 文件名一一映射到 `pages/<name>/<name>`。

## 原型边界

- 搜索、筛选、消息和表单使用本地数据与本地存储。
- 客服、剪贴板、图片选择和分享使用小程序原生能力。
- 微信登录与微信支付需要后端，当前只保留前端流程和清晰的接入边界。
- 商品、订单、退款、评价和投诉不是线上真实数据。
