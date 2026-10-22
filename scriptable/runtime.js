/**
 * CF-Server-Monitor 小组件的 Scriptable 运行时。
 *
 * 不重写一遍小组件：取数、排序、配色、三个尺寸的版式全部还是 `cfsm-status.js` 那一份，
 * 这里只做两件事 ——
 *   1. 把 Egern 风格的 `ctx`（`env` / `http.get` / `widgetFamily`）用 Scriptable 的 API 拼出来；
 *   2. 把 `cfsm-status.js` 返回的 Egern DSL 树逐个节点翻成 Scriptable 的 `ListWidget`。
 * 所以以后改版式、改口径只改 `cfsm-status.js`，两边一起生效。
 *
 * 本文件由 `loader.js`（用户粘贴进 Scriptable 的那一小段）下载后用 `new Function` 执行，
 * 所以它是一个**函数体**：没有 import / export，末尾 `return` 出对外的几个函数。
 * 测试里也是同样的方式加载它。
 *
 * Scriptable 没有环境变量，配置分两层，合并后当作 `ctx.env` 交给核心脚本：
 *   - 加载器顶部的 `CONFIG` —— 相当于 Egern 里填在**脚本**上的 env，所有小组件共用；
 *   - 每个小组件「编辑小组件 → Parameter」那一行 —— 相当于填在**小组件**上的 env，后者覆盖前者。
 *
 * 翻译时最大的差别是 **Scriptable 的 stack 没有 flex**：
 *   - `flex` 文本 → 文本后面补一个弹性 spacer，把同行后面的定宽块推到行尾；
 *   - 进度条轨道（定宽、两个按 flex 分配的子块）→ 按占比直接算出像素宽度；
 *   - 没有宽度的 `flex` stack（大尺寸的汇总方块）→ 让它里面每一行都带弹性 spacer，
 *     几个这样的「贪婪」兄弟会被系统平分宽度，效果等同于 `flex: 1`。
 */

/** Scriptable 的 `config.widgetFamily` → Egern 的尺寸名。锁屏尺寸原样透传，核心脚本会退回单节点视图。 */
const FAMILIES = {
  small: "systemSmall",
  medium: "systemMedium",
  large: "systemLarge",
  extraLarge: "systemExtraLarge",
};

function familyOf(raw) {
  if (!raw) return "systemMedium";
  return FAMILIES[raw] ?? String(raw);
}

/**
 * 小组件 Parameter → env。
 *
 * 写法是 `KEY=值`，多条用分号或换行隔开：`NODE=hk-01; CARRIER=电信`。
 * 不带等号的一段按内容猜：`http(s)://` 开头当 API_BASE，否则当 NODE ——
 * 小尺寸最常见的需求就是「这一块看哪台」，只写一个机器名就够了。
 * 不按逗号切：`NODES` 本身就是逗号分隔的列表。
 */
