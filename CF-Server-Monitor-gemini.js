/**
 * CF-Server-Monitor → Egern 小组件适配脚本 (Visual Refresh v2)
 * ------------------------------------------------------------
 * 数据来源：CF-Server-Monitor 第三方主题开发 API
 *   - GET /api/server?id=<uuid>               当前服务器详情
 *   - GET /api/history/all?id=<uuid>&hours=1  近 1 小时历史
 */

// ------------------------- 配色 -------------------------

const COLOR_STEPS = ['#32D74B', '#8ED957', '#FFD60A', '#FF9F0A', '#FF453A'];
const COLOR_OFFLINE = '#48484A';
const MUTED = { light: '#8E9CAE', dark: '#8E9CAE' };
const LABEL = { light: '#FFFFFF', dark: '#FFFFFF' };
const ACCENT = '#32D74B';
const TRACK_BG = 'rgba(255,255,255,0.16)';

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
  const fillW = Math.max(h, w * p / 100).toFixed(1);
  return "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + w + " " + h + "'>" +
    "<rect x='0' y='0' width='" + w + "' height='" + h + "' rx='" + r + "' fill='" + TRACK_BG + "'/>" +
    "<rect x='0' y='0' width='" + fillW + "' height='" + h + "' rx='" + r + "' fill='" + color + "'/>" +
    "</svg>";
}

function svgPairedBar(pct1, pct2, totalW, h, midGap, ratio) {
  const halfW = (totalW - midGap) / 2;
  const barLen = Math.max(10, halfW * ratio);
  const r = h / 2;
  const seg = (x0, pct) => {
    const p = Math.max(0, Math.min(100, pct || 0));
    const fillW = Math.max(h, barLen * p / 100).toFixed(1);
    const color = usageColor(pct);
    return "<rect x='" + x0.toFixed(1) + "' y='0' width='" + barLen.toFixed(1) + "' height='" + h + "' rx='" + r + "' fill='" + TRACK_BG + "'/>" +
      "<rect x='" + x0.toFixed(1) + "' y='0' width='" + fillW + "' height='" + h + "' rx='" + r + "' fill='" + color + "'/>";
  };
  const rects = seg(0, pct1) + seg(halfW + midGap, pct2);
  return "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + totalW + " " + h + "'>" + rects + "</svg>";
}

// 恢复原本平整两端的 Uptime Bar 竖条样式
function svgUptimeBar(colors, w, h) {
  const n = colors.length;
  const gap = 3;
  const blockW = (w - gap * (n - 1)) / n;
  const rx = Math.min(2.5, blockW / 2).toFixed(1);
  let rects = '';
  for (let i = 0; i < n; i++) {
    const x = (i * (blockW + gap)).toFixed(1);
    rects += "<rect x='" + x + "' y='0' width='" + blockW.toFixed(1) + "' height='" + h + "' rx='" + rx + "' fill='" + colors[i] + "'/>";
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

function parseSizeToBytes(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') { return raw > 1e6 ? raw : raw * 1024 ** 3; }
  const str = String(raw).trim().replace(/,/g, '');
  if (!str) return 0;
  const m = str.match(/^([\d.]+)\s*([A-Za-z]*)$/);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return 0;
  let unit = (m[2] || '').toUpperCase().replace(/IB$/, 'B');
  if (!unit) { return num >= 1e6 ? num : num * 1024 ** 3; }
  if (unit.length === 1) unit += 'B';
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

function resolveIsp(server, preferred) {
  const order = [preferred].concat(ISP_ORDER.filter((x) => x !== preferred));
  for (const isp of order) {
    if (toNum(server['ping_' + isp]) != null || toNum(server['loss_' + isp]) != null) return isp;
  }
  return preferred;
}

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

const SIZE_CONFIG = {
  systemSmall: {
    width: 155, padding: 14, colGap: 5, tightGap: 3, outerGap: 9,
    barH: 6, uptimeH: 10, barRatio: 1, trafficInset: 0, trafficH: 8,
    showLabel: false, valueFont: 'footnote', labelFont: 'caption2',
  },
  systemMedium: {
    width: 329, padding: 16, colGap: 5, tightGap: 3, outerGap: 7,
    barH: 6, uptimeH: 14, barRatio: 1, trafficInset: 0, trafficH: 8,
    showLabel: true, valueFont: 'footnote', labelFont: 'caption1',
  },
  systemLarge: {
    width: 329, padding: 18, colGap: 9, tightGap: 5, outerGap: 16,
    barH: 8, uptimeH: 18, barRatio: 1, trafficInset: 0, trafficH: 10,
    showLabel: true, valueFont: 'headline', labelFont: 'footnote',
  },
};

// ------------------------- DSL 组件 -------------------------

function textMuted(text, size) {
  return { type: 'text', text: text, font: { size: size || 'caption2' }, textColor: LABEL };
}

function metricWithLabel(icon, label, color, valueText, cfg) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', flex: 1, gap: 4,
    children: [
      { type: 'image', src: 'sf-symbol:' + icon, width: 11, height: 11, color: LABEL },
      textMuted(label, cfg.labelFont),
      { type: 'spacer' },
      { type: 'text', text: valueText == null ? '-' : valueText, font: { size: cfg.valueFont, weight: 'bold' }, textColor: color },
    ],
  };
}

function metricCompact(icon, color, valueText, cfg) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', flex: 1, gap: 4,
    children: [
      { type: 'image', src: 'sf-symbol:' + icon, width: 11, height: 11, color: LABEL },
      { type: 'text', text: valueText == null ? '-' : valueText, font: { size: cfg.valueFont, weight: 'bold' }, textColor: color },
    ],
  };
}

