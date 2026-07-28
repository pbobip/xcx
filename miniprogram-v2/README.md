# 爆爆熊电竞 · 微信小程序 V2

由 `D:\脚本\xcx\小程序原型设计` 中的 17 个 HTML 产品页面转换而来。项目使用原生微信小程序页面、原生顶部导航和原生四栏 TabBar，不保留 Web 手机壳、假状态栏或手写底部主导航。

## 导入

1. 打开微信开发者工具并导入本目录。
2. 项目已配置正式 AppID 与云开发环境，导入后确认环境为 `cloud1-d5gmfvq70c644d633`。
3. 编译入口为 `pages/home/home`，访客可以先浏览，受保护操作再进入微信登录。

## 页面映射

- `login.html` → `pages/login/login`
- `home.html` → `pages/home/home`
- `categories.html` → `pages/categories/categories`
- `messages.html` → `pages/messages/messages`
- `profile.html` → `pages/profile/profile`
- 其余搜索、服务、下单、支付、订单、优惠券、投诉、设置、余额和邀请页面均按 HTML 文件名一一映射到 `pages/<name>/<name>`。

## 原型边界

- 首页、游戏、专区、搜索和服务套餐已经接入 `catalog` 云函数及真实云端测试数据；运营修改云端目录后不需要重新发布小程序。
- 确认订单已接入 `order` 云函数，使用当前云端套餐价格重新计价并创建带快照的未付款服务订单；订单列表、消息及其他页面仍在后续 Issue 中逐项替换。
- 客服、剪贴板、图片选择和分享使用小程序原生能力。
- 微信登录已接入 `auth` 云函数；建单结果页通过 `payment` 云函数调起微信支付，并且只按验签通知或主动查单结果显示支付成功。
- 当前云端套餐均标记为开发测试内容，正式价格、素材与运营规则仍需上线前确认；测试服务订单不进入真实销量、评分或财务统计。
