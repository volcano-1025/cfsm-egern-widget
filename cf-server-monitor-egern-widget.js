/**
 * CF-Server-Monitor × Egern 小组件
 * 展示指定服务器的单机详情，适配 systemMedium / systemLarge，自适应深浅色。
 *
 * 环境变量（在 Egern 小组件 env 中配置）：
 *   API_BASE            必填，站点地址，如 https://status.example.com
 *   SERVER_ID           可选，服务器 UUID；为空时自动选取列表中第一台可见服务器
 *   REFRESH_MINUTES     可选，刷新间隔分钟数，默认 5（1-60）
 *   HISTORY_HOURS       可选，趋势图时长（小时），默认 1（0.167-24，仅大尺寸请求）
 *   ONLINE_THRESHOLD_MIN 可选，离线判定阈值分钟数，默认 5
 *   TREND_METRIC        可选，趋势指标 cpu / ram，默认 cpu
 */

// ============ 配色（自适应深浅色） ============
const C = {
  bg:            { light: '#FFFFFF', dark: '#1C1C1E' },
  cardBg:        { light: '#F2F2F7', dark: '#2C2C2E' },
  textPrimary:   { light: '#1C1C1E', dark: '#FFFFFF' },
  textSecondary: { light: '#6E6E73', dark: '#8E8E93' },
  textTertiary:  { light: '#AEAEB2', dark: '#636366' },
  track:         { light: '#E5E5EA', dark: '#38383A' },
  ok:            { light: '#34C759', dark: '#30D158' },
  warn:          { light: '#FF9500', dark: '#FF9F0A' },
  bad:           { light: '#FF3B30', dark: '#FF453A' },
  cpu:           { light: '#007AFF', dark: '#0A84FF' },
  mem:           { light: '#AF52DE', dark: '#BF5AF2' },
  disk:          { light: '#5AC8FA', dark: '#64D2FF' },
};
const BADGE_BG = {
  ok:  { light: '#34C75926', dark: '#30D15833' },
  bad: { light: '#FF3B3026', dark: '#FF453A33' },
};
const TREND_COLOR = '#0A84FF';
const TREND_FILL = '#0A84FF2E';
const TREND_GRID = '#63636655';

const USAGE_WARN = 60;
const USAGE_BAD = 85;

// ============ 工具函数 ============
function clamp(v, lo, hi) {
  v = Number(v);
  if (!isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/** 时间戳归一化为毫秒：小于 1e10 视为秒 */
function normalizeTs(v) {
  const n = num(v);
  if (n === null || n <= 0) return null;
  return n < 1e10 ? n * 1000 : n;
}

function pctOf(used, total) {
  used = num(used); total = num(total);
  if (used === null || total === null || total <= 0) return null;
  return clamp((used / total) * 100, 0, 100);
}

/** 用量着色：<60 用指标色，60-85 橙，>=85 红 */
function usageColor(p, accentKey) {
  if (p === null) return C.textTertiary;
  if (p >= USAGE_BAD) return C.bad;
  if (p >= USAGE_WARN) return C.warn;
  return C[accentKey] || C.ok;
}

/** 字节数格式化（网络流量） */
function fmtBytes(n) {
  n = num(n);
  if (n === null || n < 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const s = n >= 100 ? Math.round(n) : (Math.round(n * 10) / 10);
  return s + ' ' + units[i];
}

/** MB 格式化（内存/磁盘，API 单位为 MB） */
function fmtMB(mb) {
  mb = num(mb);
  if (mb === null || mb < 0) return '--';
  if (mb >= 1024) {
    const g = mb / 1024;
    return (g >= 100 ? Math.round(g) : Math.round(g * 10) / 10) + ' GB';
  }
  return Math.round(mb) + ' MB';
}

/** 网速格式化（B/s） */
function fmtSpeed(bps) {
  bps = num(bps);
  if (bps === null || bps < 0) return '--';
  if (bps < 1024) return Math.round(bps) + ' B/s';
  return fmtBytes(bps) + '/s';
}

/** 运行时长格式化 */
function fmtUptime(ms) {
  if (!isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + '分';
  const h = Math.floor(min / 60);
  if (h < 24) return h + '小时 ' + (min % 60) + '分';
  const d = Math.floor(h / 24);
  return d + '天 ' + (h % 24) + '小时';
}

/** 解析 "1TB" / "500GB" / "1024MB" 为字节数 */
function parseTrafficLimit(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)$/i);
  if (!m) return null;
  const pow = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4, PB: 5 }[m[2].toUpperCase()];
  return Number(m[1]) * Math.pow(1024, pow);
}

/** /api/server 返回可能是 {data:{...}} 也可能直接是对象 */
function unwrap(d) {
  if (d && typeof d === 'object' && d.data && typeof d.data === 'object' && !Array.isArray(d.data)) {
    return d.data;
  }
  return d;
}

/** /api/servers 列表结构兼容 */
function normalizeList(d) {
  d = unwrap(d);
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    if (Array.isArray(d.servers)) return d.servers;
    if (Array.isArray(d.list)) return d.list;
  }
  return [];
}

