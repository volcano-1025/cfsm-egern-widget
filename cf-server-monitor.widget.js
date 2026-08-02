/**
 * CF-Server-Monitor × Egern 小组件
 * 像素级复刻 Lumina（komari-theme-Lumina）节点卡片风格：
 * 18 段指标条、24 格延迟/丢包迷你条、热力色阶、自适应深浅色。
 * 适配 systemMedium / systemLarge。
 *
 * 环境变量（在 Egern 小组件 env 中配置）：
 *   API_BASE              必填，站点地址，如 https://status.example.com
 *   SERVER_ID             可选，服务器 UUID；为空时自动选取列表中第一台可见服务器
 *   REFRESH_MINUTES       可选，刷新间隔分钟数，默认 1（1-60）
 *   ONLINE_THRESHOLD_MIN  可选，离线判定阈值分钟数，默认 5
 */

// ============ Lumina 色板（tokens.css 精确移植，自适应深浅色） ============
function adapt(light, dark) { return { light, dark }; }
const C = {
  bg:            adapt('#FFFFFF', '#0F0F10'),
  textPrimary:   adapt('#18181B', '#DDDDDF'),
  textSecondary: adapt('#52525B', '#A5A5AA'),
  textTertiary:  adapt('#71717A', '#76767C'),
  hairline:      adapt('#18181B14', '#FFFFFF0F'),
  pillBg:        adapt('#FFFFFF6B', '#1212146B'),
  pillBorder:    adapt('#18181B08', '#FFFFFF06'),
  track:         adapt('#E4E4E794', '#26262A94'), // progress-bg @ 0.58
  stripTrack:    adapt('#E4E4E76B', '#26262A6B'), // progress-bg @ 0.42
  cpu:           adapt('#3B82F6', '#5D88FF'),
  mem:           adapt('#8B5CF6', '#A35CF5'),
  disk:          adapt('#E97B35', '#F1873D'),
  network:       adapt('#10B981', '#5BBB8A'),
  online:        adapt('#2F9E65', '#61C08F'),
  offline:       adapt('#DC2626', '#D84E45'),
};

// ============ 颜色工具 ============
function clamp(v, lo, hi) {
  v = Number(v);
  if (!isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}
/** hex '#RRGGBB' + 透明度 0..1 → '#RRGGBBAA' */
function alpha(hex, a) {
  const b = Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0').toUpperCase();
  return hex + b;
}
function alphaAdapt(ad, a) { return adapt(alpha(ad.light, a), alpha(ad.dark, a)); }
function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgbToHex(r, g, b) {
  const p = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0').toUpperCase();
  return '#' + p(r) + p(g) + p(b);
}
/** 线性插值两个自适应色，t=0..1，返回自适应色 */
function lerpAdapt(from, to, t) {
  const f = hexToRgb(from.light), g = hexToRgb(to.light);
  const f2 = hexToRgb(from.dark), g2 = hexToRgb(to.dark);
  return adapt(
    rgbToHex(f[0] + (g[0] - f[0]) * t, f[1] + (g[1] - f[1]) * t, f[2] + (g[2] - f[2]) * t),
    rgbToHex(f2[0] + (g2[0] - f2[0]) * t, f2[1] + (g2[1] - f2[1]) * t, f2[2] + (g2[2] - f2[2]) * t)
  );
}
/** HSL → hex（metricTone.ts / expireStatus.ts 移植用） */
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = t => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}

