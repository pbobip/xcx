---
name: wechat-tabbar-icons
description: 生成、替换、检查或规范化微信小程序底部 tabBar 图标资源。用于需要根据菜单名称、app.json tabBar.list、普通态/选中态颜色生成本地透明 PNG 图标，并写入 iconPath/selectedIconPath 时；支持配合 imagegen 生成位图源图，再输出稳定一致的双态小程序底部导航图标。
---

# 微信小程序底部导航图标

使用这个技能为微信小程序生成底部 `tabBar` 图标。重点不是只画出图标，而是输出能在 `app.json` `tabBar.list` 中稳定使用的本地双态资源。

## 配套技能

生成位图源图前，先读取并遵守当前 Codex 会话提供的 `$imagegen` 技能；不要依赖作者电脑上的绝对路径。

当项目没有现成图标体系、用户明确希望生成新图标，或图标隐喻需要原创视觉时，使用 `imagegen`。如果项目已有 SVG、字体图标或成熟图标库，优先使用确定性的矢量导出流程；除非用户明确要求使用生成式图标。

## 菜单名称输入

用户可以在调用技能时直接填写菜单名称。支持这些写法：

```text
菜单名称：首页、分类、购物车、我的
```

```text
底部导航：主页=home，商品=list，购物车=cart，我的=profile
```

```json
{
  "menus": [
    { "text": "首页", "name": "home", "icon": "house" },
    { "text": "分类", "name": "category", "icon": "grid" },
    { "text": "我的", "name": "profile", "icon": "user" }
  ]
}
```

处理规则：

- `text` 用作 `app.json` tabBar 的菜单文案。
- `name` 用作文件名；没有 `name` 时，根据菜单含义生成短小英文文件名。
- `icon` 用作 imagegen 的图标隐喻；没有 `icon` 时，根据菜单名称推断。
- 如果项目已有 `app.json`，优先保留已有 `pagePath` 顺序，再用用户填写的菜单名称校准 `text`、文件名和图标隐喻。
- 如果用户填写的菜单数量和 `app.json` `tabBar.list` 数量不一致，先指出差异；能安全匹配时继续，不能匹配时再询问。

## 工作流程

1. 检查 `app.json`，定位 `tabBar.list`、`tabBar.color`、`tabBar.selectedColor`。
2. 读取 `references/tabbar-icon-rules.md`，按其中的命名、提示词、导出和验收规则执行。
3. 解析用户填写的菜单名称；没有显式填写时，从 `app.json` 或原型中提取。
4. 确定输出目录。优先沿用项目已有资源目录；否则使用小程序根目录下的 `assets/tabbar/` 或 `miniprogram/assets/tabbar/`。
5. 使用 `imagegen` 为每个菜单生成一张中性透明源图；不要分别生成普通态和选中态。
6. 使用 `scripts/tint_tabbar_icon.py` 将透明源图缩放并染色，输出普通态和选中态 PNG，保证双态轮廓一致。
7. 更新 `app.json`：为每个 tab 写入本地 `iconPath` 和 `selectedIconPath`，菜单文字只放在 `text` 中，不写进图片。
8. 验收：检查透明背景、路径存在、尺寸一致、选中态清晰、无文字、无阴影、无复杂背景。

## 硬性规则

- 每个菜单必须输出两个 PNG：普通态和选中态。
- `app.json` 必须使用本地路径，不要使用远程图片 URL。
- 图标内部不要包含文字、标签、角标、通知数字。
- 图标必须适合底部导航小尺寸显示，避免细碎线条、3D、照片质感、复杂渐变和重阴影。
- 同一组图标要保持统一风格：同样的线宽或填充方式、视觉重量、圆角、留白和配色。
- 先生成一张中性源图，再用脚本染色生成双态；不要依赖两次生成来得到普通态和选中态。

## 资源

- `references/tabbar-icon-rules.md`：详细规则、菜单名称输入、提示词模板、命名规范、`app.json` 示例和验收清单。
- `scripts/tint_tabbar_icon.py`：把一张透明源图转换成普通态和选中态 tabBar PNG。