/** 内联 SVG 编码为 data URI */
function encodeSvg(svg) {
  return 'data:image/svg+xml,' + svg
    .replace(/%/g, '%25')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/#/g, '%23')
    .replace(/ /g, '%20');
}

// ============ HTTP ============
function httpError(kind, message) {
  const e = new Error(message);
  e.kind = kind;
  return e;
}

async function httpJson(ctx, url) {
  let resp;
  try {
    resp = await ctx.http.get(url);
  } catch (e) {
    throw httpError('NETWORK', String((e && e.message) || e).slice(0, 80));
  }
  const status = num(resp && (resp.status ?? resp.statusCode));
  if (status === 401) throw httpError('UNAUTHORIZED', 'HTTP 401');
  if (status === 403) throw httpError('TURNSTILE', 'HTTP 403');
  if (status === 404) throw httpError('NOT_FOUND', 'HTTP 404');
  if (status !== null && (status < 200 || status >= 300)) {
    throw httpError('NETWORK', 'HTTP ' + status);
  }
  let data;
  try {
    data = await resp.json();
  } catch (e) {
    throw httpError('PARSE', '响应不是合法 JSON');
  }
  if (data && typeof data === 'object' && typeof data.error === 'string') {
    const code = num(data.code);
    const kind = code === 401 ? 'UNAUTHORIZED' : code === 403 ? 'TURNSTILE' : code === 404 ? 'NOT_FOUND' : 'NETWORK';
    throw httpError(kind, data.error);
  }
  return data;
}

// ============ 配置 ============
function readConfig(ctx) {
  const env = (ctx && ctx.env) || {};
  const apiBase = String(env.API_BASE || '').trim().replace(/\/+$/, '');
  const refreshMin = clamp(num(env.REFRESH_MINUTES) ?? 5, 1, 60);
  let historyHours = num(env.HISTORY_HOURS);
  if (historyHours === null) historyHours = 1;
  historyHours = clamp(historyHours, 0.167, 24);
  return {
    apiBase,
    serverId: String(env.SERVER_ID || '').trim(),
    refreshMin,
    historyHours,
    onlineThresholdMs: clamp(num(env.ONLINE_THRESHOLD_MIN) ?? 5, 1, 120) * 60000,
    trendMetric: String(env.TREND_METRIC || 'cpu').toLowerCase() === 'ram' ? 'ram' : 'cpu',
    refreshAfter: new Date(Date.now() + refreshMin * 60000).toISOString(),
  };
}

// ============ 数据获取 ============
async function fetchServer(ctx, cfg, id) {
  const d = await httpJson(ctx, cfg.apiBase + '/api/server?id=' + encodeURIComponent(id));
  const s = unwrap(d);
  if (!s || typeof s !== 'object' || !s.name) throw httpError('PARSE', '服务器数据结构异常');
  return s;
}