// ============ 热力色阶（Lumina metricTone / expireStatus 精确移植） ============
function latencyHeat(ms) {
  if (ms === null || !isFinite(ms) || ms < 0) return null;
  if (ms <= 100) { const t = clamp(ms / 100, 0, 1); return hslToHex(145 - 18 * t, 62 + 8 * t, 48 + 3 * t); }
  if (ms <= 150) { const t = clamp((ms - 100) / 50, 0, 1); return hslToHex(127 - 47 * t, 70 + 6 * t, 51 + t); }
  if (ms <= 200) { const t = clamp((ms - 150) / 50, 0, 1); return hslToHex(80 - 30 * t, 76 + 6 * t, 52 + t); }
  if (ms <= 300) { const t = clamp((ms - 200) / 100, 0, 1); return hslToHex(50 - 20 * t, 82 + 4 * t, 53 - t); }
  const t = clamp((ms - 300) / 300, 0, 1); return hslToHex(30 - 24 * t, 86 - 2 * t, 52 - 8 * t);
}
function lossHeat(pct) {
  if (pct === null || !isFinite(pct) || pct < 0) return null;
  if (pct <= 1) { const t = clamp(pct, 0, 1); return hslToHex(145 - 18 * t, 62 + 8 * t, 48 + 3 * t); }
  if (pct <= 3) { const t = clamp((pct - 1) / 2, 0, 1); return hslToHex(127 - 47 * t, 70 + 6 * t, 51 + t); }
  if (pct <= 5) { const t = clamp((pct - 3) / 2, 0, 1); return hslToHex(80 - 30 * t, 76 + 6 * t, 52 + t); }
  if (pct <= 10) { const t = clamp((pct - 5) / 5, 0, 1); return hslToHex(50 - 20 * t, 82 + 4 * t, 53 - t); }
  const t = clamp((pct - 10) / 20, 0, 1); return hslToHex(30 - 24 * t, 86 - 2 * t, 52 - 8 * t);
}
function expireHeat(days) {
  if (days > 36500) return null; // 用 status-success
  if (days <= 0) return hslToHex(6, 84, 53);
  if (days <= 7) { const t = clamp(days / 7, 0, 1); return hslToHex(8 + 24 * t, 84 - 4 * t, 53 - t); }
  if (days <= 30) { const t = clamp((days - 7) / 23, 0, 1); return hslToHex(32 + 18 * t, 80 - 4 * t, 52); }
  const t = clamp((Math.min(days, 180) - 30) / 150, 0, 1); return hslToHex(50 + 94 * t, 76 - 10 * t, 52 - 4 * t);
}

// ============ 格式化（Lumina format.ts 移植） ============
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
function formatBytes(n) {
  if (!n || n < 0) return '0 B';
  let i = 0, v = n;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) { v /= 1024; i++; }
  if (i === 0) return Math.round(v) + ' B';
  const dec = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return v.toFixed(dec) + ' ' + BYTE_UNITS[i];
}
const MIB = 1024 * 1024;
function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return null;
  const days = seconds / 86400;
  if (days >= 1) return { value: String(Math.floor(days)), unit: '天' };
  const hours = seconds / 3600;
  if (hours >= 1) return { value: String(Math.floor(hours)), unit: '小时' };
  return { value: String(Math.floor(seconds / 60)), unit: '分钟' };
}
function formatExpire(dateStr) {
  if (!dateStr) return null;
  const ts = Date.parse(String(dateStr).trim());
  if (isNaN(ts)) return null;
  const days = Math.floor((ts - Date.now()) / 86400000);
  if (days > 36500) return { value: '长期', unit: '', color: C.online };
  if (days > 0) return { value: String(days), unit: '天', color: expireHeat(days) };
  if (days === 0) return { value: '今日', unit: '', color: expireHeat(0) };
  return { value: '已过期', unit: '', color: expireHeat(-1) };
}

