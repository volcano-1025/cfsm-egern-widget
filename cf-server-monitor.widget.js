/**
 * CF-Server-Monitor → Egern 小组件适配脚本
 * ------------------------------------------------------------
 * 数据来源：CF-Server-Monitor 第三方主题开发 API
 *   - GET /api/server?id=<uuid>               当前服务器详情（离线判断/CPU/内存/磁盘/负载/流量）
 *   - GET /api/history/all?id=<uuid>&hours=1  近 1 小时历史（延迟 / 丢包率 均值 + 两条独立 Uptime Bar）
 *
 * 环境变量（在 Egern 主配置 widgets[].env 或模块 env 中设置）：
 *   BASE_URL   必填  CF-Server-Monitor 后端地址，如 https://status.example.com（不要带结尾 /）
 *   SERVER_ID  必填  服务器 UUID
 *   ISP_LINE   可选  展示延迟/丢包率所用的运营商线路，取值 ct(电信) / cu(联通) / cm(移动) / bd(BD 线路)，默认 ct
 *                    若该线路完全没有数据，会自动尝试其余线路兜底展示
 *
 * 布局与尺寸说明：
 *   systemSmall  (155×155pt) : 6 行，空间最紧张 —— 不显示 CPU/内存/磁盘/负载/延迟/丢包率 这些文字标签，
 *                              只保留「图标 + 数值」，避免文字把数值挤出去截断成 "..."
 *   systemMedium (329×155pt) : 宽度够但高度和 small 一样矮，因此整体内边距 / 行间距 / 进度条粗细
 *                              都比 large 收紧一档，保留完整文字标签，7 行内容也不会溢出
 *   systemLarge  (329×345pt) : 高度充裕，用完整文字标签 + 宽松间距，并在「性能区块」「网络区块」
 *                              「流量区块」之间插入弹性空白，让整体重心均衡，而不是纯粹拉大固定间距
 *
 * 判定规则：
 *   - last_updated 距当前超过 3 分钟视为离线
 *   - CPU / 内存 / 磁盘 使用率取 /api/server 返回的最新一次上报值（约 1 分钟粒度），保留 2 位小数
 *   - 负载显示 load_avg 的 5 分钟原始值（非百分比），进度条 / 配色仍按「原始值 / 核心数」换算的相对占比
 *   - 延迟 / 丢包率取 /api/history/all?hours=1 中对应运营商字段的均值；历史缺失该字段时回退为 /api/server 当前值；
 *     若选定线路完全无数据，自动尝试其余线路
 *   - Uptime Bar 每种指标各 20 格，每格约代表 3 分钟；格内无数据视为离线（灰色）
 *   - 剩余流量进度条为「倒计」样式：填充长度 = 剩余百分比（越用越短），颜色仍按用量的危险程度着色
 *
 * 配色分级（绿色 → 嫩绿色 → 黄绿色 → 黄色 → 红色）：
 *   usageColor()   用于 CPU/内存/磁盘/负载/流量 百分比进度条
 *   latencyColor() 用于延迟(ms)
 *   lossColor()    用于丢包率(%)
 */

// ------------------------- 配色 -------------------------

const COLOR_STEPS = ['#2ECC71', '#7ED957', '#C9D93B', '#F1C40F', '#E74C3C'];
const COLOR_OFFLINE = '#8E8E93';
const MUTED = { light: '#6B6B6F', dark: '#9A9A9E' };

function usageColor(pct) {
  if (pct == null || isNaN(pct)) return COLOR_OFFLINE;
  if (pct < 60) return COLOR_STEPS[0];
  if (pct < 75) return COLOR_STEPS[1];
  if (pct < 85) return COLOR_STEPS[2];
  if (pct < 93) return COLOR_STEPS[3];
  return COLOR_STEPS[4];
}

function latencyColor(ms) {
  if (ms == null || isNaN(ms)) return COLOR_OFFLINE;
  if (ms < 80) return COLOR_STEPS[0];
  if (ms < 150) return COLOR_STEPS[1];
  if (ms < 250) return COLOR_STEPS[2];
  if (ms < 400) return COLOR_STEPS[3];
  return COLOR_STEPS[4];
}

function lossColor(pct) {
  if (pct == null || isNaN(pct)) return COLOR_OFFLINE;
  if (pct <= 0.5) return COLOR_STEPS[0];
  if (pct <= 2) return COLOR_STEPS[1];
  if (pct <= 5) return COLOR_STEPS[2];
  if (pct <= 15) return COLOR_STEPS[3];
  return COLOR_STEPS[4];
}