async function resolveServer(ctx, cfg) {
  if (cfg.serverId) return fetchServer(ctx, cfg, cfg.serverId);
  const d = await httpJson(ctx, cfg.apiBase + '/api/servers');
  const list = normalizeList(d).filter(s => s && String(s.is_hidden) !== '1');
  if (!list.length) throw httpError('EMPTY', '没有可用服务器');
  return fetchServer(ctx, cfg, list[0].id);
}

/** 历史数据独立 try/catch，失败返回 null 不阻塞主渲染 */
async function fetchHistory(ctx, cfg, id) {
  try {
    const d = await httpJson(ctx, cfg.apiBase + '/api/history/all?id=' + encodeURIComponent(id) + '&hours=' + cfg.historyHours);
    const rows = Array.isArray(d) ? d : (Array.isArray(unwrap(d)) ? unwrap(d) : (unwrap(d) && unwrap(d).history));
    return Array.isArray(rows) ? rows : null;
  } catch (e) {
    return null;
  }
}

/** 提取趋势点列（0-100），>160 点等距抽样 */
function pickTrend(history, metric) {
  if (!Array.isArray(history) || history.length < 2) return null;
  let pts = [];
  for (const row of history) {
    if (!row || typeof row !== 'object') continue;
    let v = null;
    if (metric === 'ram') v = pctOf(row.ram_used, row.ram_total);
    else v = num(row.cpu);
    if (v !== null && isFinite(v)) pts.push(clamp(v, 0, 100));
  }
  if (pts.length < 2) return null;
  if (pts.length > 160) {
    const step = pts.length / 160;
    const sampled = [];
    for (let i = 0; i < 160; i++) sampled.push(pts[Math.floor(i * step)]);
    pts = sampled;
  }
  return pts;
}

