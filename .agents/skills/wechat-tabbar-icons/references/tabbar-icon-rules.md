# 微信小程序 tabBar 图标生成规则

这些规则用于任何微信小程序项目，不绑定具体业务或页面名称。

## 输入清单

开始生成前先收集：

- tab 数量、`pagePath`、`text`，优先从 `app.json` `tabBar.list` 读取；如果用户填写了菜单名称，也要同步使用。
- 普通态颜色和选中态颜色，优先从 `tabBar.color`、`tabBar.selectedColor` 读取。
- 每个 tab 的图标隐喻，例如 home、list、search、cart、profile、settings。
- 输出目录，优先沿用项目已有资源目录。
- 项目已有图标风格：线性、面性、圆角、像素、手绘、品牌化等。

## 菜单名称输入规则

用户可以在使用技能时直接填写菜单名称，用来决定 `app.json` 的 `text`、图标文件名和图标隐喻。

支持格式：

```text
菜单名称：首页、分类、购物车、我的
```

```text
底部导航：主页=home，消息=message，设置=settings
```

```json
{
  "menus": [
    { "text": "首页", "name": "home", "icon": "house" },
    { "text": "消息", "name": "message", "icon": "chat bubble" },
    { "text": "设置", "name": "settings", "icon": "gear" }
  ]
}
```

字段含义：

- `text`：显示在底部导航里的菜单名称。
- `name`：图标文件名的基础名称，例如 `home` 会输出 `home.png` 和 `home-active.png`。
- `icon`：给 imagegen 使用的图标隐喻，例如 `house`、`grid`、`user silhouette`。

如果只填写中文菜单名，按语义推断：

| 菜单名称示例 | 推荐文件名 | 推荐图标隐喻 |
| --- | --- | --- |
| 首页、主页 | `home` | house |
| 分类、菜单、频道 | `category` | grid |
| 列表、发现、浏览 | `list` | list |
| 搜索 | `search` | magnifying glass |
| 消息、通知 | `message` | chat bubble |
| 购物车、购物袋 | `cart` | shopping cart 或 shopping bag |
| 订单、记录 | `orders` | receipt 或 document list |
| 我的、个人、账户 | `profile` | user silhouette |
| 设置 | `settings` | gear |

如果用户填写的菜单名称与已有 `app.json` 冲突：

- 菜单数量一致时，保留原 `pagePath`，按用户填写顺序更新 `text` 和图标文件名。
- 菜单数量不一致但能根据 `text` 或语义匹配时，只更新能匹配的菜单，并说明未匹配项。
- 无法安全匹配时，先向用户确认，不要猜测页面路由。

## 资产规范

- 每个 tab 输出两个本地 PNG：`<name>.png` 和 `<name>-active.png`。
- 默认建议输出方形 `81x81` PNG；如果项目已有尺寸规范，跟随项目。
- 背景必须透明，四角 alpha 应为 0。
- 图形应居中，主体占画布约 65%-78%，保留足够内边距。
- 图标内不要出现文字。底部导航文字由 `app.json` 的 `text` 控制。
- 普通态和选中态应使用完全相同的轮廓，只改变颜色或轻微填充强度。
- 图标应在小尺寸下仍能识别，避免细碎纹理、照片感、复杂透视和阴影。

## imagegen 使用方式

使用 `$imagegen` 生成中性源图，而不是直接生成最终双态图。

推荐生成流程：

1. 为每个 tab 生成一张中性黑色或深灰源图。
2. 要求源图在纯色 chroma-key 背景上，背景常用 `#00ff00`。
3. 使用 imagegen 技能里的 `remove_chroma_key.py` 去背景，得到透明 PNG。
4. 使用本技能的 `scripts/tint_tabbar_icon.py` 统一缩放并输出普通态和选中态。

透明背景处理命令示例：

```bash
python "${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.py" \
  --input <generated-source.png> \
  --out <transparent-source.png> \
  --auto-key border \
  --soft-matte \
  --transparent-threshold 12 \
  --opaque-threshold 220 \
  --despill
```

## imagegen 提示词模板

为每个图标单独生成源图，保持同一套风格描述：

```text
用途：微信小程序底部 tabBar 源图标
主要需求：为移动端底部导航生成一个简洁的 <图标隐喻> 图标
风格：极简、扁平、近似矢量图标、纯黑或深灰单色、圆角
构图：方形画布居中，主体约占画布 72%，四周留白均匀，视觉重心居中
颜色：图标主体只使用 #111111
背景：使用完全纯色的 #00ff00 chroma-key 背景，方便后续去背景
限制：不要文字、不要字母、不要数字、不要角标、不要阴影、不要渐变、不要 3D、不要照片纹理、不要水印，图标主体不要使用 #00ff00
避免：复杂细节、过细线条、透视、背景色块、菜单文字
```

如果图标隐喻可能混淆，在“主要需求”里增加具体形状，例如“带屋顶和门洞的房屋轮廓”或“头像和肩部组成的用户剪影”。如果实际调用的 imagegen 对英文更稳定，可以把这段中文提示词等价翻译成英文，但不要改变约束。

## 双态染色脚本

用透明源图生成普通态和选中态：

```bash
python wechat-tabbar-icons/scripts/tint_tabbar_icon.py \
  --source <transparent-source.png> \
  --out-dir <miniprogram-root>/assets/tabbar \
  --name home \
  --inactive-color '#7a7f87' \
  --active-color '#16a34a' \
  --size 81
```

输出：

```text
<out-dir>/home.png
<out-dir>/home-active.png
```

## app.json 接入

`iconPath` 和 `selectedIconPath` 必须指向本地小程序资源路径：

```json
{
  "tabBar": {
    "color": "#7a7f87",
    "selectedColor": "#16a34a",
    "list": [
      {
        "pagePath": "pages/home/home",
        "text": "首页",
        "iconPath": "assets/tabbar/home.png",
        "selectedIconPath": "assets/tabbar/home-active.png"
      }
    ]
  }
}
```

路径相对于小程序根目录。不要使用 `../` 穿出小程序目录，也不要使用远程 URL。

## 验收清单

- `app.json` `tabBar.list` 中每个 tab 都有 `iconPath` 和 `selectedIconPath`。
- 如果用户填写了菜单名称，`app.json` 中对应 `text` 已按用户输入更新。
- 所有图标路径在小程序根目录下真实存在。
- 每个图标都是透明背景 PNG。
- 普通态和选中态图形轮廓一致。
- 所有 tab 的视觉重量、内边距、线宽或填充方式一致。
- 图标没有内嵌文字、徽标、角标、阴影或复杂背景。
- 在微信开发者工具里切换 tab 时，选中态清晰，未选中态不过暗或过淡。
