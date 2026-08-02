/**
 * CF-Server-Monitor → Egern 小组件适配脚本
 * ------------------------------------------------------------
 * 数据来源：CF-Server-Monitor 第三方主题开发 API
 *   - GET /api/server?id=<uuid>            当前服务器详情（离线判断/CPU/内存/磁盘/负载/流量）
 *   - GET /api/history/all?id=<uuid>&hours=1  近 1 小时历史（延迟 / 丢包率 均值 + Uptime Bar）
 *
 * 环境变量（在 Egern 主配置 widgets[].env 或模块 env 中设置）：
 *   BASE_URL   必填  CF-Server-Monitor 后端地址，如 https://status.example.com（不要带结尾 /）
 *   SERVER_ID  必填  服务器 UUID
 *   ISP_LINE   可选  展示延迟/丢包率所用的运营商线路，取值 ct(电信) / cu(联通) / cm(移动) / bd(BD 线路)，默认 ct
 *
 * 布局：
 *   systemSmall  : 6 行（地区主机名 / CPU+内存 / 对应进度条 / 磁盘+负载 / 对应进度条 / 延迟+丢包）
 *   systemMedium : 在 small 基础上 + 第 7 行 近 1 小时 Uptime Bar（20 格）
 *   systemLarge  : 在 medium 基础上 + 第 8 行 剩余流量/已用/总量 + 第 9 行 流量进度条
 *
 * 判定规则：
 *   - last_updated 距当前超过 3 分钟视为离线
 *   - CPU / 内存 / 磁盘 使用率取 /api/server 返回的最新一次上报值（约 1 分钟粒度）
 *   - 负载取 load_avg 的 5 分钟值，按核心数换算为百分比
 *   - 延迟 / 丢包率取 /api/history/all?hours=1 中对应运营商字段的均值；历史中若无该字段则回退为 /api/server 当前值
 *   - Uptime Bar 20 格，每格约代表 3 分钟；格内无数据视为离线（灰色）
 *
 * 配色分级（绿色 → 嫩绿色 → 黄绿色 → 黄色 → 红色）：
 *   usageColor()   用于 CPU/内存/磁盘/负载/流量 百分比进度条
 *   latencyColor() 用于延迟(ms)
 *   lossColor()    用于丢包率(%)
 */

// ------------------------- 配色 -------------------------

const COLOR_STEPS = ['#2ECC71', '#7ED957', '#C9D93B', '#F1C40F', '#E74C3C'];
const COLOR_OFFLINE = '#8E8E93';

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

function worseColor(c1, c2) {
  const i1 = COLOR_STEPS.indexOf(c1);
  const i2 = COLOR_STEPS.indexOf(c2);
  if (c1 === COLOR_OFFLINE || c2 === COLOR_OFFLINE) return COLOR_OFFLINE;
  if (i1 === -1) return c2;
  if (i2 === -1) return c1;
  return COLOR_STEPS[Math.max(i1, i2)];
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

function clampPct(v) {
  if (v == null || isNaN(v)) return null;
  return Math.max(0, Math.min(100, v));
}

function parseSizeToBytes(str) {
  if (!str) return 0;
  const m = String(str).trim().match(/^([\d.]+)\s*([KMGTP]?B)$/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, PB: 1024 ** 5 }[unit] || 1;
  return num * mult;
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

// 计算近 1 小时延迟/丢包率均值，以及 20 格 Uptime Bar 颜色
function computeLatencyAndBlocks(history, isp, now, currentPing, currentLoss) {
  const pingKey = 'ping_' + isp;
  const lossKey = 'loss_' + isp;
  const BLOCKS = 20;
  const spanMs = 60 * 60 * 1000;
  const bucketMs = spanMs / BLOCKS;
  const startTs = now - spanMs;

  const buckets = [];
  for (let i = 0; i < BLOCKS; i++) buckets.push({ ping: [], loss: [] });

  let allPing = [];
  let allLoss = [];

  for (const row of history) {
    const ts = Number(row.timestamp);
    if (!ts) continue;
    const ping = row[pingKey];
    const loss = row[lossKey];
    if (typeof ping === 'number') allPing.push(ping);
    if (typeof loss === 'number') allLoss.push(loss);
    if (ts < startTs) continue;
    let idx = Math.floor((ts - startTs) / bucketMs);
    if (idx < 0) idx = 0;
    if (idx > BLOCKS - 1) idx = BLOCKS - 1;
    if (typeof ping === 'number') buckets[idx].ping.push(ping);
    if (typeof loss === 'number') buckets[idx].loss.push(loss);
  }

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const avgPing = allPing.length ? avg(allPing) : currentPing;
  const avgLoss = allLoss.length ? avg(allLoss) : currentLoss;

  const hasAnyHistoryMetric = allPing.length > 0 || allLoss.length > 0;

  const blocks = buckets.map((b, i) => {
    if (!hasAnyHistoryMetric) {
      // 历史记录中不含该运营商延迟/丢包字段，仅最后一格用当前值兜底展示
      if (i === BLOCKS - 1) return worseColor(latencyColor(currentPing), lossColor(currentLoss));
      return COLOR_OFFLINE;
    }
    if (!b.ping.length && !b.loss.length) return COLOR_OFFLINE; // 该时间段无数据 → 离线
    const bp = avg(b.ping);
    const bl = avg(b.loss);
    return worseColor(latencyColor(bp), lossColor(bl));
  });

  return { avgPing, avgLoss, blocks };
}

// ------------------------- DSL 组件 -------------------------

function textMuted(text, size) {
  return { type: 'text', text: text, font: { size: size || 'caption2' }, textColor: { light: '#6B6B6F', dark: '#9A9A9E' } };
}

function metricPair(label, pct, unitText) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', flex: 1, gap: 4,
    children: [
      textMuted(label, 'caption2'),
      { type: 'spacer' },
      {
        type: 'text',
        text: pct == null ? '-' : (unitText || (pct.toFixed(0) + '%')),
        font: { size: 'caption1', weight: 'semibold' },
        textColor: usageColor(pct),
      },
    ],
  };
}