function parseParameter(raw) {
  const env = {};
  for (const part of String(raw ?? "").split(/[;；\n]+/)) {
    const token = part.trim();
    if (!token) continue;
    const eq = token.search(/[=＝]/);
    if (eq < 0) {
      env[/^https?:\/\//i.test(token) ? "API_BASE" : "NODE"] = unquote(token);
      continue;
    }
    const key = token.slice(0, eq).trim().toUpperCase();
    if (key) env[key] = unquote(token.slice(eq + 1).trim());
  }
  return env;
}

/** 去掉成对的引号：手机输入法常把 `"` 换成中文引号，两种都认。 */
function unquote(value) {
  return value.replace(/^["'“‘](.*)["'”’]$/, "$1");
}

/** 加载器 CONFIG 打底，小组件 Parameter 覆盖。空字符串不覆盖，免得 `NODE=` 把 CONFIG 里的值抹掉。 */
function mergeEnv(settings, parameter) {
  const env = {};
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (value != null && String(value).trim() !== "") env[key.toUpperCase()] = String(value);
  }
  for (const [key, value] of Object.entries(parseParameter(parameter))) {
    if (value !== "") env[key] = value;
  }
  return env;
}

/**
 * 把一份 ESM 源码当普通函数体执行，拿到它的导出。
 *
 * Scriptable 不认 ES Module 语法，`importModule` 也只认本地 CommonJS 文件；而 `cfsm-status.js`
 * 必须保持 ESM 给 Egern 用。好在它刻意写成了单文件、无 import，这里只需要处理三种导出写法：
 * `export function` / `export default` / 末尾的 `export { a, b }`。
 */
function toModule(source) {
  const names = [];
  const body = String(source)
    .replace(/^export default /m, "__exports.default = ")
    .replace(/^export \{([^}]*)\};?/gm, (_, list) => {
      for (const item of list.split(",")) {
        const [local, exported = local] = item.trim().split(/\s+as\s+/);
        if (local) names.push([local, exported]);
      }
      return "";
    })
    .replace(
      /^export ((?:async\s+)?function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm,
      (_, kind, name) => {
        names.push([name, name]);
        return `${kind} ${name}`;
      },
    );
  if (/^\s*import[\s{*]/m.test(body)) throw new Error("模块里有 import 语句，Scriptable 加载不了");
  const tail = names
    .map(([local, exported]) => `__exports[${JSON.stringify(exported)}] = ${local};`)
    .join("\n");
  return new Function("__exports", `"use strict";\n${body}\n;${tail}\nreturn __exports;`)({});
}

// ---------------------------------------------------------------- 颜色与字体

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` → `{ hex: "#rrggbb", alpha }`。认不出来给 null。 */
function parseColor(value) {
  const s = String(value ?? "").trim();
  let m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) return { hex: `#${m[1].toLowerCase()}`, alpha: m[2] ? Number.parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) {
    const hex = [m[1], m[2], m[3]]
      .map((v) => clamp(Math.round(Number(v)), 0, 255).toString(16).padStart(2, "0"))
      .join("");
    return { hex: `#${hex}`, alpha: m[4] == null ? 1 : clamp(Number(m[4]), 0, 1) };
  }
  return null;
}

/** DSL 颜色（字符串或 `{ light, dark }`）→ Scriptable Color。自适应色用 `Color.dynamic`。 */
function makeColor(api, value) {
  if (value == null) return null;
  if (typeof value === "object") {
    const light = makeColor(api, value.light ?? value.dark);
    const dark = makeColor(api, value.dark ?? value.light);
    if (!light || !dark) return light ?? dark;
    return api.Color.dynamic(light, dark);
  }
  const parsed = parseColor(value);
  return parsed ? new api.Color(parsed.hex, parsed.alpha) : null;
}

const FONT_BY_WEIGHT = {
  ultraLight: "ultraLightSystemFont",
  thin: "thinSystemFont",
  light: "lightSystemFont",
  regular: "regularSystemFont",
  medium: "mediumSystemFont",
  semibold: "semiboldSystemFont",
  bold: "boldSystemFont",
  heavy: "heavySystemFont",
  black: "blackSystemFont",
};

/** DSL 允许写字号名（caption1 之类），Scriptable 的粗细字体只收数字，按 iOS 默认字号换算。 */
const NAMED_SIZES = {
  caption2: 11,
  caption1: 12,
  footnote: 13,
  subheadline: 15,
  callout: 16,
  body: 17,
  headline: 17,
  title3: 20,
  title2: 22,
  title: 28,
  largeTitle: 34,
};

function makeFont(api, font) {
  const raw = font?.size ?? 12;
  const size = typeof raw === "number" ? raw : (NAMED_SIZES[raw] ?? 12);
  const method = FONT_BY_WEIGHT[font?.weight] ?? "systemFont";
  return api.Font[method](size);
}

function makeGradient(api, value) {
  const colors = (value?.colors ?? []).map((c) => makeColor(api, c)).filter(Boolean);
  if (!colors.length) return null;
  const gradient = new api.LinearGradient();
  gradient.colors = colors;
  gradient.locations =
    Array.isArray(value.stops) && value.stops.length === colors.length
      ? value.stops
      : colors.map((_, i) => (colors.length === 1 ? 0 : i / (colors.length - 1)));
  const start = value.startPoint ?? { x: 0, y: 0 };
  const end = value.endPoint ?? { x: 0, y: 1 };
  gradient.startPoint = new api.Point(start.x, start.y);
  gradient.endPoint = new api.Point(end.x, end.y);
  return gradient;
}

// ---------------------------------------------------------------- DSL → ListWidget

/**
 * 本运行时会翻译的属性。核心脚本以后要是用了这里没有的元素或属性，测试会报出来 ——
 * 不然那个属性在 Scriptable 上会被静默丢掉，和 Egern 写错键名是同一种难查的毛病。
 */
const HANDLED_PROPS = {
  widget: ["type", "children", "refreshAfter", "padding", "gap", "backgroundColor", "backgroundGradient", "url"],
  stack: [
    "type",
    "direction",
    "alignItems",
    "children",
    "gap",
    "padding",
    "width",
    "height",
    "flex",
    "backgroundColor",
    "backgroundGradient",
    "borderRadius",
    "borderWidth",
    "borderColor",
    "url",
  ],
  text: ["type", "text", "font", "textColor", "textAlign", "maxLines", "minScale", "opacity", "flex"],
  date: ["type", "date", "format", "font", "textColor", "textAlign", "maxLines", "minScale", "opacity"],
  spacer: ["type", "length"],
};

const DATE_STYLES = {
  relative: "applyRelativeStyle",
  time: "applyTimeStyle",
  date: "applyDateStyle",
  offset: "applyOffsetStyle",
  timer: "applyTimerStyle",
};

/**
 * 把一棵 Egern DSL 树建成 Scriptable 的 ListWidget。
 *
 * `api` 是 Scriptable 的那几个全局构造器（真机上就是全局对象，测试里换成假的）；
 * `onUnknown(path, what)` 遇到不认识的元素或属性时调用，默认静默跳过。
 */
function buildWidget(dsl, api, { onUnknown = () => {} } = {}) {
  const widget = new api.ListWidget();
  check(dsl, "root", "widget", onUnknown);
  applyPadding(widget, dsl.padding);
  if (dsl.gap != null) widget.spacing = dsl.gap;
  applyBackground(widget, dsl, api);
  if (dsl.url) widget.url = dsl.url;
  if (dsl.refreshAfter) widget.refreshAfterDate = new Date(dsl.refreshAfter);
  addChildren(widget, dsl.children, { direction: "column", alignItems: "center" }, api, "root", onUnknown);
  return widget;
}

function check(node, path, expected, onUnknown) {
  const type = node?.type;
  if (expected && type !== expected) onUnknown(path, `根节点应为 ${expected}，实际是 ${type}`);
  const handled = HANDLED_PROPS[type];
  if (!handled) {
    onUnknown(path, `元素 ${type}`);
    return false;
  }
  for (const key of Object.keys(node)) {
    if (!handled.includes(key)) onUnknown(path, `${type}.${key}`);
  }
  return true;
}

function applyPadding(target, padding) {
  if (padding == null) return;
  if (typeof padding === "number") {
    target.setPadding(padding, padding, padding, padding);
    return;
  }
  if (Array.isArray(padding)) {
    // [上下, 左右] 或 [上, 左, 下, 右]（与 Scriptable setPadding 的参数顺序相同）
    const [top, left = top, bottom = top, right = left] = padding;
    target.setPadding(top, left, bottom, right);
  }
}

function applyBackground(target, node, api) {
  if (node.backgroundGradient) {
    const gradient = makeGradient(api, node.backgroundGradient);
    if (gradient) target.backgroundGradient = gradient;
  }
  if (node.backgroundColor != null) {
    const color = makeColor(api, node.backgroundColor);
    if (color) target.backgroundColor = color;
  }
}

/**
 * 加一串子元素。
 *
 * `parent` 是容器自己的布局信息：方向、交叉轴对齐，以及（行容器才有的）定宽 ——
 * 定宽的 `cell` 里只有一段文字时，文字的 textAlign 要靠两侧补 spacer 才能生效。
 */
function addChildren(container, children, parent, api, path, onUnknown) {
  const list = Array.isArray(children) ? children : [];
  list.forEach((child, index) => {
    const childPath = `${path}.${index}`;
    if (!check(child, childPath, null, onUnknown)) return;

    if (child.type === "spacer") {
      if (child.length != null) container.addSpacer(child.length);
      else container.addSpacer();
      return;
    }

    if (child.type === "stack") {
      addStack(container, child, api, childPath, onUnknown);
      return;
    }

    // text / date
    if (parent.direction === "row") {
      const fills = child.flex != null || (parent.width != null && list.length === 1);
      const element = addAligned(container, child, fills ? child.textAlign ?? "left" : null, api);
      // 定宽单元里的数字：spacer 的最小长度已经在 addStack 里用负间距抵掉了（见 SPACER_MIN_LENGTH），
      // 这里再兜一层底 —— 万一还是放不下，缩字而不是截成「6…」。
      if (parent.width != null) {
        if (child.maxLines == null) element.lineLimit = 1;
        if (child.minScale == null) element.minimumScaleFactor = 0.5;
      }
    } else {
      // 列容器里的文字包一层横向 stack 来落实 alignItems：Scriptable 的竖排对齐不可控，
      // 包了之后这一行带弹性 spacer、会占满整列宽度，方块类容器也因此能被平分宽度。
      const row = container.addStack();
      row.layoutHorizontally();
      addAligned(row, child, ALIGN_TO_TEXT[parent.alignItems] ?? "center", api);
    }
  });
}

const ALIGN_TO_TEXT = { start: "left", center: "center", end: "right" };

/** 加一段文字或日期；`align` 不为空时用两侧的弹性 spacer 把它摆到对应位置。 */
function addAligned(container, node, align, api) {
  if (align === "center" || align === "right") container.addSpacer();
  const element = node.type === "date" ? addDate(container, node, api) : addText(container, node, api);
  if (align === "left" || align === "center") container.addSpacer();
  return element;
}

function styleText(element, node, api) {
  element.font = makeFont(api, node.font);
  const color = makeColor(api, node.textColor);
  if (color) element.textColor = color;
  if (node.maxLines != null) element.lineLimit = node.maxLines;
  if (node.minScale != null) element.minimumScaleFactor = node.minScale;
  if (node.opacity != null) element.textOpacity = node.opacity;
  if (node.textAlign === "center") element.centerAlignText();
  else if (node.textAlign === "right") element.rightAlignText();
  else if (node.textAlign === "left") element.leftAlignText();
}

function addText(container, node, api) {
  const element = container.addText(String(node.text ?? ""));
  styleText(element, node, api);
  return element;
}

function addDate(container, node, api) {
  const element = container.addDate(new Date(node.date));
  styleText(element, node, api);
  const style = DATE_STYLES[node.format ?? "date"];
  if (style) element[style]();
  return element;
}

/** 进度条轨道：定宽，子元素全是按 flex 分配的 stack。 */
function isTrack(node) {
  const kids = node.children ?? [];
  return (
    kids.length > 0 &&
    kids.every((k) => k?.type === "stack" && typeof k.flex === "number" && !(k.children ?? []).length)
  );
}

function addStack(container, node, api, path, onUnknown) {
  const stack = container.addStack();
  const direction = node.direction === "column" ? "column" : "row";
  if (direction === "column") stack.layoutVertically();
  else stack.layoutHorizontally();

  if (direction === "row") {
    if (node.alignItems === "start") stack.topAlignContent();
    else if (node.alignItems === "end") stack.bottomAlignContent();
    else stack.centerAlignContent();
  }

  if (node.gap != null) stack.spacing = node.gap;
  applyPadding(stack, node.padding);
  if (node.width != null || node.height != null) {
    stack.size = new api.Size(node.width ?? 0, node.height ?? 0);
  }
  if (node.borderRadius != null) stack.cornerRadius = node.borderRadius;
  if (node.borderWidth != null) stack.borderWidth = node.borderWidth;
  if (node.borderColor != null) {
    const border = makeColor(api, node.borderColor);
    if (border) stack.borderColor = border;
  }
  applyBackground(stack, node, api);
  if (node.url) stack.url = node.url;

  if (direction === "row" && isTrack(node)) {
    addTrackSegments(stack, node, api, path, onUnknown);
    return stack;
  }

  // 定宽单元（一段文字靠弹性 spacer 摆到右边 / 中间）：用负的间距抵掉 spacer 自带的最小长度。
  // 不抵的话 24pt 的格子只剩 16pt，两位数的百分比被缩小、一位数的不缩，同一列字号大小不一。
  if (direction === "row" && node.width != null && isSingleText(node)) {
    stack.spacing = (node.gap ?? 0) - SPACER_MIN_LENGTH;
  }

  addChildren(
    stack,
    node.children,
    { direction, alignItems: node.alignItems ?? "center", width: node.width },
    api,
    path,
    onUnknown,
  );

  // 没定宽的 flex 横排 stack：里面没有弹性元素的话补一个，让它像 flex 那样撑开。
  if (direction === "row" && node.flex != null && node.width == null && !hasFlexibleChild(node)) {
    stack.addSpacer();
  }
  return stack;
}

/**
 * Scriptable 弹性 spacer 自带的最小长度。它的 addSpacer() 对应 SwiftUI 的 Spacer()，
 * 默认最小长度是系统间距 8pt。真机截图反推：26pt 的格子放不下 9pt 的「19%」（约 18pt 宽），
 * 而格子右沿和文字右沿是对齐的 —— 被吃掉的正是左边 spacer 的那 8pt。
 */
const SPACER_MIN_LENGTH = 8;

function isSingleText(node) {
  const kids = node.children ?? [];
  return kids.length === 1 && (kids[0]?.type === "text" || kids[0]?.type === "date");
}

function hasFlexibleChild(node) {
  return (node.children ?? []).some(
    (k) => (k.type === "spacer" && k.length == null) || k.flex != null,
  );
}

/**
 * 进度条：Egern 版靠两段 flex 的占比画填充，Scriptable 没有 flex，只能按轨道宽度换算成像素。
 * 轨道没有定宽时（核心脚本目前不会这样用）按 40pt 估。宽度不足 1pt 的段直接不画。
 */
function addTrackSegments(stack, node, api, path, onUnknown) {
  const width = node.width ?? 40;
  const kids = node.children;
  const total = kids.reduce((sum, k) => sum + Math.max(0, k.flex), 0) || 1;
  let used = 0;
  kids.forEach((kid, index) => {
    check(kid, `${path}.${index}`, null, onUnknown);
    const last = index === kids.length - 1;
    const segment = last ? width - used : Math.round((width * Math.max(0, kid.flex)) / total);
    used += segment;
    if (segment < 1) return;
    const piece = stack.addStack();
    piece.size = new api.Size(segment, kid.height ?? node.height ?? 0);
    if (kid.borderRadius != null) piece.cornerRadius = kid.borderRadius;
    applyBackground(piece, kid, api);
  });
}

// ---------------------------------------------------------------- 取数与入口

/** 用 Scriptable 的 Request 拼出核心脚本要的 `ctx.http.get`。 */
function httpClient(api) {
  return {
    async get(url, { headers, timeout } = {}) {
      const request = new api.Request(url);
      request.method = "GET";
      if (headers) request.headers = headers;
      if (timeout) request.timeoutInterval = timeout / 1000;
      const body = await request.loadString();
      const status = request.response?.statusCode ?? 200;
      return { status, json: async () => JSON.parse(body) };
    },
  };
}

async function renderWidget(core, env, family, api, options) {
  const ctx = { widgetFamily: familyOf(family), env, http: httpClient(api) };
  const dsl = await core.default(ctx);
  return buildWidget(dsl, api, options);
}

/** Scriptable 的全局构造器。只在真机上调用；测试直接给 buildWidget / renderWidget 传假的。 */
function globalApi() {
  return { ListWidget, Color, Font, Size, Point, LinearGradient, Request };
}

/** 在 App 里直接运行时让人选一个尺寸预览。返回 Scriptable 的尺寸名，取消返回 null。 */
async function pickFamily() {
  const alert = new Alert();
  alert.title = "预览哪个尺寸？";
  alert.message = "主屏上的小组件不受这里影响；这一次运行也顺带把代码更新到了最新。";
  for (const label of ["小", "中", "大"]) alert.addAction(label);
  alert.addCancelAction("取消");
  const index = await alert.presentSheet();
  return ["small", "medium", "large"][index] ?? null;
}

const PRESENTERS = { small: "presentSmall", medium: "presentMedium", large: "presentLarge" };

/**
 * 加载器调用的入口。
 *
 * @param {object} options
 * @param {object} options.settings  加载器顶部的 CONFIG
 * @param {string} options.coreSource  cfsm-status.js 的源码
 * @param {string} [options.parameter]  小组件的 Parameter（args.widgetParameter）
 */
async function run({ settings, coreSource, parameter }) {
  const api = globalApi();
  const core = toModule(coreSource);
  const env = mergeEnv(settings, parameter);

  if (config.runsInWidget) {
    Script.setWidget(await renderWidget(core, env, config.widgetFamily, api));
  } else {
    const family = await pickFamily();
    if (family) {
      const widget = await renderWidget(core, env, family, api);
      await widget[PRESENTERS[family]]();
    }
  }
  Script.complete();
}

return {
  run,
  renderWidget,
  buildWidget,
  toModule,
  parseParameter,
  mergeEnv,
  familyOf,
  parseColor,
  HANDLED_PROPS,
};