// ============ 视图模型 ============
function buildViewModel(server, history, cfg) {
  const now = Date.now();
  const lastUpdatedMs = normalizeTs(server.last_updated) ?? normalizeTs(server.timestamp);
  const online = lastUpdatedMs !== null && (now - lastUpdatedMs) <= cfg.onlineThresholdMs;
  const bootMs = normalizeTs(server.boot_time);

  const cpuPct = num(server.cpu) !== null ? clamp(num(server.cpu), 0, 100) : null;
  const ramPct = pctOf(server.ram_used, server.ram_total);
  const diskPct = pctOf(server.disk_used, server.disk_total);

  // 本月流量（字节），按 traffic_calc_type 取值
  const rxM = num(server.net_rx_monthly);
  const txM = num(server.net_tx_monthly);
  let monthUsed = null;
  const calcType = String(server.traffic_calc_type || 'total');
  if (calcType === 'dl') monthUsed = rxM;
  else if (calcType === 'ul') monthUsed = txM;
  else if (calcType === 'max') monthUsed = (rxM === null && txM === null) ? null : Math.max(rxM ?? 0, txM ?? 0);
  else monthUsed = (rxM === null && txM === null) ? null : (rxM ?? 0) + (txM ?? 0);
  const limitBytes = parseTrafficLimit(server.traffic_limit);
  const monthPct = (monthUsed !== null && limitBytes) ? clamp((monthUsed / limitBytes) * 100, 0, 100) : null;

  const loadParts = typeof server.load_avg === 'string' ? server.load_avg.trim().split(/\s+/).slice(0, 3) : [];

  const pingDefs = [
    ['电信', 'ping_ct', 'loss_ct'],
    ['联通', 'ping_cu', 'loss_cu'],
    ['移动', 'ping_cm', 'loss_cm'],
    ['境外', 'ping_bd', 'loss_bd'],
  ];
  const pings = pingDefs.map(([label, pk, lk]) => ({
    label,
    ping: num(server[pk]),
    loss: num(server[lk]),
  }));

  const price = String(server.price ?? '').trim();
  const priceText = (price === '0' || price === '-1') ? '免费' : (price ? (String(server.currency || '') + price) : null);

  return {
    name: String(server.name || '未命名'),
    region: String(server.region || '').trim(),
    group: String(server.server_group || '').trim(),
    online,
    lastUpdatedMs,
    lastUpdatedISO: lastUpdatedMs ? new Date(lastUpdatedMs).toISOString() : null,
    cpuPct, ramPct, diskPct,
    cores: num(server.cpu_cores),
    ramDetail: fmtMB(server.ram_used) + ' / ' + fmtMB(server.ram_total),
    diskDetail: fmtMB(server.disk_used) + ' / ' + fmtMB(server.disk_total),
    swapTotal: num(server.swap_total),
    swapPct: pctOf(server.swap_used, server.swap_total),
    load1: loadParts[0] || null,
    loadText: loadParts.length ? loadParts.join(' / ') : null,
    downSpeed: fmtSpeed(server.net_in_speed),
    upSpeed: fmtSpeed(server.net_out_speed),
    totalDown: fmtBytes(server.net_rx),
    totalUp: fmtBytes(server.net_tx),
    monthUsedText: monthUsed !== null ? fmtBytes(monthUsed) : null,
    monthPct,
    monthLimitText: limitBytes ? String(server.traffic_limit).trim() : null,
    pings,
    processes: num(server.processes),
    tcp: num(server.tcp_conn),
    udp: num(server.udp_conn),
    uptimeText: (bootMs && lastUpdatedMs && lastUpdatedMs > bootMs) ? fmtUptime(lastUpdatedMs - bootMs) : null,
    expireISO: server.expire_date ? String(server.expire_date).trim() + 'T00:00:00Z' : null,
    priceText,
    autoRenewal: String(server.auto_renewal) === '1',
    trend: pickTrend(history, cfg.trendMetric),
    trendCurrent: cfg.trendMetric === 'ram' ? ramPct : cpuPct,
    trendLabel: cfg.trendMetric === 'ram' ? '内存趋势' : 'CPU 趋势',
  };
}

// ============ DSL 原子组件 ============
function txt(text, opts) {
  return Object.assign({ type: 'text', text: String(text), maxLines: 1, minScale: 0.7 }, opts || {});
}

function sfSymbol(name, size, color) {
  return { type: 'image', src: 'sf-symbol:' + name, width: size, height: size, color };
}

/** 进度条：嵌套 stack + flex 整数比 */
function bar(pct, color, h) {
  h = h || 5;
  const n = clamp(Math.round(pct ?? 0), 0, 100);
  const children = [];
  if (n > 0) children.push({ type: 'stack', flex: n, height: h, backgroundColor: color, borderRadius: h / 2 });
  if (n < 100) children.push({ type: 'stack', flex: 100 - n, height: h });
  return {
    type: 'stack', direction: 'row', height: h, flex: 1, gap: 0,
    backgroundColor: C.track, borderRadius: h / 2, children,
  };
}

/** 状态胶囊 */
function badge(text, colorKey) {
  const fg = C[colorKey];
  const bg = BADGE_BG[colorKey] || BADGE_BG.ok;
  return {
    type: 'stack', padding: [2, 8, 2, 8], borderRadius: 9, backgroundColor: bg,
    children: [txt(text, { font: { size: 'caption2', weight: 'semibold' }, textColor: fg })],
  };
}

/** 共用头部行 */
function headerRow(vm, isLarge) {
  const children = [
    sfSymbol('circle.fill', 8, vm.online ? C.ok : C.bad),
    txt(vm.name, {
      font: { size: isLarge ? 'title3' : 'headline', weight: 'semibold' },
      textColor: C.textPrimary,
    }),
  ];
  const sub = [vm.region, vm.group].filter(Boolean).join(' · ');
  if (sub) children.push(txt(sub, { font: { size: 'caption2' }, textColor: C.textSecondary }));
  children.push({ type: 'spacer' });
  if (vm.online) {
    children.push(badge('在线', 'ok'));
  } else if (vm.lastUpdatedISO) {
    children.push({
      type: 'date', date: vm.lastUpdatedISO, format: 'relative',
      font: { size: 'caption2', weight: 'semibold' }, textColor: C.bad, maxLines: 1,
    });
  } else {
    children.push(badge('离线', 'bad'));
  }
  return { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children };
}

