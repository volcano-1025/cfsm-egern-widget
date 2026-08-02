/**
 * CF-Server-Monitor Egern 小组件自检工具
 * 用法: node dev/mock-run.mjs
 * 用 Node 模拟 Egern 的 ctx（env/widgetFamily/http），运行脚本并递归校验 DSL 合法性。
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const SCRIPT = pathToFileURL(path.resolve(import.meta.dirname, '../cf-server-monitor.widget.js')).href;
const { default: widgetFn } = await import(SCRIPT);

// ---------- Fixture 数据 ----------
const now = Date.now();
const serverOnline = {
  id: 'srv-001', name: 'HK-01', server_group: 'HK', region: 'HK',
  cpu: 42.5, load_avg: '0.10 0.20 0.30', cpu_cores: 4, cpu_info: 'Intel Xeon',
  ram_total: 8192, ram_used: 2150, swap_total: 2048, swap_used: 100,
  disk_total: 51200, disk_used: 18739,
  net_in_speed: 1234567, net_out_speed: 234567,
  net_rx: 123456789000, net_tx: 87654321000,
  net_rx_monthly: 230000000000, net_tx_monthly: 150000000000,
  traffic_limit: '1TB', traffic_calc_type: 'total',
  processes: 128, tcp_conn: 256, udp_conn: 12,
  ping_ct: 32, ping_cu: 45, ping_cm: 58, ping_bd: 120,
  loss_ct: 0, loss_cu: 6, loss_cm: 0, loss_bd: 0,
  price: '30.00', currency: '¥', expire_date: '2026-12-31', auto_renewal: '1',
  boot_time: String(now - 12 * 86400000 - 3 * 3600000),
  last_updated: now - 30000, timestamp: now - 30000, is_hidden: '0',
};
const serverOffline = { ...serverOnline, name: 'JP-02', last_updated: now - 30 * 60000, timestamp: now - 30 * 60000 };
const serverNoLimit = { ...serverOnline, traffic_limit: '', expire_date: '' };
const historyRows = Array.from({ length: 30 }, (_, i) => ({
  timestamp: now - (30 - i) * 120000,
  cpu: 20 + 40 * Math.abs(Math.sin(i / 6)),
  ping_ct: 30 + i, ping_cu: 45, ping_cm: null, ping_bd: 120 + (i % 5) * 40,
  loss_ct: 0, loss_cu: i % 7 === 0 ? 12 : 0, loss_cm: 0, loss_bd: i % 3,
}));

// ---------- Mock HTTP ----------
function mockHttp(routes) {
  return {
    async get(url) {
      for (const [pattern, responder] of routes) {
        if (url.includes(pattern)) {
          const out = await responder(url);
          if (out instanceof Error) throw out;
          return { status: out.status ?? 200, json: async () => out.body, text: async () => JSON.stringify(out.body) };
        }
      }
      throw new Error('no route for ' + url);
    },
  };
}

// ---------- DSL 递归校验器 ----------
const TYPES = new Set(['widget', 'stack', 'text', 'image', 'spacer', 'date']);
const COLOR_RE = /^(#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0|1|0?\.\d+)\s*\))$/;
const problems = [];

function checkColor(v, path) {
  if (typeof v === 'string') {
    if (!COLOR_RE.test(v)) problems.push(`${path}: 非法颜色 ${v}`);
  } else if (v && typeof v === 'object') {
    if (typeof v.light !== 'string' || typeof v.dark !== 'string' || !COLOR_RE.test(v.light) || !COLOR_RE.test(v.dark)) {
      problems.push(`${path}: 非法自适应颜色 ${JSON.stringify(v)}`);
    }
  } else {
    problems.push(`${path}: 颜色类型错误 ${typeof v}`);
  }
}

function validate(node, path = 'root') {
  if (!node || typeof node !== 'object') { problems.push(`${path}: 非对象节点`); return; }
  if (Array.isArray(node)) { node.forEach((n, i) => validate(n, `${path}[${i}]`)); return; }
  if (!TYPES.has(node.type)) { problems.push(`${path}: 未知 type ${node.type}`); return; }

  for (const [k, v] of Object.entries(node)) {
    if (v === undefined) problems.push(`${path}.${k}: undefined 泄漏`);
    if (typeof v === 'number' && !isFinite(v)) problems.push(`${path}.${k}: NaN/Infinity`);
    if (typeof v === 'string' && /NaN|undefined|null/.test(v) && !['text'].includes(k)) { /* 宽松 */ }
  }
  for (const key of ['textColor', 'backgroundColor', 'color', 'borderColor', 'shadowColor']) {
    if (node[key] !== undefined) checkColor(node[key], `${path}.${key}`);
  }
  if (node.type === 'text' && typeof node.text !== 'string') problems.push(`${path}: text 缺 text`);
  if (node.type === 'date') {
    if (!node.date || !isFinite(Date.parse(node.date))) problems.push(`${path}: date 不可解析 ${node.date}`);
    if (!['date', 'time', 'relative', 'offset', 'timer'].includes(node.format)) problems.push(`${path}: 非法 date format ${node.format}`);
  }
  if (node.type === 'image' && node.src !== undefined) {
    const src = String(node.src);
    if (src.startsWith('data:image/svg+xml,')) {
      const raw = src.slice('data:image/svg+xml,'.length);
      const decoded = decodeURIComponent(raw);
      if (!decoded.includes('xmlns')) problems.push(`${path}: SVG 缺 xmlns`);
      if (!decoded.includes('viewBox')) problems.push(`${path}: SVG 缺 viewBox`);
      if (raw.includes('#') || raw.includes('<') || raw.includes('>')) problems.push(`${path}: SVG 含未编码字符`);
      if (src.length > 512 * 1024) problems.push(`${path}: SVG 超 512KB`);
    } else if (!src.startsWith('sf-symbol:') && !src.startsWith('data:image/')) {
      problems.push(`${path}: 非法 image src 前缀 ${src.slice(0, 40)}`);
    }
  }
  if (node.type === 'widget') {
    if (node.refreshAfter !== undefined && !isFinite(Date.parse(node.refreshAfter))) {
      problems.push(`${path}: refreshAfter 不可解析`);
    }
  }
  if (node.children !== undefined) validate(node.children, `${path}.children`);
  if (node.backgroundGradient !== undefined) {
    const g = node.backgroundGradient;
    if (!Array.isArray(g.colors) || !g.colors.length) problems.push(`${path}: gradient 缺 colors`);
    else g.colors.forEach((c, i) => checkColor(c, `${path}.gradient.colors[${i}]`));
  }
}

