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