// ============ 通用工具 ============
function normalizeTs(v) {
  const n = num(v);
  if (n === null || n <= 0) return null;
  return n < 1e10 ? n * 1000 : n;
}
function pctOf(used, total) {
  used = num(used); total = num(total);
  if (used === null || total === null || total <= 0) return null;
  return clamp(used / total, 0, 1);
}
function parseTrafficLimit(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)$/i);
  if (!m) return null;
  const pow = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4, PB: 5 }[m[2].toUpperCase()];
  return Number(m[1]) * Math.pow(1024, pow);
}
function unwrap(d) {
  if (d && typeof d === 'object' && d.data && typeof d.data === 'object' && !Array.isArray(d.data)) return d.data;
  return d;
}
function normalizeList(d) {
  d = unwrap(d);
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    if (Array.isArray(d.servers)) return d.servers;
    if (Array.isArray(d.list)) return d.list;
  }
  return [];
}
function flagEmoji(region) {
  const code = String(region || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}
function avgOf(obj, keys) {
  const vals = keys.map(k => num(obj && obj[k])).filter(v => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
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
  if (status !== null && (status < 200 || status >= 300)) throw httpError('NETWORK', 'HTTP ' + status);
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
  const refreshMin = clamp(num(env.REFRESH_MINUTES) ?? 1, 1, 60);
  return {
    apiBase: String(env.API_BASE || '').trim().replace(/\/+$/, ''),
    serverId: String(env.SERVER_ID || '').trim(),
    onlineThresholdMs: clamp(num(env.ONLINE_THRESHOLD_MIN) ?? 5, 1, 120) * 60000,
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
/** 近 1 小时历史（匿名允许范围），独立 try/catch，失败返回 null */
async function fetchHistory(ctx, cfg, id) {
  try {
    const d = await httpJson(ctx, cfg.apiBase + '/api/history/all?id=' + encodeURIComponent(id) + '&hours=1');
    return Array.isArray(d) ? d : null;
  } catch (e) {
    return null;
  }
}

const PING_KEYS = ['ping_ct', 'ping_cu', 'ping_cm', 'ping_bd'];
const LOSS_KEYS = ['loss_ct', 'loss_cu', 'loss_cm', 'loss_bd'];
/** 从历史行提取 ping/loss 时间序列（每行取四路均值），>24 点等距抽样 */
function pickSeries(history, keys) {
  if (!Array.isArray(history) || history.length < 2) return null;
  let pts = history.map(row => avgOf(row, keys));
  if (pts.filter(v => v !== null).length < 2) return null;
  if (pts.length > 24) {
    const step = pts.length / 24;
    const sampled = [];
    for (let i = 0; i < 24; i++) sampled.push(pts[Math.floor(i * step)]);
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
  const cores = num(server.cpu_cores);

  const cpuFrac = num(server.cpu) !== null ? clamp(num(server.cpu) / 100, 0, 1) : null;
  const ramFrac = pctOf(server.ram_used, server.ram_total);
  const diskFrac = pctOf(server.disk_used, server.disk_total);
  const loadParts = typeof server.load_avg === 'string' ? server.load_avg.trim().split(/\s+/) : [];
  const load1 = num(loadParts[0]);
  const loadFrac = load1 !== null ? clamp(load1 / (cores > 0 ? cores : 4), 0, 1) : null;

  // 本月流量（字节）
  const rxM = num(server.net_rx_monthly), txM = num(server.net_tx_monthly);
  let monthUsed = null;
  const calcType = String(server.traffic_calc_type || 'total');
  if (calcType === 'dl') monthUsed = rxM;
  else if (calcType === 'ul') monthUsed = txM;
  else if (calcType === 'max') monthUsed = (rxM === null && txM === null) ? null : Math.max(rxM ?? 0, txM ?? 0);
  else monthUsed = (rxM === null && txM === null) ? null : (rxM ?? 0) + (txM ?? 0);
  const limitBytes = parseTrafficLimit(server.traffic_limit);

  const pingNow = avgOf(server, PING_KEYS);
  const lossNow = avgOf(server, LOSS_KEYS);

  const group = String(server.server_group || '').trim();
  const osArch = [server.os, server.arch].map(s => String(s || '').trim()).filter(Boolean).join(' · ');
  let subtitle = group || osArch || null;
  if (!online && lastUpdatedMs) {
    const min = Math.floor((now - lastUpdatedMs) / 60000);
    subtitle = '离线 ' + (min < 60 ? min + ' 分钟' : min < 1440 ? Math.floor(min / 60) + ' 小时' : Math.floor(min / 1440) + ' 天');
  }

  return {
    name: String(server.name || '未命名'),
    flag: flagEmoji(server.region),
    online,
    subtitle,
    cpuFrac, ramFrac, diskFrac, load1, loadFrac,
    cpuPctText: cpuFrac === null ? '--' : (cpuFrac * 100).toFixed(2),
    ramPctText: ramFrac === null ? '--' : (ramFrac * 100).toFixed(2),
    diskPctText: diskFrac === null ? '--' : (diskFrac * 100).toFixed(1),
    loadText: load1 === null ? '--' : load1.toFixed(2),
    cpuDetail: cores ? cores + ' 核' : null,
    ramDetail: formatBytes(num(server.ram_used) * MIB) + ' / ' + formatBytes(num(server.ram_total) * MIB),
    diskDetail: formatBytes(num(server.disk_used) * MIB) + ' / ' + formatBytes(num(server.disk_total) * MIB),
    monthText: monthUsed !== null ? formatBytes(monthUsed) + ' / ' + (limitBytes ? String(server.traffic_limit).trim() : '∞') : null,
    monthFrac: (monthUsed !== null && limitBytes) ? clamp(monthUsed / limitBytes, 0, 1) : null,
    pingNow, lossNow,
    pingSeries: pickSeries(history, PING_KEYS),
    lossSeries: pickSeries(history, LOSS_KEYS),
    uptime: (bootMs && lastUpdatedMs && lastUpdatedMs > bootMs) ? formatUptime((lastUpdatedMs - bootMs) / 1000) : null,
    expire: formatExpire(server.expire_date),
  };
}

// ============ DSL 原子组件 ============
function txt(text, opts) {
  return Object.assign({ type: 'text', text: String(text), maxLines: 1, minScale: 0.7 }, opts || {});
}
function sfSymbol(name, size, color) {
  return { type: 'image', src: 'sf-symbol:' + name, width: size, height: size, color };
}
/** 数值 + 单位（13px 半粗主色 + 11px 三级色，Lumina MetricBar 风格） */
function valueUnit(value, unit, opts) {
  opts = opts || {};
  const children = [
    txt(value, { font: { size: opts.size || 13, weight: 'semibold' }, textColor: opts.color || C.textPrimary }),
  ];
  if (unit) children.push(txt(unit, { font: { size: 11, weight: 'medium' }, textColor: C.textTertiary }));
  return { type: 'stack', direction: 'row', alignItems: 'end', gap: 1, children };
}

// ============ Lumina 分段条 ============
const SEGMENTS = 18;
/**
 * 18 段指标条：非激活段 track（58% 透明），激活段 alpha = 0.42 + fillLevel*0.56
 * paint: { kind:'solid', color: adaptive } 或 { kind:'gradient', from, to }
 */
function metricTrack(fraction, paint) {
  const active = clamp(fraction ?? 0, 0, 1) * SEGMENTS;
  const children = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const fillLevel = clamp(active - i, 0, 1);
    let bg;
    if (fillLevel > 0) {
      const base = paint.kind === 'gradient' ? lerpAdapt(paint.from, paint.to, SEGMENTS > 1 ? i / (SEGMENTS - 1) : 0) : paint.color;
      bg = alphaAdapt(base, 0.42 + fillLevel * 0.56);
    } else {
      bg = C.track;
    }
    children.push({ type: 'stack', flex: 1, height: 10, borderRadius: 2, backgroundColor: bg });
  }
  return { type: 'stack', direction: 'row', gap: 2, children };
}
/** 24 格迷你条（延迟/丢包）：激活 alpha 0.94，未激活 stripTrack */
const STRIP_BARS = 24;
function miniStrip(series, heatFn, fallbackValue) {
  const children = [];
  const fallbackHeat = heatFn(fallbackValue);
  for (let i = 0; i < STRIP_BARS; i++) {
    const v = series ? series[i] : undefined;
    const hasValue = v !== undefined && v !== null;
    let bg;
    if (hasValue) bg = alpha(heatFn(v) || '#71717A', 0.94);
    else if (!series && fallbackValue !== null) bg = alpha(fallbackHeat || '#71717A', 0.94);
    else bg = C.stripTrack;
    children.push({ type: 'stack', flex: 1, height: 13, borderRadius: 2, backgroundColor: bg });
  }
  return { type: 'stack', direction: 'row', alignItems: 'end', height: 16, gap: 2, children };
}
/** 细分隔线（hairline） */
function divider() {
  return { type: 'stack', direction: 'row', children: [{ type: 'stack', flex: 1, height: 1, backgroundColor: C.hairline }] };
}

// ============ Lumina 布局组件 ============
/** 指标项：图标+标签 / 数值+单位 / 明细胶囊 / 18 段条 */
function metricItem(opts) {
  const children = [
    {
      type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
      children: [
        sfSymbol(opts.icon, 13, C.textSecondary),
        txt(opts.label, { font: { size: 11, weight: 'medium' }, textColor: C.textSecondary }),
        { type: 'spacer' },
        valueUnit(opts.value, opts.unit),
      ],
    },
  ];
  if (opts.detail !== undefined) {
    children.push({
      type: 'stack', padding: [2, 8, 2, 8], borderRadius: 10,
      backgroundColor: C.pillBg, borderWidth: 1, borderColor: C.pillBorder,
      children: [txt(opts.detail || ' ', {
        font: { size: 11, weight: 'semibold' },
        textColor: opts.detail ? C.textPrimary : adapt('#00000000', '#00000000'),
      })],
    });
  }
  children.push(metricTrack(opts.fraction, opts.paint));
  return { type: 'stack', direction: 'column', alignItems: 'start', gap: 7, flex: 1, children };
}
/** 双列网格行 */
function grid2(left, right) {
  return { type: 'stack', direction: 'row', gap: 18, alignItems: 'start', children: [left, right] };
}
/** 卡片头：旗帜 + 名称 + 状态点 / 副标题 + 详情按钮 */
function cardHeader(vm, cfg) {
  const dotColor = vm.online ? C.online : C.offline;
  const titleChildren = [];
  if (vm.flag) titleChildren.push(txt(vm.flag, { font: { size: 15 } }));
  titleChildren.push(txt(vm.name, { font: { size: 16, weight: 'semibold' }, textColor: C.textPrimary, minScale: 0.6 }));
  const dot = sfSymbol('circle.fill', 8, dotColor);
  dot.shadowColor = alphaAdapt(dotColor, 0.2);
  dot.shadowRadius = 3;
  dot.shadowOffset = { x: 0, y: 0 };
  titleChildren.push(dot);
  const titleCol = {
    type: 'stack', direction: 'column', alignItems: 'start', gap: 6, flex: 1,
    children: [{ type: 'stack', direction: 'row', alignItems: 'center', gap: 9, children: titleChildren }],
  };
  if (vm.subtitle) titleCol.children.push(txt(vm.subtitle, { font: { size: 11, weight: 'semibold' }, textColor: C.textSecondary }));
  return {
    type: 'stack', direction: 'row', alignItems: 'start', gap: 12,
    children: [
      titleCol,
      {
        type: 'stack', width: 34, height: 34, borderRadius: 10,
        backgroundColor: C.pillBg, borderWidth: 1, borderColor: C.pillBorder,
        alignItems: 'center',
        children: [{ type: 'spacer' }, sfSymbol('arrow.up.right', 13, C.textTertiary), { type: 'spacer' }],
        url: cfg.apiBase,
      },
    ],
  };
}
/** 健康块：延迟 / 丢包率（标签行 + 迷你条） */
function healthBlock(opts) {
  return {
    type: 'stack', direction: 'column', alignItems: 'start', gap: 10, flex: 1,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 7,
        children: [
          sfSymbol(opts.icon, 13, C.textSecondary),
          txt(opts.label, { font: { size: 11, weight: 'semibold' }, textColor: C.textSecondary }),
          { type: 'spacer' },
          valueUnit(opts.value, opts.unit, { size: 16, color: opts.color }),
        ],
      },
      opts.strip,
    ],
  };
}
/** 底部统计：到期 / 在线 */
function footerStat(opts) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 7, flex: 1,
    children: [
      sfSymbol(opts.icon, 13, C.textSecondary),
      txt(opts.label, { font: { size: 11, weight: 'semibold' }, textColor: C.textSecondary }),
      { type: 'spacer' },
      valueUnit(opts.value, opts.unit, { size: 16, color: opts.color }),
    ],
  };
}

