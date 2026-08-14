# cfsm-egern-widget

[CF-Server-Monitor](https://github.com/cf-server-monitor) 探针面板的 **Egern iOS 主屏小组件**。
配色与指标口径沿用主题 [CFSM-Theme-LuminaPlus](https://github.com/volcano-1025/CFSM-Theme-LuminaPlus)。

支持三个主屏尺寸，一个脚本全包：

| 尺寸 | 内容 |
| --- | --- |
| **小** | 单台机器：旗帜 + 名称 + 在线点 + 更新时间、CPU / 内存 / 磁盘三条进度条、延迟与丢包、实时上下行 |
| **中** | 汇总条（在线数、离线数、全站实时速率）+ 5 行节点（CPU、内存、延迟、丢包） |
| **大** | 标题 + 三块汇总（在线数 / 实时速率 / 累计流量）+ 9 行节点（多一列磁盘）+ 离线名单 |

节点比行数少的时候，行会自动拉高填掉空档（中尺寸最高 26pt、大尺寸最高 28pt），
不会一堆机器挤在顶上、下面空一大片；排满时回到最小行高。

点按小组件会跳回面板：小尺寸进对应机器的详情页，中/大尺寸进首页。

## 安装

在 Egern 配置里加一段 `scriptings` 和一段 `widgets`：

```yaml
scriptings:
  - generic:
      name: cfsm-status
      script_url: https://raw.githubusercontent.com/volcano-1025/cfsm-egern-widget/main/cfsm-status.js
      timeout: 20
      env:
        API_BASE: "https://status.example.com"

widgets:
  # 拖到主屏时选中/大尺寸
  - name: 服务器状态
    script_name: cfsm-status

  # 再加一个专看某台机器的，拖成小尺寸
  - name: HK-01
    script_name: cfsm-status
    env:
      NODE: "hk-01"
```

然后在 iOS 主屏长按空白处 → 加号 → 找到 Egern → 选小组件并挑尺寸。

几个要点：

- `script_name` 指向 `scriptings` 里那条 `generic` 的 `name`；多个 widget 条目可以共用同一个脚本。
- **env 写在哪一处都行**，两处会合并。公共的（`API_BASE`、`CARRIER`）写在 `scriptings` 那条上，
  每个 widget 各自不同的（`NODE`、`TITLE`、`ROWS`）写在自己的 `widgets` 条目里，最省事。
- `update_interval`（默认 86400 秒）决定 Egern 多久重新拉一次脚本文件，脚本更新后可以调小它，
  或者在 Egern 里手动更新一次。

## env 参数

| key | 默认 | 说明 |
| --- | --- | --- |
| `API_BASE` | **必填** | 后端地址，只写 origin，不带路径与结尾斜杠。例 `https://status.example.com` |
| `NODE` | 空 | 小尺寸显示哪台机器。三级匹配：id 全等 → 名称全等（忽略大小写）→ 名称包含。留空则自动取「最需要关注」的那台 |
| `NODES` | 空 | 中/大尺寸固定显示哪几台，逗号分隔，按写的顺序排。匹配规则同 `NODE`，写错的会被跳过 |
| `GROUP` | 空 | 没写 `NODES` 时，只看某个分组（后台的「服务器分组」） |
| `TITLE` | `服务器状态` | 大尺寸左上角标题 |
| `CARRIER` | `auto` | 延迟与丢包看哪条线路：`ct`/`电信`、`cu`/`联通`、`cm`/`移动`、`bd`。`auto` 在三网里取延迟最低的一条 |
| `ROWS` | 中 5 / 大 9 | 列表最多显示几行 |
| `REFRESH` | `1` | 期望的刷新间隔（分钟）。iOS 有刷新预算，实际间隔通常被系统拉长，写小了也不会更快 |
| `DEBUG` | 空 | 填 `1` 时改渲染一棵最小的排查树（只有一个多行文本），用来分辨「取数没成功」还是「某个布局结构没渲染出来」 |

没写 `NODES` 时列表按「最需要关注」自动排序：**离线的排最前，然后按 CPU 使用率从高到低**。
后台设为隐藏的机器一律不显示。

`CARRIER` 点名某条线路后就只认那一条，那条没数据就显示 `—`，不会偷偷回退到别条 ——
写着「电信」却显示联通的数才是真的误导。小尺寸会把线路名标在延迟左边，
大尺寸标在标题栏图例的末尾。

## 限制

- **只支持公开站点。** 站点如果关掉了公开访问，或在后台开了全局 Turnstile 人机验证，
  小组件拿不到数据（那份验证凭证只能在浏览器里解人机验证才能拿到，脚本没法绕）。
  这两种情况小组件会直接把原因写在卡片上。
- **只支持单个后端。** 多站部署请为每个后端各加一个 widget 条目。
- 延迟按 60 / 100 / 160 / 200 ms 分档上色，没有数据时显示 `—`。
  线路的探测目标由后台配置，公开接口不下发，小组件也就无从显示。
- 丢包是后端按探测窗口算好的百分比，不足 1% 保留一位小数（0.4% 和「一个都没掉」不是一回事）。
  配色逐值复刻主题的连续热力渐变（`lossHeatColor` → `heatRamp(pct, [1,3,5,10], 20)`）：
  0% 是绿色，1% 转黄绿，5% 转金，10% 转橙，30% 以上封顶红；只有「没有样本」才是灰的。
  整条线路全丢包时延迟为空、丢包 100%，这时候仍会把丢包显示出来。
- 延迟配色与主题 `tokens.css` 的 `--latency-*` 逐值一致，浅深色只有 critical 一档不同
  （主题本身就是这么定的）。
- 进度条颜色沿用主题：**蓝=CPU、紫=内存、橙=磁盘**（大尺寸标题栏有图例）。
- **每一行都必须定高。** Egern 会把多出来的竖直空间平摊给没定高的子元素：小组件在 Mac /
  iPad 上比 iPhone 高，一个没定高的行会独吞整块空档，把它下面的内容全挤到底部。
  代价是行数超了会被裁掉而不是压缩：默认行数按 iPhone 14 Pro 那档留了余量，
  如果你的机型看到最后一行缺一截，把 `ROWS` 调小一档即可。
- 每次刷新只发一个请求 `GET {API_BASE}/api/servers`，不碰历史接口 —— 逐节点查历史会让后端
  D1 读行翻几十倍。

## 开发

```bash
npm install
npm test        # 纯函数 + DSL 结构校验
npm run lint
npm run preview # 生成 preview-{small,medium,large,errors}.html
```

`npm run preview` 把小组件的 DSL 翻成等尺寸的 HTML，浅深色各画一份，用来在本机调版式。
它是**近似预览**，不是模拟器：字体度量与 WidgetKit 不同，`minScale` 的自动缩字也模拟不了，
只用来抓「名字被挤断、某列没对齐、某块被压成 0 宽、深色下看不清」这类结构问题。

`cfsm-status.js` 必须保持**单文件、无依赖**——Egern 是按 `script_url` 远程加载它的，没有打包步骤。
文件里的具名导出只给测试用，Egern 只取 `export default`。

`test/dsl-schema.js` 是 Egern DSL 的属性白名单，逐条抄自
[官方文档](https://egernapp.com/zh-CN/docs/configuration/widgets/)。脚本是没有类型检查的纯 JS，
写错键名 Egern 会静默忽略、真机上只表现为「样式没生效」，这份白名单是唯一能当场抓住手滑的东西。
加新属性前先确认文档里有，再往白名单里补。