function pingColor(p) {
  if (p === null) return C.textTertiary;
  if (p >= 200) return C.bad;
  if (p >= 100) return C.warn;
  return C.ok;
}

// ============ SVG 趋势图 ============
function trendImage(points) {
  if (!points || points.length < 2) return null;
  const W = 300, H = 56, padX = 2, padTop = 6, padBottom = 4;
  const innerH = H - padTop - padBottom;
  const n = points.length;
  const xy = points.map((v, i) => {
    const x = padX + (i * (W - padX * 2)) / (n - 1);
    const y = padTop + (1 - v / 100) * innerH;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });
  const line = 'M ' + xy.map(p => p[0] + ' ' + p[1]).join(' L ');
  const area = line + ' L ' + xy[n - 1][0] + ' ' + (H - padBottom) + ' L ' + xy[0][0] + ' ' + (H - padBottom) + ' Z';
  const last = xy[n - 1];
  const midY = Math.round((padTop + innerH / 2) * 10) / 10;
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + W + ' ' + H + "'>" +
    "<path d='" + area + "' fill='" + TREND_FILL + "' stroke='none'/>" +
    "<line x1='" + padX + "' y1='" + midY + "' x2='" + (W - padX) + "' y2='" + midY + "' stroke='" + TREND_GRID + "' stroke-width='0.5' stroke-dasharray='3 3'/>" +
    "<path d='" + line + "' stroke='" + TREND_COLOR + "' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/>" +
    "<circle cx='" + last[0] + "' cy='" + last[1] + "' r='2' fill='" + TREND_COLOR + "'/>" +
    '</svg>';
  return { type: 'image', src: encodeSvg(svg), height: H, flex: 1 };
}

// ============ 尺寸布局 ============
function metricCol(label, pct, detail, accentKey, offline) {
  const valueColor = offline ? C.textSecondary : usageColor(pct, accentKey);
  const barColor = offline ? C.textTertiary : usageColor(pct, accentKey);
  return {
    type: 'stack', direction: 'column', alignItems: 'start', gap: 3, flex: 1,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', flex: 1,
        children: [
          txt(label, { font: { size: 'caption2', weight: 'medium' }, textColor: C.textSecondary }),
          { type: 'spacer' },
          txt(pct === null ? '--' : Math.round(pct) + '%', { font: { size: 'footnote', weight: 'semibold' }, textColor: valueColor }),
        ],
      },
      bar(pct ?? 0, barColor),
      txt(detail, { font: { size: 'caption2' }, textColor: C.textTertiary }),
    ],
  };
}