// ============ 尺寸布局 ============
function renderMedium(vm, cfg) {
  const off = !vm.online;
  const solid = c => ({ kind: 'solid', color: off ? C.textTertiary : c });
  return {
    type: 'widget',
    padding: 14,
    backgroundColor: C.bg,
    url: cfg.apiBase,
    refreshAfter: cfg.refreshAfter,
    children: [
      cardHeader(vm, cfg),
      { type: 'spacer', length: 12 },
      grid2(
        metricItem({ icon: 'cpu', label: 'CPU', value: vm.cpuPctText, unit: '%', fraction: vm.cpuFrac ?? 0, paint: solid(C.cpu) }),
        metricItem({ icon: 'memorychip', label: '内存', value: vm.ramPctText, unit: '%', fraction: vm.ramFrac ?? 0, paint: solid(C.mem) })
      ),
      { type: 'spacer', length: 12 },
      grid2(
        metricItem({ icon: 'internaldrive', label: '磁盘', value: vm.diskPctText, unit: '%', fraction: vm.diskFrac ?? 0, paint: solid(C.disk) }),
        metricItem({ icon: 'gauge.medium', label: '负载', value: vm.loadText, fraction: vm.loadFrac ?? 0, paint: off ? solid(C.textTertiary) : { kind: 'gradient', from: C.cpu, to: C.mem } })
      ),
      { type: 'spacer' },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
        children: [
          sfSymbol('arrow.clockwise', 11, C.textSecondary),
          txt('在线', { font: { size: 'caption1' }, textColor: C.textSecondary }),
          txt(vm.uptime ? vm.uptime.value + ' ' + vm.uptime.unit : '—', { font: { size: 'caption1', weight: 'semibold' }, textColor: C.cpu }),
          { type: 'spacer' },
          sfSymbol('clock', 11, C.textSecondary),
          txt('延迟', { font: { size: 'caption1' }, textColor: C.textSecondary }),
          txt(vm.pingNow === null ? '—' : Math.round(vm.pingNow) + 'ms', {
            font: { size: 'caption1', weight: 'semibold' },
            textColor: off ? C.textSecondary : (latencyHeat(vm.pingNow) || C.textTertiary),
          }),
        ],
      },
    ],
  };
}

