/**
 * 本地版式预览：把 cfsm-status.js 产出的 Widget DSL 翻成 flexbox HTML，
 * 三个尺寸 × 浅深色各渲染一遍，另加离线态与几种错误态。
 *
 * 这是**近似预览**，不是模拟器：
 * - 字体是系统 UI 字体，不是 WidgetKit 实际用的度量，行高与字宽会有出入
 * - `minScale` 的自动缩字用 CSS 近似不了，这里只做单行截断
 * - `date` 元素的相对时间在真机上由系统自己走秒，这里画成静态文案
 * 用途是抓「名字被挤断、列没对齐、某块被压成 0 宽、深色下对比度不够」这类结构问题。
 *
 * 用法：npm run preview → 生成 preview.html
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../cfsm-status.js";
import { NOW, SERVERS, buildSnapshot } from "../test/fixture.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** 预览的视觉放大倍数（只做 transform，不影响布局尺寸）。 */
const SCALE = Number(process.env.SCALE ?? 2);

/** iPhone 14 Pro 一档的小组件点尺寸，机型之间会差几个点。 */
const SIZES = {
  systemSmall: [158, 158],
  systemMedium: [338, 158],
  systemLarge: [338, 354],
};

/**
 * Mac 通知中心的小组件比 iPhone 高一截，节点又常常没那么多，剩余空间最多，
 * 最容易暴露「行被拉开」的问题 —— 专门留一档尺寸来复现。
 */
const MAC_LARGE = [360, 376];

function makeCtx({ family, env = {}, response }) {
  return {
    widgetFamily: family,
    env: { API_BASE: "https://status.example.com", ...env },
    http: {
      get: async () =>
        response ?? {
          status: 200,
          json: async () => buildSnapshot(),
        },
    },
  };
}

// ---------------------------------------------------------------- DSL → HTML

function esc(value) {
  return String(value).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function color(value, scheme) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return value[scheme] ?? value.light ?? null;
}

const ALIGN = { start: "flex-start", center: "center", end: "flex-end" };

/**
 * 一个 stack 是否应该撑满交叉轴。
 *
 * DSL 文档说容器默认 alignItems: "center"，SwiftUI 里 HStack 只要含 Spacer 或
 * 有占比的子元素就会撑满父容器宽度；CSS 的 align-items:center 不会。这里用同样的
 * 启发式补上，好让预览与真机的收缩行为对得上 —— 也正因为如此，脚本里凡是要撑满的行
 * 都必须含 spacer 或 flex 子元素。
 */
function stretches(node) {
  const children = node.children ?? [];
  return children.some((child) => child.type === "spacer" || child.flex != null);
}

function styleOf(node, scheme, parentDirection) {
  const s = [];
  const bg = color(node.backgroundColor, scheme);
  if (bg) s.push(`background:${bg}`);
  if (node.borderRadius != null) {
    s.push(`border-radius:${node.borderRadius === "auto" ? 999 : node.borderRadius}px`);
  }
  if (node.width != null) s.push(`width:${node.width}px`, "flex:none");
  if (node.height != null) s.push(`height:${node.height}px`, "flex-shrink:0");
  if (node.flex != null) s.push(`flex:${node.flex} 1 0`);
  if (node.padding != null) s.push(`padding:${node.padding}px`);
  if (node.gap != null) s.push(`gap:${node.gap}px`);
  if (node.opacity != null) s.push(`opacity:${node.opacity}`);
  if (node.font?.size != null) {
    const size = typeof node.font.size === "number" ? `${node.font.size}px` : node.font.size;
    s.push(`font-size:${size}`);
  }
  if (node.font?.weight) s.push(`font-weight:${weightOf(node.font.weight)}`);
  const fg = color(node.textColor, scheme);
  if (fg) s.push(`color:${fg}`);
  if (node.textAlign) s.push(`text-align:${node.textAlign}`);
  if (node.maxLines) {
    s.push(
      "overflow:hidden",
      "display:-webkit-box",
      "-webkit-box-orient:vertical",
      `-webkit-line-clamp:${node.maxLines}`,
    );
  }
  // 父容器是行时，定宽列不该被压缩；是列时，撑满宽度由 stretches() 决定。
  if (parentDirection === "row" && node.width == null && node.flex == null) {
    s.push("flex:none");
  }
  return s.join(";");
}