function renderMedium(vm, cfg) {
  const off = !vm.online;
  const pingVals = vm.pings.slice(0, 3).map(p => p.ping).filter(v => v !== null);
  const pingText = pingVals.length
    ? 'Ping ' + Math.round(pingVals.reduce((a, b) => a + b, 0) / pingVals.length) + 'ms'
    : 'Ping --';

  return {
    type: 'widget',
    padding: 14,
    backgroundColor: C.bg,
    url: cfg.apiBase,
    refreshAfter: cfg.refreshAfter,
    children: [
      headerRow(vm, false),
      { type: 'spacer', length: 10 },
      {
        type: 'stack', direction: 'row', gap: 10, alignItems: 'start',
        children: [
          metricCol('CPU', vm.cpuPct, vm.cores ? vm.cores + ' 核' : (vm.load1 ? '负载 ' + vm.load1 : '--'), 'cpu', off),
          metricCol('内存', vm.ramPct, vm.ramDetail, 'mem', off),
          metricCol('磁盘', vm.diskPct, vm.diskDetail, 'disk', off),
        ],
      },
      { type: 'spacer' },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          sfSymbol('arrow.down', 10, C.ok),
          txt(vm.downSpeed, { font: { size: 'footnote', weight: 'medium' }, textColor: C.textPrimary }),
          { type: 'spacer', length: 10 },
          sfSymbol('arrow.up', 10, C.cpu),
          txt(vm.upSpeed, { font: { size: 'footnote', weight: 'medium' }, textColor: C.textPrimary }),
          { type: 'spacer' },
          txt(pingText, { font: { size: 'caption2' }, textColor: C.textSecondary }),
        ],
      },
      { type: 'spacer', length: 6 },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          txt(vm.loadText ? '负载 ' + vm.loadText : '', { font: { size: 'caption2' }, textColor: C.textTertiary }),
          { type: 'spacer' },
          sfSymbol('clock', 9, C.textTertiary),
          vm.lastUpdatedISO
            ? { type: 'date', date: vm.lastUpdatedISO, format: 'relative', font: { size: 'caption2' }, textColor: C.textTertiary, maxLines: 1 }
            : txt('--', { font: { size: 'caption2' }, textColor: C.textTertiary }),
        ],
      },
    ],
  };
}

function metricCard(symbol, label, pct, detail, accentKey, offline) {
  const valueColor = offline ? C.textSecondary : usageColor(pct, accentKey);
  const barColor = offline ? C.textTertiary : usageColor(pct, accentKey);
  return {
    type: 'stack', direction: 'column', alignItems: 'start', gap: 4, flex: 1,
    padding: 8, backgroundColor: C.cardBg, borderRadius: 10,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          sfSymbol(symbol, 12, C[accentKey]),
          txt(label, { font: { size: 'caption2' }, textColor: C.textSecondary }),
        ],
      },
      txt(pct === null ? '--' : Math.round(pct) + '%', { font: { size: 'title3', weight: 'bold' }, textColor: valueColor }),
      bar(pct ?? 0, barColor),
      txt(detail, { font: { size: 'caption2' }, textColor: C.textTertiary }),
    ],
  };
}

