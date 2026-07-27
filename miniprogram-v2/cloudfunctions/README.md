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
