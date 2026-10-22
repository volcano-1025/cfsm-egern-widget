/**
 * 假的 Scriptable API：只实现 runtime.js / loader.js 用到的那部分，把调用记成一棵树，
 * 让测试能断言「建出来的小组件长什么样」。
 *
 * 这不是模拟器 —— 真正的排版（弹性 spacer 怎么分空间、文字怎么缩）只有真机才知道，
 * 这里只验证翻译逻辑：该补 spacer 的地方补了、进度条宽度算对了、属性都落到了对应的 API 上。
 */

class FakeText {
  constructor(kind, value) {
    this.kind = kind;
    this.value = value;
  }
  leftAlignText() {
    this.align = "left";
  }
  centerAlignText() {
    this.align = "center";
  }
  rightAlignText() {
    this.align = "right";
  }
  applyRelativeStyle() {
    this.style = "relative";
  }
  applyTimeStyle() {
    this.style = "time";
  }
  applyDateStyle() {
    this.style = "date";
  }
  applyOffsetStyle() {
    this.style = "offset";
  }
  applyTimerStyle() {
    this.style = "timer";
  }
}

class FakeContainer {
  constructor(kind) {
    this.kind = kind;
    this.direction = "row";
    this.items = [];
  }
  addStack() {
    const stack = new FakeContainer("stack");
    this.items.push(stack);
    return stack;
  }
  addText(value) {
    const text = new FakeText("text", value);
    this.items.push(text);
    return text;
  }
  addDate(value) {
    const date = new FakeText("date", value);
    this.items.push(date);
    return date;
  }
  addSpacer(length) {
    this.items.push({ kind: "spacer", length: length ?? null });
  }
  layoutHorizontally() {
    this.direction = "row";
  }
  layoutVertically() {
    this.direction = "column";
  }
  setPadding(...padding) {
    this.padding = padding;
  }
  topAlignContent() {
    this.align = "top";
  }
  centerAlignContent() {
    this.align = "center";
  }
  bottomAlignContent() {
    this.align = "bottom";
  }
}

export class FakeWidget extends FakeContainer {
  constructor() {
    super("widget");
    this.direction = "column";
  }
  async presentSmall() {
    this.presented = "small";
  }
  async presentMedium() {
    this.presented = "medium";
  }
  async presentLarge() {
    this.presented = "large";
  }
}

export class FakeColor {
  constructor(hex, alpha = 1) {
    this.hex = hex;
    this.alpha = alpha;
  }
  static dynamic(light, dark) {
    return { dynamic: true, light, dark };
  }
  static red() {
    return new FakeColor("#ff0000");
  }
}

/** Font.xxxSystemFont(size) 一律记成 { name, size }。 */
export const FakeFont = new Proxy({}, { get: (_, name) => (size) => ({ name, size }) });

export class FakeSize {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
}

export class FakePoint {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

export class FakeLinearGradient {}

/** `handler(url, request)` 返回 `{ status, body }`；抛错就模拟网络失败。 */
export function fakeRequest(handler) {
  return class FakeRequest {
    constructor(url) {
      this.url = url;
    }
    async loadString() {
      const { status = 200, body = "" } = await handler(this.url, this);
      this.response = { statusCode: status };
      return body;
    }
  };
}

export function fakeApi(handler = () => ({ status: 200, body: "{}" })) {
  return {
    ListWidget: FakeWidget,
    Color: FakeColor,
    Font: FakeFont,
    Size: FakeSize,
    Point: FakePoint,
    LinearGradient: FakeLinearGradient,
    Request: fakeRequest(handler),
  };
}

/** 内存里的 FileManager.local()，`files` 是 path → { text, mtime } 的 Map。 */
export function fakeFileManager(files = new Map()) {
  const fm = {
    files,
    documentsDirectory: () => "/docs",
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: (path) => path === "/docs/cfsm-widget" || files.has(path),
    createDirectory: () => {},
    readString: (path) => files.get(path)?.text,
    writeString: (path, text) => files.set(path, { text, mtime: new Date() }),
    modificationDate: (path) => files.get(path)?.mtime ?? new Date(0),
  };
  return { local: () => fm, fm };
}

/** 按顺序收集树里所有文字（text 的内容；date 记成「<date>」）。 */
export function textsOf(node, out = []) {
  for (const item of node.items ?? []) {
    if (item.kind === "text") out.push(item.value);
    else if (item.kind === "date") out.push("<date>");
    else textsOf(item, out);
  }
  return out;
}

/** 深度优先找第一个满足条件的元素。 */
export function findItem(node, predicate) {
  for (const item of node.items ?? []) {
    if (predicate(item)) return item;
    const hit = findItem(item, predicate);
    if (hit) return hit;
  }
  return null;
}