// ------------------------- SVG 生成 -------------------------

function svgBar(pct, color, w, h) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const r = h / 2;
  const fillW = (w * p / 100).toFixed(1);
  return "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + w + " " + h + "'>" +
    "<rect x='0' y='0' width='" + w + "' height='" + h + "' rx='" + r + "' fill='rgba(150,150,150,0.28)'/>" +
    "<rect x='0' y='0' width='" + fillW + "' height='" + h + "' rx='" + r + "' fill='" + color + "'/>" +
    "</svg>";
}

function svgUptimeBar(colors, w, h) {
  const n = colors.length;
  const gap = 2;
  const blockW = (w - gap * (n - 1)) / n;
  let rects = '';
  for (let i = 0; i < n; i++) {
    const x = (i * (blockW + gap)).toFixed(1);
    rects += "<rect x='" + x + "' y='0' width='" + blockW.toFixed(1) + "' height='" + h + "' rx='1.5' fill='" + colors[i] + "'/>";
  }
  return "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + w + " " + h + "'>" + rects + "</svg>";
}

// ------------------------- 工具函数 -------------------------

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function clampPct(v) {
  const n = toNum(v);
  if (n == null) return null;
  return Math.max(0, Math.min(100, n));
}

// 兼容多种 traffic_limit 写法："1TB" / "500GB" / "500G" / "500"（无单位按 GB 处理）/
// "GiB" 类型写法 / 纯数字类型（大数字按字节处理，小数字按 GB 处理），并去除千分位逗号
function parseSizeToBytes(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') {
    return raw > 1e6 ? raw : raw * 1024 ** 3;
  }
  const str = String(raw).trim().replace(/,/g, '');
  if (!str) return 0;
  const m = str.match(/^([\d.]+)\s*([A-Za-z]*)$/);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return 0;
  let unit = (m[2] || '').toUpperCase().replace(/IB$/, 'B'); // "GiB" -> "GB" 等
  if (!unit) {
    return num >= 1e6 ? num : num * 1024 ** 3;
  }
  if (unit.length === 1) unit += 'B'; // "G" -> "GB", "M" -> "MB"
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, PB: 1024 ** 5 }[unit];
  return mult ? num * mult : num * 1024 ** 3;
}

function humanBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 2 : 1)) + units[i];
}

async function fetchJSON(ctx, url) {
  const resp = await ctx.http.get(url);
  return await resp.json();
}

const ISP_ORDER = ['ct', 'cu', 'cm', 'bd'];

// 若首选线路完全没有 ping/loss 数据，尝试在 server 详情里找一条有数据的线路兜底
function resolveIsp(server, preferred) {
  const order = [preferred].concat(ISP_ORDER.filter((x) => x !== preferred));
  for (const isp of order) {
    if (toNum(server['ping_' + isp]) != null || toNum(server['loss_' + isp]) != null) return isp;
  }
  return preferred;
}