function weightOf(weight) {
  return (
    {
      ultraLight: 100,
      thin: 200,
      light: 300,
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      heavy: 800,
      black: 900,
    }[weight] ?? 400
  );
}

function toHtml(node, scheme, parentDirection = "column") {
  if (!node) return "";
  switch (node.type) {
    case "widget":
    case "stack": {
      const direction = node.type === "widget" ? "column" : (node.direction ?? "row");
      const align = ALIGN[node.alignItems ?? "center"] ?? "center";
      const extra = [
        "display:flex",
        `flex-direction:${direction}`,
        `align-items:${align}`,
        "min-width:0",
      ];
      if (direction === "row" && parentDirection === "column" && stretches(node)) {
        extra.push("align-self:stretch");
      }
      const style = [extra.join(";"), styleOf(node, scheme, parentDirection)]
        .filter(Boolean)
        .join(";");
      const inner = (node.children ?? []).map((c) => toHtml(c, scheme, direction)).join("");
      return `<div style="${style}">${inner}</div>`;
    }
    case "text":
      // DSL 里 text 支持 \n 换行，HTML 会把它折成空格，这里翻成 <br>。
      return `<span style="${styleOf(node, scheme, parentDirection)};min-width:0">${esc(
        node.text,
      ).replace(/\n/g, "<br>")}</span>`;
    case "date":
      return `<span style="${styleOf(node, scheme, parentDirection)}">3 分钟前</span>`;
    case "spacer":
      return node.length != null
        ? `<div style="flex:none;${parentDirection === "row" ? "width" : "height"}:${node.length}px"></div>`
        : `<div style="flex:1 1 0"></div>`;
    default:
      return `<div style="color:red">未知元素 ${esc(node.type)}</div>`;
  }
}

// ---------------------------------------------------------------- 页面组装

async function card(label, family, ctx, size) {
  const dsl = await render(ctx, NOW);
  const [w, h] = size ?? SIZES[family] ?? SIZES.systemSmall;
  // 放大只是 transform，不参与布局，尺寸仍按真实点数排版。
  return ["light", "dark"]
    .map(
      (scheme) => `
      <figure class="card ${scheme}">
        <figcaption>${esc(label)} · ${scheme}</figcaption>
        <div class="scaler" style="width:${w * SCALE}px;height:${h * SCALE}px">
          <div class="widget ${scheme}" style="width:${w}px;height:${h}px">${toHtml(dsl, scheme)}</div>
        </div>
      </figure>`,
    )
    .join("");
}

const OFFLINE_ONLY = SERVERS.filter((s) => s.id === "de-fra");
/** 只有 4 台机器，模拟节点少、剩余空间多的真实面板。 */
const FEW = SERVERS.filter((s) => ["hk-01", "jp-tokyo", "us-la", "sg-01"].includes(s.id));