function metricRow(cfg, items) {
  return {
    type: 'stack', direction: 'row', gap: cfg.colGap,
    children: items.map((it) => cfg.showLabel
      ? metricWithLabel(it.icon, it.label, it.color, it.valueText, cfg)
      : metricCompact(it.icon, it.color, it.valueText, cfg)),
  };
}

function barRow(pct1, pct2, totalW, barH, gap, ratio) {
  return { type: 'image', src: svgPairedBar(pct1, pct2, totalW, barH, gap, ratio), width: totalW, height: barH };
}

function delayLossColumns(ms, lossPct, delayBlocks, lossBlocks, colW, cfg) {
  const column = (icon, label, valueText, valueColor, blocks) => ({
    type: 'stack', direction: 'column', flex: 1, gap: 4,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          { type: 'image', src: 'sf-symbol:' + icon, width: 11, height: 11, color: LABEL },
          cfg.showLabel ? textMuted(label, cfg.labelFont) : null,
          { type: 'spacer' },
          { type: 'text', text: valueText, font: { size: cfg.valueFont, weight: 'bold' }, textColor: valueColor },
        ].filter(Boolean),
      },
      { type: 'image', src: svgUptimeBar(blocks, colW, cfg.uptimeH), width: colW, height: cfg.uptimeH },
    ],
  });

  return {
    type: 'stack', direction: 'row', gap: cfg.colGap,
    children: [
      column('clock', '延迟', ms == null ? '-' : Math.round(ms) + 'ms', latencyColor(ms), delayBlocks),
      column('wifi.exclamationmark', '丢包率', lossPct == null ? '-' : lossPct.toFixed(1) + '%', lossColor(lossPct), lossBlocks),
    ],
  };
}

