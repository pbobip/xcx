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