// 计算近 1 小时延迟 / 丢包率均值，以及各自独立的 20 格 Uptime Bar 颜色
function computeLatencyAndBlocks(history, isp, now, currentPing, currentLoss) {
  const pingKey = 'ping_' + isp;
  const lossKey = 'loss_' + isp;
  const BLOCKS = 20;
  const spanMs = 60 * 60 * 1000;
  const bucketMs = spanMs / BLOCKS;
  const startTs = now - spanMs;

  const buckets = [];
  for (let i = 0; i < BLOCKS; i++) buckets.push({ ping: [], loss: [] });

  const allPing = [];
  const allLoss = [];

  for (const row of history) {
    const ts = Number(row.timestamp);
    if (!ts) continue;
    const ping = toNum(row[pingKey]);
    const loss = toNum(row[lossKey]);
    if (ping != null) allPing.push(ping);
    if (loss != null) allLoss.push(loss);
    if (ts < startTs) continue;
    let idx = Math.floor((ts - startTs) / bucketMs);
    if (idx < 0) idx = 0;
    if (idx > BLOCKS - 1) idx = BLOCKS - 1;
    if (ping != null) buckets[idx].ping.push(ping);
    if (loss != null) buckets[idx].loss.push(loss);
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  const avgPing = allPing.length ? avg(allPing) : currentPing;
  const avgLoss = allLoss.length ? avg(allLoss) : currentLoss;

  const hasHistoryPing = allPing.length > 0;
  const hasHistoryLoss = allLoss.length > 0;

  const delayBlocks = buckets.map((b, i) => {
    if (!hasHistoryPing) return i === BLOCKS - 1 ? latencyColor(currentPing) : COLOR_OFFLINE;
    if (!b.ping.length) return COLOR_OFFLINE;
    return latencyColor(avg(b.ping));
  });

  const lossBlocks = buckets.map((b, i) => {
    if (!hasHistoryLoss) return i === BLOCKS - 1 ? lossColor(currentLoss) : COLOR_OFFLINE;
    if (!b.loss.length) return COLOR_OFFLINE;
    return lossColor(avg(b.loss));
  });

  return { avgPing, avgLoss, delayBlocks, lossBlocks };
}

// ------------------------- 尺寸配置 -------------------------
// small / medium 的物理高度都只有 ~155pt，large 有 ~345pt，因此三档的内边距、
// 行间距、进度条粗细分开配置，而不是简单地按宽度一刀切。

const SIZE_CONFIG = {
  systemSmall: {
    width: 155, padding: 14, gap: 5, barH: 5, uptimeH: 10,
    showLabel: false, valueFont: 'caption1', labelFont: 'caption2',
  },
  systemMedium: {
    width: 329, padding: 12, gap: 4, barH: 5, uptimeH: 12,
    showLabel: true, valueFont: 'caption1', labelFont: 'caption2',
  },
  systemLarge: {
    width: 329, padding: 18, gap: 9, barH: 6, uptimeH: 16,
    showLabel: true, valueFont: 'callout', labelFont: 'caption2',
  },
};

// ------------------------- DSL 组件 -------------------------

function textMuted(text, size) {
  return { type: 'text', text: text, font: { size: size || 'caption2' }, textColor: MUTED };
}

// 有文字标签版本（medium / large）：图标 + 标签 + 弹簧 + 数值
function metricWithLabel(icon, label, color, valueText, cfg) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', flex: 1, gap: 4,
    children: [
      { type: 'image', src: 'sf-symbol:' + icon, width: 11, height: 11, color: MUTED },
      textMuted(label, cfg.labelFont),
      { type: 'spacer' },
      { type: 'text', text: valueText == null ? '-' : valueText, font: { size: cfg.valueFont, weight: 'bold' }, textColor: color },
    ],
  };
}

// 无文字标签版本（small）：图标 + 数值，避免窄空间里文字把数值挤成 "..."
function metricCompact(icon, color, valueText, cfg) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', flex: 1, gap: 4,
    children: [
      { type: 'image', src: 'sf-symbol:' + icon, width: 11, height: 11, color: MUTED },
      { type: 'text', text: valueText == null ? '-' : valueText, font: { size: cfg.valueFont, weight: 'bold' }, textColor: color },
    ],
  };
}

function metricRow(cfg, items) {
  return {
    type: 'stack', direction: 'row', gap: cfg.gap,
    children: items.map((it) => cfg.showLabel
      ? metricWithLabel(it.icon, it.label, it.color, it.valueText, cfg)
      : metricCompact(it.icon, it.color, it.valueText, cfg)),
  };
}

function barRow(pct1, pct2, barW, barH, gap) {
  return {
    type: 'stack', direction: 'row', gap: gap,
    children: [
      { type: 'image', src: svgBar(pct1, usageColor(pct1), barW, barH), width: barW, height: barH },
      { type: 'image', src: svgBar(pct2, usageColor(pct2), barW, barH), width: barW, height: barH },
    ],
  };
}

// 左右两栏：每栏「图标(+标签)+数值」在上，对应 20 格 Uptime Bar 在下
function delayLossColumns(ms, lossPct, delayBlocks, lossBlocks, colW, cfg) {
  const column = (icon, label, valueText, valueColor, blocks) => ({
    type: 'stack', direction: 'column', flex: 1, gap: 4,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          { type: 'image', src: 'sf-symbol:' + icon, width: 11, height: 11, color: MUTED },
          cfg.showLabel ? textMuted(label, cfg.labelFont) : null,
          { type: 'spacer' },
          { type: 'text', text: valueText, font: { size: cfg.valueFont, weight: 'bold' }, textColor: valueColor },
        ].filter(Boolean),
      },
      { type: 'image', src: svgUptimeBar(blocks, colW, cfg.uptimeH), width: colW, height: cfg.uptimeH },
    ],
  });

  return {
    type: 'stack', direction: 'row', gap: cfg.gap,
    children: [
      column('clock', '延迟', ms == null ? '-' : Math.round(ms) + 'ms', latencyColor(ms), delayBlocks),
      column('wifi.exclamationmark', '丢包率', lossPct == null ? '-' : lossPct.toFixed(1) + '%', lossColor(lossPct), lossBlocks),
    ],
  };
}