function renderLarge(vm, cfg) {
  const off = !vm.online;
  const solid = c => ({ kind: 'solid', color: off ? C.textTertiary : c });
  const latencyColor = off ? C.textSecondary : (latencyHeat(vm.pingNow) || C.textTertiary);
  const lossColor = off ? C.textSecondary : (lossHeat(vm.lossNow) || C.textTertiary);

  const children = [
    cardHeader(vm, cfg),
    { type: 'spacer', length: 18 },
    // 2×2 指标网格
    grid2(
      metricItem({ icon: 'cpu', label: 'CPU', value: vm.cpuPctText, unit: '%', detail: vm.cpuDetail ?? ' ', fraction: vm.cpuFrac ?? 0, paint: solid(C.cpu) }),
      metricItem({ icon: 'memorychip', label: '内存', value: vm.ramPctText, unit: '%', detail: vm.ramDetail, fraction: vm.ramFrac ?? 0, paint: solid(C.mem) })
    ),
    { type: 'spacer', length: 14 },
    grid2(
      metricItem({ icon: 'internaldrive', label: '磁盘', value: vm.diskPctText, unit: '%', detail: vm.diskDetail, fraction: vm.diskFrac ?? 0, paint: solid(C.disk) }),
      metricItem({ icon: 'gauge.medium', label: '负载', value: vm.loadText, detail: ' ', fraction: vm.loadFrac ?? 0, paint: off ? solid(C.textTertiary) : { kind: 'gradient', from: C.cpu, to: C.mem } })
    ),
  ];

  // 剩余流量（整行，无限流量分段条全灰）
  if (vm.monthText) {
    children.push({ type: 'spacer', length: 14 });
    children.push({
      type: 'stack', direction: 'column', alignItems: 'start', gap: 7,
      children: [
        {
          type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
          children: [
            sfSymbol('cylinder', 13, C.textSecondary),
            txt('剩余流量' + (vm.monthFrac === null ? ' ∞' : ''), { font: { size: 11, weight: 'medium' }, textColor: C.textSecondary }),
            { type: 'spacer' },
            txt(vm.monthText, { font: { size: 13, weight: 'semibold' }, textColor: C.textPrimary }),
          ],
        },
        metricTrack(vm.monthFrac ?? 0, { kind: 'solid', color: C.network }),
      ],
    });
  }

  // 延迟 / 丢包率（分隔线 + 双列健康网格）
  children.push({ type: 'spacer', length: 18 });
  children.push(divider());
  children.push({ type: 'spacer', length: 12 });
  children.push(grid2(
    healthBlock({
      icon: 'clock', label: '延迟',
      value: vm.pingNow === null ? '—' : String(Math.round(vm.pingNow)), unit: vm.pingNow === null ? '' : 'ms',
      color: latencyColor,
      strip: miniStrip(vm.pingSeries, latencyHeat, vm.pingNow),
    }),
    healthBlock({
      icon: 'link', label: '丢包率',
      value: vm.lossNow === null ? '—' : vm.lossNow.toFixed(1), unit: vm.lossNow === null ? '' : '%',
      color: lossColor,
      strip: miniStrip(vm.lossSeries, lossHeat, vm.lossNow),
    })
  ));

  // 底部：到期 / 在线
  children.push({ type: 'spacer' });
  children.push(divider());
  children.push({ type: 'spacer', length: 12 });
  children.push({
    type: 'stack', direction: 'row', alignItems: 'center', gap: 18,
    children: [
      footerStat({
        icon: 'calendar', label: '到期',
        value: vm.expire ? vm.expire.value : '—', unit: vm.expire ? vm.expire.unit : '',
        color: vm.expire ? vm.expire.color : C.textTertiary,
      }),
      footerStat({
        icon: 'arrow.clockwise', label: '在线',
        value: vm.uptime ? vm.uptime.value : '—', unit: vm.uptime ? vm.uptime.unit : '',
        color: vm.uptime ? C.cpu : C.textTertiary,
      }),
    ],
  });

  return {
    type: 'widget',
    padding: [22, 20, 16, 20],
    backgroundColor: C.bg,
    url: cfg.apiBase,
    refreshAfter: cfg.refreshAfter,
    children,
  };
}

