/**
 * Egern Widget DSL → SVG 预览渲染器（近似布局引擎）
 * 用法: node dev/render-preview.mjs
 * 输出 dev/preview/{medium,large}-{light,dark}.svg，可用 qlmanage 转 PNG 查看。
 * 目的：在没有真机时核对布局、对齐、配色，不是像素级还原 Egern。
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const { default: widgetFn } = await import(pathToFileURL(path.join(ROOT, 'cf-server-monitor.widget.js')).href);

// ---------- Fixture ----------
const now = Date.now();
const server = {
  id: 's1', name: '6.5刀年付cloudnium西雅图', server_group: 'Default', region: 'US',
  os: 'Debian 12', arch: 'x86_64',
  cpu: 4.05, load_avg: '0.20 0.30 0.40', cpu_cores: 2,
  ram_total: 1971, ram_used: 697, swap_total: 0, swap_used: 0,
  disk_total: 19968, disk_used: 7884,
  net_rx_monthly: 217 * 1024 ** 3, net_tx_monthly: 198 * 1024 ** 3,
  traffic_limit: '', traffic_calc_type: 'total',
  ping_ct: 173, ping_cu: 168, ping_cm: 180, ping_bd: 172,
  loss_ct: 6.7, loss_cu: 6.7, loss_cm: 6.7, loss_bd: 6.7,
  price: '6.5', currency: '$', expire_date: '', boot_time: String(now - 25 * 86400000),
  last_updated: now - 30000, timestamp: now - 30000, is_hidden: '0',
};
const history = Array.from({ length: 30 }, (_, i) => ({
  timestamp: now - (30 - i) * 120000,
  cpu: 20 + 30 * Math.abs(Math.sin(i / 5)),
  ping_ct: 170 + ((i % 4) - 2) * 8, ping_cu: 172, ping_cm: 168,
  loss_ct: i % 6 === 0 ? 8 : 0, loss_cu: 0, loss_cm: 0,
}));
const http = { async get(url) { return { status: 200, json: async () => url.includes('history') ? history : server }; } };

// ---------- 尺寸与字体 ----------
const FAMILY_SIZE = { systemMedium: [360, 170], systemLarge: [360, 380] };
const SEMANTIC = { largeTitle: 34, title: 28, title2: 22, title3: 20, headline: 17, body: 17, callout: 16, subheadline: 15, footnote: 13, caption1: 12, caption2: 11 };
function fontSizeOf(font) {
  if (!font) return 17;
  if (typeof font.size === 'number') return font.size;
  return SEMANTIC[font.size] || 17;
}
function fontWeightOf(font) {
  const w = font && font.weight;
  return { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900, light: 300 }[w] || 400;
}
function textWidth(text, size) {
  let w = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp > 0x1f000) w += size * 1.15;
    else if (cp >= 0x2e80) w += size;
    else if (ch >= '0' && ch <= '9') w += size * 0.58;
    else if (ch === ' ') w += size * 0.3;
    else if ('%.,:;/\\·-—'.includes(ch)) w += size * 0.35;
    else w += size * 0.54;
  }
  return w;
}

// ---------- 颜色 ----------
function resolveColor(c, mode) {
  if (c == null) return null;
  if (typeof c === 'object') c = c[mode] || c.light;
  const m = String(c).match(/^#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/);
  if (!m) return { hex: '#888888', opacity: 1 };
  return { hex: '#' + m[1].toUpperCase(), opacity: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}
function fill(c, mode) {
  const r = resolveColor(c, mode);
  if (!r) return '';
  return `fill='${r.hex}'${r.opacity < 1 ? ` fill-opacity='${r.opacity.toFixed(2)}'` : ''}`;
}

// ---------- 布局引擎 ----------
function pad(p) {
  if (p == null) return [0, 0, 0, 0];
  if (typeof p === 'number') return [p, p, p, p];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  return p;
}

/** 测量子节点自然尺寸（不分配 flex） */
function measure(node, mode) {
  if (!node || typeof node !== 'object') return { w: 0, h: 0 };
  switch (node.type) {
    case 'text': {
      const s = fontSizeOf(node.font);
      return { w: textWidth(node.text, s), h: s * 1.25 };
    }
    case 'date': {
      const s = fontSizeOf(node.font);
      const approx = node.format === 'date' ? '2026年12月31日' : '5分钟前';
      return { w: textWidth(approx, s), h: s * 1.25 };
    }
    case 'image': return { w: node.width || 20, h: node.height || 20 };
    case 'spacer': return { w: node.length || 0, h: node.length || 0, flexSpacer: !node.length };
    case 'stack': case 'widget': {
      const isRow = node.type === 'stack' && node.direction !== 'column'; // widget 根为垂直布局
      const [pt, pr, pb, pl] = pad(node.padding);
      const kids = node.children || [];
      const gap = node.gap || 0;
      let w = 0, h = 0;
      if (isRow) {
        kids.forEach((k, i) => { const m = measure(k, mode); w += m.w + (i ? gap : 0); h = Math.max(h, m.h); });
        return { w: (node.width || w) + pl + pr, h: (node.height || h) + pt + pb };
      }
      kids.forEach((k, i) => { const m = measure(k, mode); h += m.h + (i ? gap : 0); w = Math.max(w, m.w); });
      return { w: (node.width || w) + pl + pr, h: (node.height || h) + pt + pb };
    }
  }
  return { w: 0, h: 0 };
}