function renderLarge(vm, cfg) {
  const off = !vm.online;
  const children = [headerRow(vm, true), { type: 'spacer', length: 10 }];

  // R2 指标卡
  children.push({
    type: 'stack', direction: 'row', gap: 10, alignItems: 'start',
    children: [
      metricCard('cpu', 'CPU', vm.cpuPct, (vm.cores ? vm.cores + ' vCPU' : '--') + (vm.load1 ? ' · ' + vm.load1 : ''), 'cpu', off),
      metricCard('memorychip', '内存', vm.ramPct, vm.ramDetail, 'mem', off),
      metricCard('internaldrive', '磁盘', vm.diskPct, vm.diskDetail, 'disk', off),
    ],
  });
  children.push({ type: 'spacer', length: 10 });

  // R3 趋势卡（history 失败时不渲染）
  const trend = trendImage(vm.trend);
  if (trend) {
    children.push({
      type: 'stack', direction: 'column', alignItems: 'start', gap: 4,
      padding: [8, 10, 8, 10], backgroundColor: C.cardBg, borderRadius: 10,
      children: [
        {
          type: 'stack', direction: 'row', alignItems: 'center', flex: 1,
          children: [
            txt(vm.trendLabel + ' · ' + (cfg.historyHours < 1 ? Math.round(cfg.historyHours * 60) + 'min' : cfg.historyHours + 'h'), { font: { size: 'caption2' }, textColor: C.textSecondary }),
            { type: 'spacer' },
            txt(vm.trendCurrent === null ? '' : Math.round(vm.trendCurrent) + '%', { font: { size: 'caption2', weight: 'semibold' }, textColor: C.cpu }),
          ],
        },
        trend,
      ],
    });
    children.push({ type: 'spacer', length: 10 });
  }

  // R4 网络行
  const netCardChildren = [
    {
      type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
      children: [
        sfSymbol('arrow.down', 10, C.ok),
        txt(vm.downSpeed, { font: { size: 'footnote', weight: 'semibold' }, textColor: C.textPrimary }),
      ],
    },
    {
      type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
      children: [
        sfSymbol('arrow.up', 10, C.cpu),
        txt(vm.upSpeed, { font: { size: 'footnote', weight: 'semibold' }, textColor: C.textPrimary }),
      ],
    },
    txt('累计 ↓' + vm.totalDown + ' ↑' + vm.totalUp, { font: { size: 'caption2' }, textColor: C.textTertiary }),
  ];
  const monthCardChildren = [
    txt('本月流量', { font: { size: 'caption2' }, textColor: C.textSecondary }),
    txt(vm.monthUsedText ?? '--', { font: { size: 'footnote', weight: 'semibold' }, textColor: C.textPrimary }),
  ];
  if (vm.monthPct !== null && vm.monthLimitText) {
    monthCardChildren.push(bar(vm.monthPct, usageColor(vm.monthPct, 'disk')));
    monthCardChildren.push(txt('/ ' + vm.monthLimitText + ' · ' + Math.round(vm.monthPct) + '%', { font: { size: 'caption2' }, textColor: C.textTertiary }));
  } else {
    monthCardChildren.push({ type: 'spacer' });
  }
  children.push({
    type: 'stack', direction: 'row', gap: 10, alignItems: 'start',
    children: [
      { type: 'stack', direction: 'column', alignItems: 'start', gap: 4, flex: 1, padding: 8, backgroundColor: C.cardBg, borderRadius: 10, children: netCardChildren },
      { type: 'stack', direction: 'column', alignItems: 'start', gap: 4, flex: 1, padding: 8, backgroundColor: C.cardBg, borderRadius: 10, children: monthCardChildren },
    ],
  });
  children.push({ type: 'spacer', length: 10 });

  // R5 Ping 四格
  children.push({
    type: 'stack', direction: 'row', gap: 8,
    children: vm.pings.map(p => {
      const lossText = (p.loss !== null && p.loss > 0) ? ' ·' + Math.round(p.loss) + '%' : '';
      return {
        type: 'stack', direction: 'column', alignItems: 'center', gap: 2, flex: 1,
        children: [
          txt(p.label + lossText, { font: { size: 'caption2' }, textColor: (p.loss !== null && p.loss >= 5) ? (p.loss >= 20 ? C.bad : C.warn) : C.textTertiary }),
          txt(p.ping === null ? '--' : Math.round(p.ping) + 'ms', { font: { size: 'footnote', weight: 'semibold' }, textColor: off ? C.textSecondary : pingColor(p.ping) }),
        ],
      };
    }),
  });
  children.push({ type: 'spacer', length: 10 });

  // R6 系统信息行
  const sysItems = [];
  if (vm.loadText) sysItems.push('负载 ' + vm.loadText);
  if (vm.processes !== null) sysItems.push('进程 ' + vm.processes);
  if (vm.tcp !== null || vm.udp !== null) sysItems.push('TCP ' + (vm.tcp ?? '--') + ' / UDP ' + (vm.udp ?? '--'));
  if (sysItems.length) {
    children.push(txt(sysItems.join('   '), { font: { size: 'caption1' }, textColor: C.textSecondary }));
  }

  children.push({ type: 'spacer' });

  // R7 底行
  const bottomChildren = [];
  if (vm.uptimeText) {
    bottomChildren.push(sfSymbol('clock', 10, C.textTertiary));
    bottomChildren.push(txt('运行 ' + vm.uptimeText, { font: { size: 'caption2' }, textColor: C.textSecondary }));
  }
  if (vm.expireISO) {
    if (bottomChildren.length) bottomChildren.push({ type: 'spacer', length: 10 });
    bottomChildren.push(sfSymbol('calendar', 10, C.textTertiary));
    bottomChildren.push({ type: 'date', date: vm.expireISO, format: 'date', font: { size: 'caption2' }, textColor: C.textSecondary, maxLines: 1 });
    if (vm.priceText) bottomChildren.push(txt(vm.priceText + (vm.autoRenewal ? ' · 自动续费' : ''), { font: { size: 'caption2' }, textColor: C.textTertiary }));
  }
  bottomChildren.push({ type: 'spacer' });
  if (vm.lastUpdatedISO) {
    bottomChildren.push({ type: 'date', date: vm.lastUpdatedISO, format: 'relative', font: { size: 'caption2' }, textColor: C.textTertiary, maxLines: 1 });
  }
  children.push({ type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: bottomChildren });

  return {
    type: 'widget',
    padding: 14,
    backgroundColor: C.bg,
    url: cfg.apiBase,
    refreshAfter: cfg.refreshAfter,
    children,
  };
}