function barRow(pct1, pct2, barW, barH) {
  return {
    type: 'stack', direction: 'row', gap: 8,
    children: [
      { type: 'image', src: svgBar(pct1, usageColor(pct1), barW, barH), width: barW, height: barH },
      { type: 'image', src: svgBar(pct2, usageColor(pct2), barW, barH), width: barW, height: barH },
    ],
  };
}

function latencyLossRow(ms, lossPct) {
  return {
    type: 'stack', direction: 'row', gap: 8,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', flex: 1, gap: 4,
        children: [
          textMuted('延迟', 'caption2'),
          { type: 'spacer' },
          { type: 'text', text: ms == null ? '-' : Math.round(ms) + 'ms', font: { size: 'caption1', weight: 'semibold' }, textColor: latencyColor(ms) },
        ],
      },
      {
        type: 'stack', direction: 'row', alignItems: 'center', flex: 1, gap: 4,
        children: [
          textMuted('丢包', 'caption2'),
          { type: 'spacer' },
          { type: 'text', text: lossPct == null ? '-' : lossPct.toFixed(1) + '%', font: { size: 'caption1', weight: 'semibold' }, textColor: lossColor(lossPct) },
        ],
      },
    ],
  };
}

function headerRow(region, name, isOnline) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
    children: [
      { type: 'image', src: 'sf-symbol:circle.fill', width: 7, height: 7, color: isOnline ? '#2ECC71' : '#E74C3C' },
      { type: 'text', text: region || '-', font: { size: 'caption1', weight: 'semibold' }, textColor: { light: '#6B6B6F', dark: '#9A9A9E' } },
      { type: 'text', text: name || '-', font: { size: 'footnote', weight: 'bold' }, textColor: { light: '#111111', dark: '#FFFFFF' }, flex: 1, maxLines: 1, minScale: 0.7 },
    ],
  };
}

function errorWidget(msg) {
  return {
    type: 'widget',
    padding: 14,
    backgroundColor: { light: '#F2F2F7', dark: '#1C1C1E' },
    children: [
      { type: 'spacer' },
      { type: 'image', src: 'sf-symbol:exclamationmark.triangle', width: 20, height: 20, color: '#E74C3C' },
      { type: 'text', text: msg, font: { size: 'caption1', weight: 'medium' }, textColor: { light: '#666666', dark: '#AAAAAA' }, textAlign: 'center' },
      { type: 'spacer' },
    ],
  };
}

// ------------------------- 主逻辑 -------------------------