// ---------- 场景矩阵 ----------
const BASE_ENV = { API_BASE: 'https://status.example.com', SERVER_ID: 'srv-001' };
const scenarios = [
  ['medium 在线', 'systemMedium', BASE_ENV, mockHttp([
    ['/api/server', () => ({ body: serverOnline })],
  ])],
  ['large 在线', 'systemLarge', BASE_ENV, mockHttp([
    ['/api/history', () => ({ body: historyRows })],
    ['/api/server', () => ({ body: serverOnline })],
  ])],
  ['large 无限流量无到期（history 缺失走兜底）', 'systemLarge', BASE_ENV, mockHttp([
    ['/api/server', () => ({ body: serverNoLimit })],
  ])],
  ['medium 离线', 'systemMedium', BASE_ENV, mockHttp([
    ['/api/server', () => ({ body: serverOffline })],
  ])],
  ['403 Turnstile 防御', 'systemMedium', BASE_ENV, mockHttp([
    ['/api/server', () => ({ status: 403, body: { error: 'forbidden', code: 403 } })],
  ])],
  ['401 未公开防御', 'systemMedium', BASE_ENV, mockHttp([
    ['/api/server', () => ({ status: 401, body: { error: 'unauthorized', code: 401 } })],
  ])],
  ['网络异常', 'systemMedium', BASE_ENV, mockHttp([
    ['/api/server', () => new Error('connect timeout')],
  ])],
  ['无 SERVER_ID 列表降级', 'systemMedium', { API_BASE: BASE_ENV.API_BASE }, mockHttp([
    ['/api/servers', () => ({ body: { servers: [{ id: 'srv-001', is_hidden: '0' }, { id: 'srv-x', is_hidden: '1' }] } })],
    ['/api/server', () => ({ body: serverOnline })],
  ])],
  ['缺少 API_BASE', 'systemMedium', {}, mockHttp([])],
  ['data 包装层兼容', 'systemMedium', BASE_ENV, mockHttp([
    ['/api/server', () => ({ body: { data: serverOnline } })],
  ])],
];

let pass = 0, fail = 0;
for (const [name, family, env, http] of scenarios) {
  problems.length = 0;
  const ctx = { env, widgetFamily: family, http };
  let dsl, err = null;
  try {
    dsl = await widgetFn(ctx);
  } catch (e) {
    err = e;
  }
  if (err) {
    console.log(`✗ ${name} — 脚本抛异常: ${err.message}`);
    fail++; continue;
  }
  validate(dsl);
  const rootOk = dsl && dsl.type === 'widget';
  if (!rootOk) problems.push('根元素不是 widget');
  if (problems.length) {
    console.log(`✗ ${name}`);
    for (const p of problems) console.log(`    ${p}`);
    fail++;
  } else {
    const size = JSON.stringify(dsl).length;
    console.log(`✓ ${name}（DSL ${(size / 1024).toFixed(1)} KB）`);
    pass++;
  }
}
console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