// ============ 错误 / 状态页 ============
const STATUS_DEFS = {
  NO_CONFIG:    { icon: 'gearshape',                color: 'warn', title: '缺少配置',          desc: '请在小组件 env 中设置 API_BASE（站点地址）' },
  TURNSTILE:    { icon: 'hand.raised.fill',         color: 'warn', title: '访问被人机验证拦截', desc: '站点开启了全局 Turnstile 验证，匿名 API 返回 403' },
  UNAUTHORIZED: { icon: 'lock.fill',                color: 'bad',  title: '站点未公开',        desc: '该站点 is_public 关闭或需登录，本小组件仅支持公开站点' },
  NOT_FOUND:    { icon: 'questionmark.circle',      color: 'warn', title: '服务器不存在',      desc: 'SERVER_ID 无效或该服务器已设为隐藏' },
  EMPTY:        { icon: 'server.rack',              color: 'warn', title: '没有可用服务器',    desc: '站点服务器列表为空' },
  NETWORK:      { icon: 'wifi.slash',               color: 'bad',  title: '请求失败',          desc: '' },
  PARSE:        { icon: 'exclamationmark.triangle', color: 'bad',  title: '数据格式异常',      desc: '' },
};
const STATUS_COLORS = { warn: adapt('#E9A23B', '#D4A54A'), bad: adapt('#DC2626', '#D84E45') };
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
          sfSymbol(def.icon, 26, STATUS_COLORS[def.color]),
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