function headerRow(region, name, isOnline) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
    children: [
      { type: 'image', src: 'sf-symbol:circle.fill', width: 7, height: 7, color: isOnline ? '#2ECC71' : '#E74C3C' },
      { type: 'text', text: region || '-', font: { size: 'caption1', weight: 'semibold' }, textColor: MUTED },
      { type: 'text', text: name || '-', font: { size: 'footnote', weight: 'bold' }, textColor: { light: '#111111', dark: '#FFFFFF' }, flex: 1, maxLines: 1, minScale: 0.7 },
    ],
  };
}

function errorWidget(msg) {
  return {
    type: 'widget',
    padding: 16,
    backgroundColor: { light: '#F2F2F7', dark: '#1C1C1E' },
    children: [
      { type: 'spacer' },
      { type: 'image', src: 'sf-symbol:exclamationmark.triangle', width: 20, height: 20, color: '#E74C3C' },
      { type: 'text', text: msg, font: { size: 'caption1', weight: 'medium' }, textColor: MUTED, textAlign: 'center' },
      { type: 'spacer' },
    ],
  };
}

// ------------------------- 主逻辑 -------------------------

export default async function (ctx) {
  const BASE_URL = (ctx.env.BASE_URL || '').replace(/\/+$/, '');
  const SERVER_ID = ctx.env.SERVER_ID || '';
  const ISP_PREF = (ctx.env.ISP_LINE || 'ct').toLowerCase();
  const family = ctx.widgetFamily;
  const cfg = SIZE_CONFIG[family] || SIZE_CONFIG.systemSmall;

  if (!BASE_URL || !SERVER_ID) {
    return errorWidget('请在小组件 env 中配置 BASE_URL 和 SERVER_ID');
  }

  let server;
  try {
    server = await fetchJSON(ctx, BASE_URL + '/api/server?id=' + encodeURIComponent(SERVER_ID));
    if (!server || server.error) throw new Error((server && server.error) || 'empty response');
  } catch (e) {
    return errorWidget('数据加载失败');
  }

  const now = Date.now();
  const lastUpdated = Number(server.last_updated || server.timestamp || 0);
  const isOnline = lastUpdated > 0 && now - lastUpdated <= 3 * 60 * 1000;

  const cpuPct = clampPct(server.cpu);
  const ramTotal = toNum(server.ram_total);
  const ramUsed = toNum(server.ram_used);
  const ramPct = ramTotal ? clampPct((ramUsed / ramTotal) * 100) : null;
  const diskTotal = toNum(server.disk_total);
  const diskUsed = toNum(server.disk_used);
  const diskPct = diskTotal ? clampPct((diskUsed / diskTotal) * 100) : null;

  const cores = toNum(server.cpu_cores) || 1;
  const loadParts = String(server.load_avg || '').trim().split(/\s+/).map(Number).filter((x) => !isNaN(x));
  const load5 = loadParts.length >= 2 ? loadParts[1] : loadParts.length ? loadParts[0] : null;
  const loadPct = load5 == null ? null : clampPct((load5 / cores) * 100);

  const ISP = resolveIsp(server, ISP_PREF);
  const currentPing = toNum(server['ping_' + ISP]);
  const currentLoss = toNum(server['loss_' + ISP]);

  let avgPing = currentPing;
  let avgLoss = currentLoss;
  let delayBlocks = null;
  let lossBlocks = null;

  try {
    const hist = await fetchJSON(ctx, BASE_URL + '/api/history/all?id=' + encodeURIComponent(SERVER_ID) + '&hours=1');
    if (Array.isArray(hist) && hist.length) {
      const computed = computeLatencyAndBlocks(hist, ISP, now, currentPing, currentLoss);
      avgPing = computed.avgPing;
      avgLoss = computed.avgLoss;
      delayBlocks = computed.delayBlocks;
      lossBlocks = computed.lossBlocks;
    }
  } catch (e) {
    // 历史数据获取失败，回退为当前值，Uptime Bar 置空（显示离线灰色）
  }

  if (!isOnline) {
    avgPing = null;
    avgLoss = null;
  }

  const innerW = cfg.width - cfg.padding * 2;
  const barW = Math.floor((innerW - cfg.gap) / 2);

  const children = [
    headerRow(server.region, server.name, isOnline),
    metricRow(cfg, [
      { icon: 'cpu', label: 'CPU', color: usageColor(cpuPct), valueText: cpuPct == null ? null : cpuPct.toFixed(2) + '%' },
      { icon: 'memorychip', label: '内存', color: usageColor(ramPct), valueText: ramPct == null ? null : ramPct.toFixed(2) + '%' },
    ]),
    barRow(cpuPct, ramPct, barW, cfg.barH, cfg.gap),
    metricRow(cfg, [
      { icon: 'internaldrive', label: '磁盘', color: usageColor(diskPct), valueText: diskPct == null ? null : diskPct.toFixed(2) + '%' },
      { icon: 'chart.bar.fill', label: '负载', color: usageColor(loadPct), valueText: load5 == null ? null : load5.toFixed(2) },
    ]),
    barRow(diskPct, loadPct, barW, cfg.barH, cfg.gap),
  ];

  if (family === 'systemSmall') {
    children.push({
      type: 'stack', direction: 'row', gap: cfg.gap,
      children: [
        metricCompact('clock', latencyColor(avgPing), avgPing == null ? null : Math.round(avgPing) + 'ms', cfg),
        metricCompact('wifi.exclamationmark', lossColor(avgLoss), avgLoss == null ? null : avgLoss.toFixed(1) + '%', cfg),
      ],
    });
  } else {
    const dBlocks = delayBlocks || new Array(20).fill(COLOR_OFFLINE);
    const lBlocks = lossBlocks || new Array(20).fill(COLOR_OFFLINE);
    const colW = Math.floor((innerW - cfg.gap) / 2);

    if (family === 'systemLarge') children.push({ type: 'spacer' });
    children.push(delayLossColumns(avgPing, avgLoss, dBlocks, lBlocks, colW, cfg));
  }

  if (family === 'systemLarge') {
    const limitBytes = parseSizeToBytes(server.traffic_limit);
    let usedBytes = 0;
    switch (server.traffic_calc_type) {
      case 'in': usedBytes = toNum(server.net_rx_monthly) || 0; break;
      case 'out': usedBytes = toNum(server.net_tx_monthly) || 0; break;
      case 'max': usedBytes = Math.max(toNum(server.net_rx_monthly) || 0, toNum(server.net_tx_monthly) || 0); break;
      default: usedBytes = (toNum(server.net_rx_monthly) || 0) + (toNum(server.net_tx_monthly) || 0);
    }
    const remainBytes = limitBytes > 0 ? Math.max(0, limitBytes - usedBytes) : null;
    const usedPct = limitBytes > 0 ? clampPct((usedBytes / limitBytes) * 100) : null;
    // "倒计"：填充长度按剩余量算，用得越多条越短；颜色仍按用量的危险程度着色
    const remainPct = usedPct == null ? null : Math.max(0, 100 - usedPct);

    children.push({ type: 'spacer' });
    children.push({
      type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
      children: [
        textMuted('剩余流量', cfg.labelFont),
        { type: 'text', text: remainBytes == null ? '-' : humanBytes(remainBytes), font: { size: cfg.valueFont, weight: 'bold' }, textColor: usageColor(usedPct) },
        { type: 'spacer' },
        { type: 'text', text: limitBytes > 0 ? humanBytes(usedBytes) + ' / ' + humanBytes(limitBytes) : '-', font: { size: 'caption2' }, textColor: MUTED },
      ],
    });
    children.push({ type: 'image', src: svgBar(remainPct, usageColor(usedPct), innerW, cfg.barH), width: innerW, height: cfg.barH });
  }

  return {
    type: 'widget',
    refreshAfter: new Date(now + 60 * 1000).toISOString(),
    padding: cfg.padding,
    gap: cfg.gap,
    backgroundGradient: {
      type: 'linear',
      colors: isOnline ? ['#16213E', '#0F3460'] : ['#2B2B2F', '#1C1C1E'],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 },
    },
    children: children,
  };
}
