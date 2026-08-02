/**
 * CF-Server-Monitor × Egern 小组件
 * 单机详情，分段式进度条风格，适配 systemMedium / systemLarge，自适应深浅色。
 *
 * 环境变量（在 Egern 小组件 env 中配置）：
 *   API_BASE              必填，站点地址，如 https://status.example.com
 *   SERVER_ID             可选，服务器 UUID；为空时自动选取列表中第一台可见服务器
 *   REFRESH_MINUTES       可选，刷新间隔分钟数，默认 1（1-60）
 *   ONLINE_THRESHOLD_MIN  可选，离线判定阈值分钟数，默认 5
 */

// ============ 配色（自适应深浅色） ============
const C = {
  bg:            { light: '#FFFFFF', dark: '#1C1C1E' },
  textPrimary:   { light: '#1C1C1E', dark: '#FFFFFF' },
  textSecondary: { light: '#6E6E73', dark: '#8E8E93' },
  textTertiary:  { light: '#AEAEB2', dark: '#636366' },
  track:         { light: '#E8E8ED', dark: '#38383A' },
  ok:            { light: '#34C759', dark: '#30D158' },
  warn:          { light: '#FF9500', dark: '#FF9F0A' },
  bad:           { light: '#FF3B30', dark: '#FF453A' },
  cpu:           { light: '#007AFF', dark: '#0A84FF' },
  mem:           { light: '#AF52DE', dark: '#BF5AF2' },
  disk:          { light: '#F2780C', dark: '#FF9F0A' },
  load:          { light: '#E84393', dark: '#F368A8' },
};
const BADGE_BG = {
  ok:  { light: '#34C75926', dark: '#30D15833' },
  bad: { light: '#FF3B3026', dark: '#FF453A33' },
};

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
/** 运行时长（紧凑）：25天 / 3时 / 25分 */
function fmtUptimeShort(ms) {
  if (!isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + '分';
  const h = Math.floor(min / 60);
  if (h < 24) return h + '小时';
  return Math.floor(h / 24) + '天';
}
/** 解析 "1TB" / "500GB" 为字节数 */
function parseTrafficLimit(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)$/i);
  if (!m) return null;
  const pow = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4, PB: 5 }[m[2].toUpperCase()];
  return Number(m[1]) * Math.pow(1024, pow);
}
/** /api/server 返回可能是 {data:{...}} 也可能直接是对象 */
function unwrap(d) {
  if (d && typeof d === 'object' && d.data && typeof d.data === 'object' && !Array.isArray(d.data)) return d.data;
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
/** 两位字母区域码 → 旗帜 emoji */
function flagEmoji(region) {
  const code = String(region || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}
function pct1(v) {
  return v === null ? '--' : (Math.round(v * 10) / 10) + '%';
}
function pingColor(p) {
  if (p === null) return C.textTertiary;
  if (p >= 200) return C.bad;
  if (p >= 100) return C.warn;
  return C.ok;
}
function lossColor(l) {
  if (l === null || l <= 0) return C.ok;
  if (l >= 10) return C.bad;
  return C.warn;
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
  const apiBase = String(env.API_BASE || '').trim().replace(/\/+$/, '');
  return {
    apiBase,
    serverId: String(env.SERVER_ID || '').trim(),
    refreshMin: clamp(num(env.REFRESH_MINUTES) ?? 1, 1, 60),
    onlineThresholdMs: clamp(num(env.ONLINE_THRESHOLD_MIN) ?? 5, 1, 120) * 60000,
    refreshAfter: new Date(Date.now() + clamp(num(env.REFRESH_MINUTES) ?? 1, 1, 60) * 60000).toISOString(),
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

// ============ 视图模型 ============
function buildViewModel(server, cfg) {
  const now = Date.now();
  const lastUpdatedMs = normalizeTs(server.last_updated) ?? normalizeTs(server.timestamp);
  const online = lastUpdatedMs !== null && (now - lastUpdatedMs) <= cfg.onlineThresholdMs;
  const bootMs = normalizeTs(server.boot_time);

  const cpuPct = num(server.cpu) !== null ? clamp(num(server.cpu), 0, 100) : null;
  const ramPct = pctOf(server.ram_used, server.ram_total);
  const diskPct = pctOf(server.disk_used, server.disk_total);
  const cores = num(server.cpu_cores);

  const loadParts = typeof server.load_avg === 'string' ? server.load_avg.trim().split(/\s+/) : [];
  const load1 = loadParts[0] || null;
  const loadPct = load1 !== null ? clamp((num(load1) / (cores || 4)) * 100, 0, 100) : null;

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

  const pings = [server.ping_ct, server.ping_cu, server.ping_cm, server.ping_bd].map(num).filter(v => v !== null);
  const losses = [server.loss_ct, server.loss_cu, server.loss_cm, server.loss_bd].map(num).filter(v => v !== null);
  const pingAvg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;
  const lossMax = losses.length ? Math.max(...losses) : null;

  return {
    name: String(server.name || '未命名'),
    flag: flagEmoji(server.region),
    online,
    lastUpdatedISO: lastUpdatedMs ? new Date(lastUpdatedMs).toISOString() : null,
    cpuPct, ramPct, diskPct, cores,
    cpuDetail: cores ? cores + ' 核' : ' ',
    ramDetail: fmtMB(server.ram_used) + ' / ' + fmtMB(server.ram_total),
    diskDetail: fmtMB(server.disk_used) + ' / ' + fmtMB(server.disk_total),
    load1,
    loadPct,
    monthUsedText: monthUsed !== null ? fmtBytes(monthUsed) : '--',
    monthPct,
    monthLimitText: limitBytes ? String(server.traffic_limit).trim() : '∞',
    pingAvg,
    lossMax,
    uptimeText: (bootMs && lastUpdatedMs && lastUpdatedMs > bootMs) ? fmtUptimeShort(lastUpdatedMs - bootMs) : null,
    expireText: server.expire_date ? String(server.expire_date).trim() : null,
  };
}

// ============ DSL 原子组件 ============
function txt(text, opts) {
  return Object.assign({ type: 'text', text: String(text), maxLines: 1, minScale: 0.7 }, opts || {});
}
function sfSymbol(name, size, color) {
  return { type: 'image', src: 'sf-symbol:' + name, width: size, height: size, color };
}
/** 分段式进度条：20 个小方块 */
function segBar(pct, fillColor, segments, h) {
  segments = segments || 20;
  h = h || 8;
  const filled = clamp(Math.round(((pct ?? 0) / 100) * segments), 0, segments);
  const children = [];
  for (let i = 0; i < segments; i++) {
    children.push({
      type: 'stack', flex: 1, height: h, borderRadius: 2,
      backgroundColor: i < filled ? fillColor : C.track,
    });
  }
  return { type: 'stack', direction: 'row', gap: 2, children };
}
/** 细分隔线 */
function divider() {
  return {
    type: 'stack', direction: 'row',
    children: [{ type: 'stack', flex: 1, height: 1, backgroundColor: C.track }],
  };
}
/** 状态胶囊 */
function badge(text, colorKey) {
  return {
    type: 'stack', padding: [2, 8, 2, 8], borderRadius: 9, backgroundColor: BADGE_BG[colorKey] || BADGE_BG.ok,
    children: [txt(text, { font: { size: 'caption2', weight: 'semibold' }, textColor: C[colorKey] })],
  };
}

// ============ 布局组件 ============
/**
 * 半宽指标列：图标+标签+右对齐数值 / 明细行 / 分段进度条
 * opts: icon, label, value, valueColor, valueWeight, detail, barPct, barColor
 */
function metricCol(opts) {
  const children = [
    {
      type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
      children: [
        sfSymbol(opts.icon, 13, C.textSecondary),
        txt(opts.label, { font: { size: 'subheadline' }, textColor: C.textPrimary }),
        { type: 'spacer' },
        txt(opts.value, { font: { size: 17, weight: opts.valueWeight || 'regular' }, textColor: opts.valueColor || C.textPrimary }),
      ],
    },
    txt(opts.detail || ' ', { font: { size: 'footnote', weight: 'medium' }, textColor: C.textSecondary }),
  ];
  if (opts.barColor) children.push(segBar(opts.barPct, opts.barColor));
  return { type: 'stack', direction: 'column', alignItems: 'start', gap: 6, flex: 1, children };
}
/** 双列指标行 */
function twoCol(left, right) {
  return { type: 'stack', direction: 'row', gap: 24, alignItems: 'start', children: [left, right] };
}
/** 头部：旗帜 + 名称 + 状态 */
function headerRow(vm, isLarge) {
  const children = [];
  if (vm.flag) children.push(txt(vm.flag, { font: { size: isLarge ? 'title3' : 'headline' } }));
  children.push(txt(vm.name, {
    font: { size: isLarge ? 'title3' : 'headline', weight: 'bold' },
    textColor: C.textPrimary,
  }));
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
/** 延迟列 / 丢包率列 */
function latencyCol(vm, offline) {
  const c = offline ? C.textSecondary : pingColor(vm.pingAvg);
  return metricCol({
    icon: 'clock', label: '延迟',
    value: vm.pingAvg === null ? '--' : vm.pingAvg + 'ms',
    valueColor: c, valueWeight: 'medium',
    detail: ' ',
    barPct: vm.pingAvg === null ? 0 : clamp((vm.pingAvg / 300) * 100, 0, 100),
    barColor: c,
  });
}
function lossCol(vm, offline) {
  const c = offline ? C.textSecondary : lossColor(vm.lossMax);
  return metricCol({
    icon: 'link', label: '丢包率',
    value: vm.lossMax === null ? '--' : (Math.round(vm.lossMax * 10) / 10) + '%',
    valueColor: c, valueWeight: 'medium',
    detail: ' ',
    barPct: clamp((vm.lossMax ?? 0) * 4, 0, 100),
    barColor: vm.lossMax ? c : C.track,
  });
}

// ============ 尺寸布局 ============
function renderMedium(vm, cfg) {
  const off = !vm.online;
  const bar = (pct, color) => off ? C.textTertiary : color;
  return {
    type: 'widget',
    padding: 14,
    backgroundColor: C.bg,
    url: cfg.apiBase,
    refreshAfter: cfg.refreshAfter,
    children: [
      headerRow(vm, false),
      { type: 'spacer', length: 10 },
      twoCol(
        metricCol({ icon: 'cpu', label: 'CPU', value: pct1(vm.cpuPct), detail: vm.cpuDetail, barPct: vm.cpuPct ?? 0, barColor: bar(vm.cpuPct, C.cpu) }),
        metricCol({ icon: 'memorychip', label: '内存', value: pct1(vm.ramPct), detail: vm.ramDetail, barPct: vm.ramPct ?? 0, barColor: bar(vm.ramPct, C.mem) })
      ),
      { type: 'spacer', length: 10 },
      twoCol(
        metricCol({ icon: 'internaldrive', label: '磁盘', value: pct1(vm.diskPct), detail: vm.diskDetail, barPct: vm.diskPct ?? 0, barColor: bar(vm.diskPct, C.disk) }),
        metricCol({ icon: 'gauge.medium', label: '负载', value: vm.load1 ?? '--', detail: ' ', barPct: vm.loadPct ?? 0, barColor: bar(vm.loadPct, C.load) })
      ),
      { type: 'spacer' },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
        children: [
          sfSymbol('arrow.clockwise', 11, C.textSecondary),
          txt('在线', { font: { size: 'caption1' }, textColor: C.textSecondary }),
          txt(vm.uptimeText ?? '--', { font: { size: 'caption1', weight: 'semibold' }, textColor: C.cpu }),
          { type: 'spacer' },
          sfSymbol('clock', 11, C.textSecondary),
          txt('延迟', { font: { size: 'caption1' }, textColor: C.textSecondary }),
          txt(vm.pingAvg === null ? '--' : vm.pingAvg + 'ms', { font: { size: 'caption1', weight: 'semibold' }, textColor: off ? C.textSecondary : pingColor(vm.pingAvg) }),
        ],
      },
    ],
  };
}

function renderLarge(vm, cfg) {
  const off = !vm.online;
  const bar = (pct, color) => off ? C.textTertiary : color;
  const trafficColor = vm.monthPct === null ? C.track : (vm.monthPct >= 85 ? C.bad : vm.monthPct >= 60 ? C.warn : C.ok);

  const children = [
    headerRow(vm, true),
    { type: 'spacer', length: 12 },
    twoCol(
      metricCol({ icon: 'cpu', label: 'CPU', value: pct1(vm.cpuPct), detail: vm.cpuDetail, barPct: vm.cpuPct ?? 0, barColor: bar(vm.cpuPct, C.cpu) }),
      metricCol({ icon: 'memorychip', label: '内存', value: pct1(vm.ramPct), detail: vm.ramDetail, barPct: vm.ramPct ?? 0, barColor: bar(vm.ramPct, C.mem) })
    ),
    { type: 'spacer', length: 12 },
    twoCol(
      metricCol({ icon: 'internaldrive', label: '磁盘', value: pct1(vm.diskPct), detail: vm.diskDetail, barPct: vm.diskPct ?? 0, barColor: bar(vm.diskPct, C.disk) }),
      metricCol({ icon: 'gauge.medium', label: '负载', value: vm.load1 ?? '--', detail: ' ', barPct: vm.loadPct ?? 0, barColor: bar(vm.loadPct, C.load) })
    ),
    { type: 'spacer', length: 12 },
  ];

  // 剩余流量（整行）
  children.push({
    type: 'stack', direction: 'column', alignItems: 'start', gap: 6,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
        children: [
          sfSymbol('cylinder', 13, C.textSecondary),
          txt('剩余流量 ' + (vm.monthPct === null ? '∞' : ''), { font: { size: 'subheadline' }, textColor: C.textPrimary }),
          { type: 'spacer' },
          txt(vm.monthUsedText + ' / ' + vm.monthLimitText, { font: { size: 'footnote', weight: 'medium' }, textColor: C.textSecondary }),
        ],
      },
      segBar(vm.monthPct ?? 0, trafficColor),
    ],
  });

  children.push({ type: 'spacer', length: 12 });
  children.push(divider());
  children.push({ type: 'spacer', length: 12 });

  // 延迟 / 丢包率
  children.push(twoCol(latencyCol(vm, off), lossCol(vm, off)));

  children.push({ type: 'spacer' });
  children.push(divider());
  children.push({ type: 'spacer', length: 12 });

  // 底部：在线 / 到期
  children.push({
    type: 'stack', direction: 'row', alignItems: 'center', gap: 24,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 5, flex: 1,
        children: [
          sfSymbol('arrow.clockwise', 13, C.textSecondary),
          txt('在线', { font: { size: 'subheadline' }, textColor: C.textPrimary }),
          { type: 'spacer' },
          txt(vm.uptimeText ?? '--', { font: { size: 17, weight: 'medium' }, textColor: C.cpu }),
        ],
      },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 5, flex: 1,
        children: [
          sfSymbol('calendar', 13, C.textSecondary),
          txt('到期', { font: { size: 'subheadline' }, textColor: C.textPrimary }),
          { type: 'spacer' },
          vm.expireText
            ? txt(vm.expireText, { font: { size: 'footnote', weight: 'medium' }, textColor: C.textSecondary })
            : txt('—', { font: { size: 17 }, textColor: C.textTertiary }),
        ],
      },
    ],
  });

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
  NO_CONFIG:    { icon: 'gearshape',                color: 'warn', title: '缺少配置',          desc: '请在小组件 env 中设置 API_BASE（站点地址）' },
  TURNSTILE:    { icon: 'hand.raised.fill',         color: 'warn', title: '访问被人机验证拦截', desc: '站点开启了全局 Turnstile 验证，匿名 API 返回 403' },
  UNAUTHORIZED: { icon: 'lock.fill',                color: 'bad',  title: '站点未公开',        desc: '该站点 is_public 关闭或需登录，本小组件仅支持公开站点' },
  NOT_FOUND:    { icon: 'questionmark.circle',      color: 'warn', title: '服务器不存在',      desc: 'SERVER_ID 无效或该服务器已设为隐藏' },
  EMPTY:        { icon: 'server.rack',              color: 'warn', title: '没有可用服务器',    desc: '站点服务器列表为空' },
  NETWORK:      { icon: 'wifi.slash',               color: 'bad',  title: '请求失败',          desc: '' },
  PARSE:        { icon: 'exclamationmark.triangle', color: 'bad',  title: '数据格式异常',      desc: '' },
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
    const vm = buildViewModel(server, cfg);
    return (ctx && ctx.widgetFamily === 'systemLarge') ? renderLarge(vm, cfg) : renderMedium(vm, cfg);
  } catch (e) {
    return renderStatus(e && e.kind ? e.kind : 'NETWORK', e && e.message, cfg);
  }
}