/** 按尺寸分文件输出：每个文件都在首屏，省得截图时靠滚动定位。 */
const PAGES = {
  small: [
    ["小 · 指定节点", "systemSmall", makeCtx({ family: "systemSmall", env: { NODE: "hk-01" } })],
    [
      "小 · 指定线路（移动）",
      "systemSmall",
      makeCtx({ family: "systemSmall", env: { NODE: "hk-01", CARRIER: "移动" } }),
    ],
    [
      "小 · 有丢包",
      "systemSmall",
      makeCtx({ family: "systemSmall", env: { NODE: "us-la", CARRIER: "cm" } }),
    ],
    ["小 · 离线节点", "systemSmall", makeCtx({ family: "systemSmall", env: { NODE: "de-fra" } })],
    ["小 · 长名字", "systemSmall", makeCtx({ family: "systemSmall", env: { NODE: "jp-tokyo" } })],
    [
      "小 · 只有离线机",
      "systemSmall",
      makeCtx({
        family: "systemSmall",
        response: { status: 200, json: async () => buildSnapshot(OFFLINE_ONLY) },
      }),
    ],
  ],
  medium: [
    ["中 · 自动排序", "systemMedium", makeCtx({ family: "systemMedium" })],
    [
      "中 · 只有 3 台",
      "systemMedium",
      makeCtx({
        family: "systemMedium",
        response: { status: 200, json: async () => buildSnapshot(FEW.slice(0, 3)) },
      }),
    ],
    [
      "中 · 指定节点",
      "systemMedium",
      makeCtx({
        family: "systemMedium",
        env: { NODES: "hk-01,jp-tokyo,us-la,sg-01,kr-icn" },
      }),
    ],
  ],
  large: [
    ["大 · 自动排序", "systemLarge", makeCtx({ family: "systemLarge" })],
    [
      "大 · 全在线",
      "systemLarge",
      makeCtx({
        family: "systemLarge",
        response: {
          status: 200,
          json: async () => buildSnapshot(SERVERS.filter((s) => s.is_online)),
        },
      }),
    ],
    [
      "大 · Mac 尺寸 · 只有 4 台",
      "systemLarge",
      makeCtx({
        family: "systemLarge",
        response: { status: 200, json: async () => buildSnapshot(FEW) },
      }),
      MAC_LARGE,
    ],
    [
      "大 · Mac 尺寸 · 指定电信",
      "systemLarge",
      makeCtx({
        family: "systemLarge",
        env: { CARRIER: "ct" },
        response: { status: 200, json: async () => buildSnapshot(FEW) },
      }),
      MAC_LARGE,
    ],
  ],
  errors: [
    ["错误 · 未配置", "systemMedium", { widgetFamily: "systemMedium", env: {}, http: { get: async () => ({}) } }],
    [
      "错误 · 人机验证",
      "systemMedium",
      makeCtx({ family: "systemMedium", response: { status: 403, json: async () => ({}) } }),
    ],
    [
      "错误 · 连不上",
      "systemSmall",
      {
        widgetFamily: "systemSmall",
        env: { API_BASE: "https://status.example.com" },
        http: {
          get: async () => {
            throw new Error("ETIMEDOUT");
          },
        },
      },
    ],
    [
      "错误 · 节点没找到",
      "systemSmall",
      makeCtx({ family: "systemSmall", env: { NODE: "不存在的机器" } }),
    ],
  ],
};

function page(title, cards) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { margin:0; padding:20px; background:#8a8f98;
         font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif; }
  /* 浅深色并排一行，一屏内看完对比。 */
  .grid { display:flex; flex-wrap:wrap; gap:16px; align-items:flex-start; }
  .card { margin:0; }
  figcaption { font-size:13px; color:#fff; margin-bottom:6px; opacity:.9; }
  .scaler { overflow:hidden; }
  .scaler > .widget { transform:scale(${SCALE}); transform-origin:top left; }
  .widget { border-radius:22px; overflow:hidden; box-shadow:0 6px 18px rgba(0,0,0,.25);
            box-sizing:border-box; }
  /* 根节点必须撑满整块，否则 spacer 没有剩余空间可占，底部内容不会被顶到底。 */
  .widget > div { width:100%; height:100%; }
  .widget.light { background:#fdfdfd; }
  .widget.dark  { background:#1c2027; }
  .widget * { box-sizing:border-box; }
</style></head>
<body><div class="grid">${cards.join("")}</div></body></html>
`;
}

for (const [name, entries] of Object.entries(PAGES)) {
  const cards = await Promise.all(
    entries.map(([label, family, ctx, size]) => card(label, family, ctx, size)),
  );
  const out = resolve(root, `preview-${name}.html`);
  writeFileSync(out, page(`cfsm-status 预览 · ${name}`, cards));
  console.log(`预览已生成：${out}`);
}