function formatTime(ts) {
  if (!ts) return '--:--';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

function headerRow(region, name, isOnline, lastUpdated) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
    children: [
      { type: 'image', src: 'sf-symbol:circle.fill', width: 8, height: 8, color: isOnline ? ACCENT : '#FF453A' },
      { type: 'text', text: region || '-', font: { size: 'footnote', weight: 'semibold' }, textColor: LABEL },
      { type: 'text', text: name || '-', font: { size: 'footnote', weight: 'bold' }, textColor: ACCENT, flex: 1, maxLines: 1, minScale: 0.7 },
      { type: 'text', text: formatTime(lastUpdated), font: { size: 'caption1' }, textColor: MUTED },
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
      { type: 'image', src: 'sf-symbol:exclamationmark.triangle', width: 20, height: 20, color: '#FF453A' },
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

  let avgLoss = currentLoss;
  let delayBlocks = null;
  let lossBlocks = null;

  try {
    const hist = await fetchJSON(ctx, BASE_URL + '/api/history/all?id=' + encodeURIComponent(SERVER_ID) + '&hours=1');
    if (Array.isArray(hist) && hist.length) {
      const computed = computeLatencyAndBlocks(hist, ISP, now, currentPing, currentLoss);
      avgLoss = computed.avgLoss;
      delayBlocks = computed.delayBlocks;
      lossBlocks = computed.lossBlocks;
    }
  } catch (e) {}

  let latestPing = currentPing;
  if (!isOnline) {
    latestPing = null;
    avgLoss = null;
  }

  const innerW = cfg.width - cfg.padding * 2;

  const children = [
    headerRow(server.region, server.name, isOnline, lastUpdated),
    {
      type: 'stack', direction: 'column', gap: cfg.tightGap,
      children: [
        metricRow(cfg, [
          { icon: 'cpu', label: 'CPU', color: usageColor(cpuPct), valueText: cpuPct == null ? null : cpuPct.toFixed(2) + '%' },
          { icon: 'memorychip', label: '内存', color: usageColor(ramPct), valueText: ramPct == null ? null : ramPct.toFixed(2) + '%' },
        ]),
        barRow(cpuPct, ramPct, innerW, cfg.barH, cfg.colGap, cfg.barRatio),
      ],
    },
    {
      type: 'stack', direction: 'column', gap: cfg.tightGap,
      children: [
        metricRow(cfg, [
          { icon: 'internaldrive', label: '磁盘', color: usageColor(diskPct), valueText: diskPct == null ? null : diskPct.toFixed(2) + '%' },
          { icon: 'gauge', label: '负载', color: usageColor(loadPct), valueText: load5 == null ? null : load5.toFixed(2) },
        ]),
        barRow(diskPct, loadPct, innerW, cfg.barH, cfg.colGap, cfg.barRatio),
      ],
    },
  ];

  if (family === 'systemSmall') {
    children.push({
      type: 'stack', direction: 'row', gap: cfg.colGap,
      children: [
        metricCompact('clock', latencyColor(latestPing), latestPing == null ? null : Math.round(latestPing) + 'ms', cfg),
        metricCompact('wifi.exclamationmark', lossColor(avgLoss), avgLoss == null ? null : avgLoss.toFixed(1) + '%', cfg),
      ],
    });
  } else {
    const dBlocks = delayBlocks || new Array(20).fill(COLOR_OFFLINE);
    const lBlocks = lossBlocks || new Array(20).fill(COLOR_OFFLINE);
    const colW = Math.floor((innerW - cfg.colGap) / 2);
    children.push(delayLossColumns(latestPing, avgLoss, dBlocks, lBlocks, colW, cfg));
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
    let remainPct = usedPct == null ? null : Math.max(0, 100 - usedPct);
    const trafficBarW = Math.max(20, innerW - cfg.trafficInset);
    if (remainPct != null && usedBytes > 0) {
      const minGapPct = (5 / trafficBarW) * 100;
      remainPct = Math.min(remainPct, 100 - minGapPct);
    }

    children.push({
      type: 'stack', direction: 'column', gap: cfg.tightGap,
      children: [
        {
          type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
          children: [
            textMuted('剩余流量', cfg.labelFont),
            { type: 'text', text: remainBytes == null ? '-' : humanBytes(remainBytes), font: { size: cfg.valueFont, weight: 'bold' }, textColor: usageColor(usedPct) },
            { type: 'spacer' },
            { type: 'text', text: limitBytes > 0 ? humanBytes(usedBytes) + ' / ' + humanBytes(limitBytes) : '-', font: { size: 'caption2' }, textColor: MUTED },
          ],
        },
        { type: 'image', src: svgBar(remainPct, usageColor(usedPct), trafficBarW, cfg.trafficH), width: trafficBarW, height: cfg.trafficH },
      ],
    });
  }

  return {
    type: 'widget',
    refreshAfter: new Date(now + 60 * 1000).toISOString(),
    padding: cfg.padding,
    gap: cfg.outerGap,
    backgroundGradient: {
      type: 'linear',
      colors: isOnline ? ['#0B2340', '#061527'] : ['#1C1C1E', '#111112'],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 1 },
    },
    children: children,
  };
}
