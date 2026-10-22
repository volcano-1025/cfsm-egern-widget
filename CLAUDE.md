# cfsm-egern-widget

[CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor) 探针面板的 iOS 主屏小组件，
适配小 / 中 / 大三个尺寸。Egern 直接跑 `cfsm-status.js`；Scriptable 版跑的也是这同一份，
外面套一层翻译运行时。配色与指标口径沿用主题
[CFSM-Theme-LuminaPlus](https://github.com/volcano-1025/CFSM-Theme-LuminaPlus)（本地
`/Users/volcano/CFSM-Theme-LuminaPlus`）。

## 怎么跑

```bash
npm install
npm test        # vitest：纯函数 + DSL 结构白名单
npm run lint
npm run preview # 生成 preview-{small,medium,large,errors}.html，浏览器里肉眼调版
```

本机跑不了 Egern / Scriptable，preview 只是近似（字体度量和缩字都模拟不了）。真机验证靠
Egern 的**小组件画廊**、Scriptable 里直接运行，或加 `DEBUG=1` 渲染最小排查树。

## 技术栈与目录

无运行时依赖，devDependency 只有 vitest / eslint / globals。

- `cfsm-status.js` — 核心脚本（ESM）。Egern 按 `script_url` **远程加载**它，没有打包步骤
- `test/cfsm-status.test.js` — 单元测试；`test/dsl-schema.js` 是 Egern DSL 属性白名单；
  `test/fixture.js` 是假的 `/api/servers` 响应
- `tools/preview.mjs` — 本地预览渲染器
- `scriptable/loader.js` 是用户粘进 Scriptable 的加载器，下载并缓存另外两个文件；`scriptable/runtime.js`
  执行核心脚本并把 DSL 翻成 `ListWidget`。`test/scriptable.test.js` 用假 API 跑通整条链

## 硬约束（踩过的坑，改之前先看）

- **单文件、无依赖**：`cfsm-status.js` 不许 `import` 任何东西。具名导出只给测试用，
  Egern 只取 `export default`
- **每一行都必须定高**。Egern 把多出来的竖直空间平摊给没定高的子元素，Mac / iPad 上
  小组件更高，一个漏了 `height` 的行会独吞整块空档、把下面的内容全挤到底部
- **小尺寸每行必须是「flex 文本 + 定宽块」的结构**。行内放 spacer、行首放定宽单元、
  `date` 不在行尾，真机上整块渲染不出来（只剩一个旗帜），而预览里看不出来
- `image.src` 不支持远程 URL（只收 `sf-symbol:` / Base64 / 内联 SVG），旗帜只能用 emoji
- 颜色只收 hex 或 `rgba()`，不认 `hsl()`；自适应色写 `{ light, dark }`
- **自己画不出透明**（Egern 铺了不透明容器底，`rgba(0,0,0,0)` 也是浅灰；Scriptable 垫纯黑）。玻璃底只有 iOS 26 主屏
  「透明」外观能给，而它会把**所有颜色抹成白色、只保留透明度** —— 只靠颜色区分的元素（如进度条
  轨道）必须带 alpha，否则和填充段一起变成白杠（真机截图验证过）
- **只准发 `GET {API_BASE}/api/servers`**，绝不碰 `/api/history/all` —— 逐节点查历史会让
  后端 D1 读行翻几十倍（主题也禁止在概览场景用它）
- 改延迟/丢包配色、在线判定、字节格式化之前，先对照主题的 `src/utils/metricTone.ts`、
  `src/services/cfsm/mappers.ts`、`src/services/pingLiveStore.ts`，口径要逐值一致
- **Scriptable 两个文件的形态别改**：`runtime.js` 是函数体（被 `new Function` 执行，末尾 `return`，
  不许 import/export）；`loader.js` 是用户手动粘贴的，改了用户不会自动拿到 —— 能改 runtime 就别改 loader
- `cfsm-status.js` 的导出只能用 `export function` / `export default` / `export { … }`，
  runtime 的 `toModule` 只认这三种。DSL 新用了元素或属性，要在 runtime 的 `HANDLED_PROPS` 和翻译里补上
- 加 DSL 属性先确认[官方文档](https://egernapp.com/zh-CN/docs/configuration/widgets/)里有，
  再往 `test/dsl-schema.js` 的白名单里补 —— 写错键名 Egern 静默忽略，只表现为「样式没生效」

## 当前状态

功能完整、已发布，`main` 就是真机加载的那一份（raw URL 直指仓库根）。推送后 Egern 按
`update_interval`（默认一天）才重拉，想立刻生效要在 App 里手动更新脚本。

未验证的遗留项（需要真机确认，见 README「限制」）：中尺寸 5 行 / 大尺寸 9 行在比
iPhone 14 Pro 矮的机型上会不会裁掉最后一行；README 安装步骤里的 Egern App 字段名；
Scriptable 版已在真机跑通（2026-10 截图），点按跳转未确认。