/** 布局并渲染 */
function layout(node, x, y, width, height, mode, out) {
  if (!node || typeof node !== 'object') return;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  switch (node.type) {
    case 'text': {
      const s = fontSizeOf(node.font);
      out.push(`<text x='${x.toFixed(1)}' y='${(y + s * 0.92).toFixed(1)}' font-family='-apple-system,Helvetica,Arial,sans-serif' font-size='${s}' font-weight='${fontWeightOf(node.font)}' ${fill(node.textColor || { light: '#000', dark: '#fff' }, mode)}>${esc(node.text)}</text>`);
      return;
    }
    case 'date': {
      const s = fontSizeOf(node.font);
      const approx = node.format === 'date' ? '2026年12月31日' : '5分钟前';
      out.push(`<text x='${x.toFixed(1)}' y='${(y + s * 0.92).toFixed(1)}' font-family='-apple-system,Helvetica,Arial,sans-serif' font-size='${s}' font-weight='${fontWeightOf(node.font)}' ${fill(node.textColor, mode)}>${esc(approx)}</text>`);
      return;
    }
    case 'image': {
      const w = node.width || 20, h = node.height || 20;
      const c = resolveColor(node.color, mode);
      if (String(node.src).includes('circle.fill')) {
        out.push(`<circle cx='${(x + w / 2).toFixed(1)}' cy='${(y + h / 2).toFixed(1)}' r='${(w / 2).toFixed(1)}' fill='${c ? c.hex : '#888'}'${c && c.opacity < 1 ? ` fill-opacity='${c.opacity.toFixed(2)}'` : ''}/>`);
      } else {
        out.push(`<rect x='${x.toFixed(1)}' y='${y.toFixed(1)}' width='${w}' height='${h}' rx='3' fill='none' stroke='${c ? c.hex : '#888'}' stroke-width='1.4'/>`);
        out.push(`<circle cx='${(x + w / 2).toFixed(1)}' cy='${(y + h / 2).toFixed(1)}' r='${(Math.min(w, h) / 4).toFixed(1)}' fill='${c ? c.hex : '#888'}'/>`);
      }
      return;
    }
    case 'spacer': return;
    case 'stack': case 'widget': {
      const isRow = node.type === 'stack' && node.direction !== 'column'; // widget 根为垂直布局
      const [pt, pr, pb, pl] = pad(node.padding);
      // 背景与边框
      if (node.backgroundColor || node.borderWidth) {
        const bg = resolveColor(node.backgroundColor, mode);
        const bd = resolveColor(node.borderColor, mode);
        out.push(`<rect x='${x.toFixed(1)}' y='${y.toFixed(1)}' width='${width.toFixed(1)}' height='${height.toFixed(1)}' rx='${node.borderRadius === 'auto' ? 18 : node.borderRadius || 0}' ${bg ? `fill='${bg.hex}'${bg.opacity < 1 ? ` fill-opacity='${bg.opacity.toFixed(2)}'` : ''}` : "fill='none'"} ${node.borderWidth && bd ? `stroke='${bd.hex}' stroke-width='${node.borderWidth}'` : ''}/>`);
      }
      const kids = node.children || [];
      const gap = node.gap || 0;
      const ix = x + pl, iy = y + pt;
      const iw = width - pl - pr, ih = height - pt - pb;
      const measured = kids.map(k => measure(k, mode));
      if (isRow) {
        // 先扣固定宽度，再把剩余按 flex 分配；spacer 视为 flex 1
        let fixed = 0, flexSum = 0;
        kids.forEach((k, i) => {
          const f = k.type === 'spacer' && !k.length ? 1 : (k.flex || 0);
          if (f > 0) flexSum += f; else fixed += measured[i].w;
        });
        fixed += gap * Math.max(0, kids.length - 1);
        const remaining = Math.max(0, iw - fixed);
        let cx = ix;
        kids.forEach((k, i) => {
          const f = k.type === 'spacer' && !k.length ? 1 : (k.flex || 0);
          const kw = f > 0 ? remaining * (f / flexSum) : measured[i].w;
          const kh = k.height || measured[i].h;
          // 垂直对齐
          let ky = iy;
          if (node.alignItems === 'end') ky = iy + ih - kh;
          else if (!node.alignItems || node.alignItems === 'center') ky = iy + (ih - kh) / 2;
          layout(k, cx, ky, kw, k.height || kh, mode, out);
          cx += kw + gap;
        });
      } else {
        // 列：固定高度先扣，flex/spacer 分剩余高度；宽度全部撑满
        let fixed = 0, flexSum = 0;
        kids.forEach((k, i) => {
          const f = k.type === 'spacer' && !k.length ? 1 : (k.flex || 0);
          if (f > 0 && k.type === 'spacer') flexSum += f;
          else fixed += measured[i].h;
        });
        fixed += gap * Math.max(0, kids.length - 1);
        const remaining = Math.max(0, ih - fixed);
        let cy = iy;
        kids.forEach((k, i) => {
          if (k.type === 'spacer' && !k.length) { cy += remaining / Math.max(1, flexSum); return; }
          const kh = measured[i].h;
          // 列内子元素：start=左对齐自然宽，其余按撑满处理（rows 拉伸已被真机证实）
          const nat = measured[i].w;
          const isRowStack = k.type === 'stack' && k.direction !== 'column';
          const cw = isRowStack ? iw : (node.alignItems === 'start' ? Math.min(nat, iw) : iw);
          let cx = ix;
          if (node.alignItems === 'center') cx = ix + (iw - cw) / 2;
          else if (node.alignItems === 'end') cx = ix + iw - cw;
          layout(k, cx, cy, cw, kh, mode, out);
          cy += kh + gap;
        });
      }
      return;
    }
  }
}