export default async function (ctx) {
  const BASE_URL = (ctx.env.BASE_URL || '').replace(/\/+$/, '');
  const SERVER_ID = ctx.env.SERVER_ID || '';
  const ISP = (ctx.env.ISP_LINE || 'ct').toLowerCase();
  const family = ctx.widgetFamily;

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
  const isOnline = lastUpdated > 0 && (now - lastUpdated) <= 3 * 60 * 1000;

  const cpuPct = clampPct(server.cpu);
  const ramPct = server.ram_total ? clampPct((server.ram_used / server.ram_total) * 100) : null;
  const diskPct = server.disk_total ? clampPct((server.disk_used / server.disk_total) * 100) : null;

  const cores = server.cpu_cores || 1;
  const loadParts = String(server.load_avg || '0 0 0').trim().split(/\s+/).map(Number);
  const load5 = loadParts.length >= 2 ? loadParts[1] : loadParts[0] || 0;
  const loadPct = clampPct((load5 / cores) * 100);

  const currentPing = server['ping_' + ISP];
  const currentLoss = server['loss_' + ISP];

  let avgPing = typeof currentPing === 'number' ? currentPing : null;
  let avgLoss = typeof currentLoss === 'number' ? currentLoss : null;
  let uptimeBlocks = null;

  try {
    const hist = await fetchJSON(ctx, BASE_URL + '/api/history/all?id=' + encodeURIComponent(SERVER_ID) + '&hours=1');
    if (Array.isArray(hist) && hist.length) {
      const computed = computeLatencyAndBlocks(hist, ISP, now, currentPing, currentLoss);
      avgPing = computed.avgPing;
      avgLoss = computed.avgLoss;
      uptimeBlocks = computed.blocks;
    }
  } catch (e) {
    // 历史数据获取失败，回退为当前值，Uptime Bar 置空
  }

  if (!isOnline) {
    // 离线时不展示误导性的延迟/丢包数据
    avgPing = null;
    avgLoss = null;
  }

  // 不同尺寸下的内部宽度与进度条宽度（点）
  let innerW, barW, gap, padding;
  if (family === 'systemSmall') {
    innerW = 131; barW = 61; gap = 5; padding = 12;
  } else {
    innerW = 305; barW = 148; gap = 6; padding = 12;
  }

  const children = [
    headerRow(server.region, server.name, isOnline),
    { type: 'stack', direction: 'row', gap: gap, children: [metricPair('CPU', cpuPct), metricPair('内存', ramPct)] },
    barRow(cpuPct, ramPct, barW, 6),
    { type: 'stack', direction: 'row', gap: gap, children: [metricPair('磁盘', diskPct), metricPair('负载', loadPct)] },
    barRow(diskPct, loadPct, barW, 6),
    latencyLossRow(avgPing, avgLoss),
  ];

  if (family === 'systemMedium' || family === 'systemLarge') {
    const blocks = uptimeBlocks || new Array(20).fill(COLOR_OFFLINE);
    children.push({ type: 'image', src: svgUptimeBar(blocks, innerW, 14), width: innerW, height: 14 });
  }

  if (family === 'systemLarge') {
    const limitBytes = parseSizeToBytes(server.traffic_limit);
    let usedBytes = 0;
    switch (server.traffic_calc_type) {
      case 'in': usedBytes = server.net_rx_monthly || 0; break;
      case 'out': usedBytes = server.net_tx_monthly || 0; break;
      case 'max': usedBytes = Math.max(server.net_rx_monthly || 0, server.net_tx_monthly || 0); break;
      default: usedBytes = (server.net_rx_monthly || 0) + (server.net_tx_monthly || 0);
    }
    const remainBytes = limitBytes > 0 ? Math.max(0, limitBytes - usedBytes) : null;
    const trafficPct = limitBytes > 0 ? clampPct((usedBytes / limitBytes) * 100) : null;

    children.push({
      type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
      children: [
        textMuted('剩余流量', 'caption2'),
        { type: 'text', text: remainBytes == null ? '-' : humanBytes(remainBytes), font: { size: 'caption1', weight: 'semibold' }, textColor: usageColor(trafficPct) },
        { type: 'spacer' },
        { type: 'text', text: (limitBytes > 0 ? (humanBytes(usedBytes) + ' / ' + humanBytes(limitBytes)) : '-'), font: { size: 'caption2' }, textColor: { light: '#6B6B6F', dark: '#9A9A9E' } },
      ],
    });
    children.push({ type: 'image', src: svgBar(trafficPct, usageColor(trafficPct), innerW, 6), width: innerW, height: 6 });
  }

  return {
    type: 'widget',
    refreshAfter: new Date(now + 60 * 1000).toISOString(),
    padding: padding,
    gap: family === 'systemSmall' ? 5 : 7,
    backgroundGradient: {
      type: 'linear',
      colors: isOnline ? ['#16213E', '#0F3460'] : ['#2B2B2F', '#1C1C1E'],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 },
    },
    children: children,
  };
}
