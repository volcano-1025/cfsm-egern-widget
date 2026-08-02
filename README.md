# CF-Server-Monitor × Egern 小组件

把 [CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor)（Cloudflare Workers 服务器监控面板）的单机详情搬到 iOS 主屏幕，通过 [Egern](https://egernapp.com) 小组件渲染。

## 效果

像素级复刻 [Lumina（komari-theme-Lumina）](https://github.com/stqfdyr/komari-theme-Lumina)节点卡片风格：

| 尺寸 | 内容 |
|------|------|
| 中尺寸（systemMedium） | 旗帜 + 名称 + 状态点（带光晕）+ 副标题；CPU/内存、磁盘/负载 2×2 指标 + 18 段进度条；在线时长与延迟底行 |
| 大尺寸（systemLarge） | 完整 Lumina 卡片：2×2 指标（含明细胶囊）、剩余流量（无限显示 ∞）、延迟/丢包率 + 24 格迷你条、到期与在线底行 |

- 色板、分段条透明度（激活 0.42+fillLevel×0.56 / 非激活 0.58）、热力色阶（延迟/丢包/到期 HSL 渐变）均 1:1 移植自 Lumina 源码
- 负载条为蓝→紫渐变；延迟/丢包迷你条取近 1 小时历史序列（接口缺失时以当前值铺满兜底）
- 自适应浅色/深色模式（浅/深色板均取自 Lumina tokens.css）
- 离线自动降级：状态点变红、副标题显示离线时长，保留最后已知数据
- 点击小组件跳转到监控站点

## 部署要求

- 站点为**公开站点**（后台 `is_public` 开启），匿名可访问 API
- Turnstile 仅开登录页验证（`turnstile_login_enabled`）没有影响；**不要**开启全局 API 验证（`turnstile_enabled`），否则匿名请求会被 403 拦截

## 安装步骤

1. **上传脚本**：把 `cf-server-monitor.widget.js` 上传到 Gist 或任意可公开访问的位置，拿到 raw 地址。
2. **配置 Egern**：参考 `egern-config.example.yaml`，在主配置文件中加入 `scriptings`（generic 脚本）和 `widgets` 两段，填好 `API_BASE`。
3. **（可选）指定服务器**：在 `widgets.env.SERVER_ID` 填服务器 UUID。获取方式：浏览器打开站点 → 进入某台服务器详情页 → 地址栏 `#/server/` 后面的一段即是。留空则自动选第一台可见服务器。
4. **添加到主屏幕**：长按主屏幕空白处 → 左上角 + → 搜索 Egern → 选**中尺寸或大尺寸** → 添加后长按小组件 → 编辑小组件 → 选择 `cf-server-monitor`。

也可以在 Egern App 内「工具 → 脚本」手动创建 generic 脚本并粘贴内容，再到「分析 → 小组件画廊」添加小组件。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `API_BASE` | ✅ | — | 站点地址，如 `https://status.example.com` |
| `SERVER_ID` | — | 空 | 服务器 UUID；空时自动取列表第一台可见服务器 |
| `REFRESH_MINUTES` | — | 1 | 刷新间隔分钟数（1–60）。iOS 实际刷新由系统调度，此值为「不早于」 |
| `ONLINE_THRESHOLD_MIN` | — | 5 | 超过该分钟数未上报视为离线 |

## FAQ

**Q: 小组件显示「访问被人机验证拦截」？**
站点开启了全局 Turnstile 验证（`turnstile_enabled`）。小组件无法完成人机验证，请在后台关闭全局验证（登录页验证 `turnstile_login_enabled` 不受影响，可保留）。

**Q: 显示「站点未公开」？**
后台把站点设为公开（is_public），或在主题外观设置中允许匿名访问 API。

**Q: 多后端（多 apiBase）站点支持吗？**
当前版本只请求单个 `API_BASE`。多后端部署时，`SERVER_ID` 必须属于该后端；留空自动选取的也是该后端返回的第一台。

## 开发自检

```bash
node dev/mock-run.mjs
```

模拟 10 组场景（在线/离线/无限流量/403/401/网络异常/列表降级/缺配置/包装层兼容）并递归校验 DSL 合法性。

## 文件

| 文件 | 说明 |
|------|------|
| `cf-server-monitor.widget.js` | Egern generic 小组件脚本（单文件、零依赖） |
| `egern-config.example.yaml` | Egern 配置示例 |
| `dev/mock-run.mjs` | Node 自检工具 |