// ---------- 生成四张预览 ----------
const outDir = path.join(ROOT, 'dev', 'preview');
fs.mkdirSync(outDir, { recursive: true });
const BG = { light: '#FFFFFF', dark: '#0F0F10' };

for (const family of ['systemMedium', 'systemLarge']) {
  const dsl = await widgetFn({ env: { API_BASE: 'https://status.example.com', SERVER_ID: 's1' }, widgetFamily: family, http });
  const [W, H] = FAMILY_SIZE[family];
  for (const mode of ['light', 'dark']) {
    const out = [];
    out.push(`<rect x='0' y='0' width='${W}' height='${H}' rx='22' fill='${BG[mode]}'/>`);
    const rootBg = resolveColor(dsl.backgroundColor, mode);
    if (rootBg) out.push(`<rect x='0' y='0' width='${W}' height='${H}' rx='22' fill='${rootBg.hex}'${rootBg.opacity < 1 ? ` fill-opacity='${rootBg.opacity}'` : ''}/>`);
    layout(dsl, 0, 0, W, H, mode, out);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>\n${out.join('\n')}\n</svg>`;
    const file = path.join(outDir, `${family === 'systemLarge' ? 'large' : 'medium'}-${mode}.svg`);
    fs.writeFileSync(file, svg);
    console.log('written', file);
  }
}
