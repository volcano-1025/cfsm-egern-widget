/**
 * Egern Widget DSL 的属性白名单，逐条抄自官方文档的元素属性表：
 * https://egernapp.com/zh-CN/docs/configuration/widgets/
 *
 * 存在的意义：cfsm-status.js 是没有类型检查的纯 JS，写错一个键名（padings、textColour、
 * lineLimit……）Egern 会静默忽略，真机上只表现为「某处样式没生效」，极难排查。
 * 这份表让单元测试能把这类手滑当场抓住。
 */

export const ELEMENT_PROPS = {
  widget: [
    "type",
    "children",
    "refreshAfter",
    "padding",
    "gap",
    "backgroundColor",
    "backgroundGradient",
    "backgroundImage",
    "url",
  ],
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
  text: [
    "type",
    "text",
    "font",
    "textColor",
    "textAlign",
    "maxLines",
    "minScale",
    "opacity",
    "url",
    "flex",
  ],
  image: [
    "type",
    "src",
    "color",
    "resizeMode",
    "resizable",
    "width",
    "height",
    "borderRadius",
    "borderWidth",
    "borderColor",
    "opacity",
    "url",
    "flex",
  ],
  spacer: ["type", "length"],
  date: [
    "type",
    "date",
    "format",
    "font",
    "textColor",
    "textAlign",
    "maxLines",
    "minScale",
    "opacity",
    "url",
  ],
};

export const FONT_SIZES = [
  "largeTitle",
  "title",
  "title2",
  "title3",
  "headline",
  "body",
  "callout",
  "subheadline",
  "footnote",
  "caption1",
  "caption2",
];

export const FONT_WEIGHTS = [
  "ultraLight",
  "thin",
  "light",
  "regular",
  "medium",
  "semibold",
  "bold",
  "heavy",
  "black",
];

export const DIRECTIONS = ["row", "column"];
export const ALIGN_ITEMS = ["start", "center", "end"];
export const TEXT_ALIGNS = ["left", "center", "right"];
export const DATE_FORMATS = ["date", "time", "relative", "offset", "timer"];

/** 递归校验一棵 DSL 树，返回问题清单（空数组表示合法）。 */
export function validateTree(node, path = "root") {
  const problems = [];

  if (node == null || typeof node !== "object") {
    problems.push(`${path}: 不是对象`);
    return problems;
  }

  const allowed = ELEMENT_PROPS[node.type];
  if (!allowed) {
    problems.push(`${path}: 未知元素类型 ${JSON.stringify(node.type)}`);
    return problems;
  }

  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) problems.push(`${path}(${node.type}): 多余属性 ${key}`);
  }

  if (node.font != null) {
    for (const key of Object.keys(node.font)) {
      if (!["size", "weight", "family"].includes(key)) {
        problems.push(`${path}.font: 多余属性 ${key}`);
      }
    }
    const { size, weight } = node.font;
    if (size != null && typeof size !== "number" && !FONT_SIZES.includes(size)) {
      problems.push(`${path}.font.size: 非法字号 ${JSON.stringify(size)}`);
    }
    if (weight != null && !FONT_WEIGHTS.includes(weight)) {
      problems.push(`${path}.font.weight: 非法字重 ${JSON.stringify(weight)}`);
    }
  }

  for (const key of ["textColor", "backgroundColor", "borderColor", "color"]) {
    if (node[key] != null) problems.push(...validateColor(node[key], `${path}.${key}`));
  }

  if (node.direction != null && !DIRECTIONS.includes(node.direction)) {
    problems.push(`${path}.direction: 非法值 ${JSON.stringify(node.direction)}`);
  }
  if (node.alignItems != null && !ALIGN_ITEMS.includes(node.alignItems)) {
    problems.push(`${path}.alignItems: 非法值 ${JSON.stringify(node.alignItems)}`);
  }
  if (node.textAlign != null && !TEXT_ALIGNS.includes(node.textAlign)) {
    problems.push(`${path}.textAlign: 非法值 ${JSON.stringify(node.textAlign)}`);
  }
  if (node.type === "date") {
    if (node.format != null && !DATE_FORMATS.includes(node.format)) {
      problems.push(`${path}.format: 非法值 ${JSON.stringify(node.format)}`);
    }
    if (Number.isNaN(Date.parse(node.date))) {
      problems.push(`${path}.date: 不是可解析的 ISO 时间 ${JSON.stringify(node.date)}`);
    }
  }
  if (node.type === "text" && typeof node.text !== "string") {
    problems.push(`${path}.text: 必须是字符串`);
  }
  if (node.refreshAfter != null && Number.isNaN(Date.parse(node.refreshAfter))) {
    problems.push(`${path}.refreshAfter: 不是可解析的 ISO 时间`);
  }

  if (node.children != null) {
    if (!Array.isArray(node.children)) {
      problems.push(`${path}.children: 必须是数组`);
    } else {
      node.children.forEach((child, i) => {
        problems.push(...validateTree(child, `${path}.children[${i}]`));
      });
    }
  }

  return problems;
}

function validateColor(value, path) {
  if (typeof value === "string") {
    return /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|rgba?\()/.test(value)
      ? []
      : [`${path}: 非法颜色 ${JSON.stringify(value)}`];
  }
  if (value && typeof value === "object") {
    const problems = [];
    for (const key of Object.keys(value)) {
      if (!["light", "dark"].includes(key)) problems.push(`${path}: 自适应颜色多余键 ${key}`);
    }
    if (!value.light && !value.dark) problems.push(`${path}: 自适应颜色缺少 light/dark`);
    for (const key of ["light", "dark"]) {
      if (value[key] != null) problems.push(...validateColor(value[key], `${path}.${key}`));
    }
    return problems;
  }
  return [`${path}: 颜色必须是字符串或 {light,dark}`];
}

/** 把树里所有 text 的文案拼起来，方便断言「渲染出了哪些内容」。 */
export function collectText(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "text") out.push(node.text);
  (node.children ?? []).forEach((child) => collectText(child, out));
  return out;
}

/**
 * 数出树里有多少个节点行。
 *
 * 判据是「直接子元素里既有状态点 ● 又有进度条轨道」：大尺寸标题栏的图例也用 ●，
 * 小尺寸表头同样有状态点，只有节点行两者兼具。
 */
export function collectNodeRows(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const children = node.children ?? [];
  const hasDot = children.some((c) => c.type === "text" && c.text === "●");
  const hasBar = children.some(
    (c) =>
      c.type === "stack" &&
      c.borderRadius != null &&
      Array.isArray(c.children) &&
      c.children.length === 2 &&
      // 填充段 + 剩余段，两段都按占比分配 —— 大尺寸的汇总 tile 也是圆角双子元素，靠这条区分开
      c.children.every((k) => k.type === "stack" && typeof k.flex === "number"),
  );
  if (hasDot && hasBar) out.push(node);
  children.forEach((child) => collectNodeRows(child, out));
  return out;
}

export function countNodeRows(node) {
  return collectNodeRows(node).length;
}