// ============ 错误 / 状态页 ============
const STATUS_DEFS = {
  NO_CONFIG:    { icon: 'gearshape',                 color: 'warn', title: '缺少配置',         desc: '请在小组件 env 中设置 API_BASE（站点地址）' },
  TURNSTILE:    { icon: 'hand.raised.fill',          color: 'warn', title: '访问被人机验证拦截', desc: '站点开启了全局 Turnstile 验证，匿名 API 返回 403' },
  UNAUTHORIZED: { icon: 'lock.fill',                 color: 'bad',  title: '站点未公开',       desc: '该站点 is_public 关闭或需登录，本小组件仅支持公开站点' },
  NOT_FOUND:    { icon: 'questionmark.circle',       color: 'warn', title: '服务器不存在',     desc: 'SERVER_ID 无效或该服务器已设为隐藏' },
  EMPTY:        { icon: 'server.rack',               color: 'warn', title: '没有可用服务器',   desc: '站点服务器列表为空' },
  NETWORK:      { icon: 'wifi.slash',                color: 'bad',  title: '请求失败',         desc: '' },
  PARSE:        { icon: 'exclamationmark.triangle',  color: 'bad',  title: '数据格式异常',     desc: '' },
};

function renderStatus(kind, detail, cfg) {
  const def = STATUS_DEFS[kind] || STATUS_DEFS.NETWORK;
  const desc = detail ? def.desc + (def.desc ? '：' : '') + String(detail).slice(0, 80) : def.desc;
  return {
    type: 'widget',
    padding: 16,
    backgroundColor: C.bg,
    refreshAfter: cfg.refreshAfter,
    children: [
      { type: 'spacer' },
      {
        type: 'stack', direction: 'column', alignItems: 'start', gap: 6,
        children: [
          sfSymbol(def.icon, 26, C[def.color]),
          txt(def.title, { font: { size: 'headline', weight: 'semibold' }, textColor: C.textPrimary }),
          txt(desc, { font: { size: 'footnote' }, textColor: C.textSecondary, maxLines: 3, minScale: 0.8 }),
        ],
      },
      { type: 'spacer' },
    ],
  };
}

// ============ 主入口 ============
export default async function (ctx) {
  const cfg = readConfig(ctx);
  if (!cfg.apiBase) return renderStatus('NO_CONFIG', null, cfg);
  try {
    const server = await resolveServer(ctx, cfg);
    const isLarge = ctx && ctx.widgetFamily === 'systemLarge';
    const history = isLarge ? await fetchHistory(ctx, cfg, server.id) : null;
    const vm = buildViewModel(server, history, cfg);
    return isLarge ? renderLarge(vm, cfg) : renderMedium(vm, cfg);
  } catch (e) {
    return renderStatus(e && e.kind ? e.kind : 'NETWORK', e && e.message, cfg);
  }
}
