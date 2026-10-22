import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as esm from "../cfsm-status.js";
import { NOW, buildSnapshot } from "./fixture.js";
import {
  FakeColor,
  FakeFont,
  FakeLinearGradient,
  FakePoint,
  FakeSize,
  FakeWidget,
  fakeApi,
  fakeFileManager,
  fakeRequest,
  findItem,
  textsOf,
} from "./scriptable-fakes.js";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const CORE_SOURCE = read("../cfsm-status.js");
const LOADER_SOURCE = read("../scriptable/loader.js");
// 和加载器在真机上的做法一样：把 runtime.js 当函数体执行，拿它 return 出来的对象。
const runtime = new Function(read("../scriptable/runtime.js"))();

const API_BASE = "https://status.example.com";
const FAMILIES = ["systemSmall", "systemMedium", "systemLarge"];

function ctxFor(family, env = {}, response) {
  return {
    widgetFamily: family,
    env: { API_BASE, ...env },
    http: {
      get: async () => response ?? { status: 200, json: async () => buildSnapshot() },
    },
  };
}

/** 用 ESM 版核心脚本渲染出 DSL，再交给 Scriptable 运行时翻译。 */
async function build(family, env, response) {
  const unknown = [];
  const dsl = await esm.render(ctxFor(family, env, response), NOW);
  const widget = runtime.buildWidget(dsl, fakeApi(), {
    onUnknown: (path, what) => unknown.push(`${path}: ${what}`),
  });
  return { widget, unknown, dsl };
}

/** 找第一个定了这个尺寸的 stack。 */
function stackOfSize(widget, width, height) {
  return findItem(
    widget,
    (item) =>
      item.kind === "stack" &&
      item.size?.width === width &&
      (height == null || item.size?.height === height),
  );
}

describe("toModule：在 Scriptable 里执行 ESM 版核心脚本", () => {
  const core = runtime.toModule(CORE_SOURCE);

  it("导出的名字和 ESM 版一个不差", () => {
    expect(Object.keys(core).sort()).toEqual(Object.keys(esm).sort());
  });

  it.each(FAMILIES)("%s 渲染出的 DSL 和 ESM 版逐字段相同", async (family) => {
    for (const env of [{}, { NODE: "us-la", CARRIER: "移动" }, { LATENCY_STYLE: "chip" }]) {
      expect(await core.render(ctxFor(family, env), NOW)).toEqual(
        await esm.render(ctxFor(family, env), NOW),
      );
    }
  });

  it("认得 export { a as b }", () => {
    const mod = runtime.toModule("function a() { return 1; }\nexport { a as b };\n");
    expect(mod.b()).toBe(1);
  });

  it("有 import 语句时直接报错，而不是执行出一个残缺的模块", () => {
    expect(() => runtime.toModule('import x from "./x.js";\nexport default x;')).toThrow(
      /import/,
    );
  });
});

describe("小组件 Parameter → env", () => {
  it("KEY=值，分号或换行分隔，key 不分大小写", () => {
    expect(runtime.parseParameter("node=hk-01; CARRIER=电信\nrows = 4")).toEqual({
      NODE: "hk-01",
      CARRIER: "电信",
      ROWS: "4",
    });
  });

  it("不按逗号切，NODES 原样保留", () => {
    expect(runtime.parseParameter("NODES=hk-01,jp-tokyo,us-la")).toEqual({
      NODES: "hk-01,jp-tokyo,us-la",
    });
  });

  it("不带等号的一段：网址当 API_BASE，其余当 NODE", () => {
    expect(runtime.parseParameter("https://status.example.com; hk-01")).toEqual({
      API_BASE: "https://status.example.com",
      NODE: "hk-01",
    });
  });

  it("全角分号、全角等号和中文引号都认", () => {
    expect(runtime.parseParameter("NODE＝“hk-01”；TITLE='我的机器'")).toEqual({
      NODE: "hk-01",
      TITLE: "我的机器",
    });
  });

  it("空参数给空对象", () => {
    expect(runtime.parseParameter(null)).toEqual({});
    expect(runtime.parseParameter("  ")).toEqual({});
  });

  it("Parameter 覆盖 CONFIG，但空值不会把 CONFIG 抹掉", () => {
    expect(
      runtime.mergeEnv({ API_BASE: API_BASE, node: "hk-01", ROWS: 4 }, "NODE=jp-tokyo; ROWS="),
    ).toEqual({ API_BASE, NODE: "jp-tokyo", ROWS: "4" });
  });

  it("Scriptable 的尺寸名换成 Egern 的", () => {
    expect(runtime.familyOf("small")).toBe("systemSmall");
    expect(runtime.familyOf("medium")).toBe("systemMedium");
    expect(runtime.familyOf("large")).toBe("systemLarge");
    expect(runtime.familyOf("accessoryRectangular")).toBe("accessoryRectangular");
    expect(runtime.familyOf(null)).toBe("systemMedium");
  });
});

describe("颜色换算", () => {
  it("hex 与 rgba 都转成 { hex, alpha }", () => {
    expect(runtime.parseColor("#22272E")).toEqual({ hex: "#22272e", alpha: 1 });
    expect(runtime.parseColor("#ff000080").alpha).toBeCloseTo(128 / 255);
    expect(runtime.parseColor("rgba(142, 144, 152, 0.26)")).toEqual({ hex: "#8e9098", alpha: 0.26 });
    expect(runtime.parseColor("rgb(0,0,0)")).toEqual({ hex: "#000000", alpha: 1 });
    expect(runtime.parseColor("hsl(0 0% 0%)")).toBe(null);
  });
});

describe("DSL → ListWidget", () => {
  const variants = [
    {},
    { LATENCY_STYLE: "chip" },
    { BACKGROUND: "glass" },
    { BACKGROUND: "solid" },
    { BACKGROUND: "clear" },
    { DEBUG: "1" },
    { NODE: "不存在的机器" },
    { NODES: "hk-01" },
  ];

  it("所有尺寸、所有状态翻译时都没有遗漏的元素或属性", async () => {
    const problems = [];
    for (const family of FAMILIES) {
      for (const env of variants) {
        const { unknown } = await build(family, env);
        problems.push(...unknown.map((u) => `${family} ${JSON.stringify(env)} ${u}`));
      }
      for (const response of [
        { status: 403, json: async () => ({}) },
        { status: 200, json: async () => ({ servers: [] }) },
      ]) {
        problems.push(...(await build(family, {}, response)).unknown);
      }
      problems.push(...(await build(family, { API_BASE: "" })).unknown);
    }
    expect(problems).toEqual([]);
  });

  it("widget 级属性：点按地址、刷新时间、边距、行距", async () => {
    const { widget, dsl } = await build("systemSmall", { NODE: "hk-01" });
    expect(widget.url).toBe(`${API_BASE}/#/server/hk-01`);
    expect(widget.refreshAfterDate).toEqual(new Date(dsl.refreshAfter));
    expect(widget.padding).toEqual([15, 15, 15, 15]);
    expect(widget.spacing).toBe(5);
  });

  it("进度条按占比换算成像素：42% 的 50pt 轨道 → 21 + 29", async () => {
    const { widget } = await build("systemSmall", { NODE: "hk-01" });
    const track = stackOfSize(widget, 50, 4);
    expect(track.cornerRadius).toBe(2);
    expect(track.items.map((piece) => piece.size.width)).toEqual([21, 29]);
    expect(track.items[0].backgroundColor.dynamic).toBe(true);
    expect(track.items[1].backgroundColor).toBeUndefined();
  });

  it("0% 时不画填充段，只剩轨道本色", async () => {
    const { widget } = await build("systemSmall", { NODE: "sg-01" });
    const track = stackOfSize(widget, 50, 4);
    expect(track.items.map((piece) => piece.size.width)).toEqual([50]);
  });

  it("flex 文本后面补弹性 spacer，把行尾的时间推到最右", async () => {
    const { widget } = await build("systemSmall", { NODE: "hk-01" });
    const header = stackOfSize(widget, 0, 17);
    expect(header.items.map((item) => item.kind)).toEqual(["text", "text", "text", "spacer", "date"]);
    expect(header.items[2].value).toBe("HK-01");
    expect(header.items[2].lineLimit).toBe(1);
    expect(header.items[2].minimumScaleFactor).toBe(0.6);
    expect(header.items[2].font).toEqual({ name: "semiboldSystemFont", size: 13 });
    expect(header.items[4].style).toBe("relative");
  });

  it("定宽单元里右对齐的数字：前面补 spacer，后面不补", async () => {
    const { widget } = await build("systemSmall", { NODE: "hk-01" });
    const cell = stackOfSize(widget, 30, 0);
    expect(cell.items.map((item) => item.kind)).toEqual(["spacer", "text"]);
    expect(cell.items[1].value).toBe("42%");
  });

  it("定宽单元里的数字放不下时缩字，不截成「6…」", async () => {
    // 真机截图：中尺寸 26pt 的内存百分比格子里，两位数被截成了「6…」「19…」
    const { widget } = await build("systemMedium");
    const cell = stackOfSize(widget, 26, 0);
    const value = cell.items.at(-1);
    expect(value.kind).toBe("text");
    expect(value.lineLimit).toBe(1);
    expect(value.minimumScaleFactor).toBe(0.5);
  });

  it("chip 样式的延迟：色块里居中，两边各一个 spacer", async () => {
    const { widget } = await build("systemSmall", { NODE: "hk-01", LATENCY_STYLE: "chip" });
    const chip = stackOfSize(widget, 50, 14);
    expect(chip.cornerRadius).toBe(4);
    expect(chip.items.map((item) => item.kind)).toEqual(["spacer", "text", "spacer"]);
    expect(chip.backgroundColor.light.alpha).toBe(0.3);
  });

  it("没写宽度的汇总方块：每行文字都带弹性 spacer，三块才会被平分宽度", async () => {
    const { widget } = await build("systemLarge");
    const tiles = stackOfSize(widget, 0, 38).items;
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      expect(tile.direction).toBe("column");
      expect(tile.cornerRadius).toBe(10);
      for (const line of tile.items) {
        expect(line.kind).toBe("stack");
        expect(line.items.at(-1).kind).toBe("spacer");
      }
    }
  });

  it("中尺寸的节点行数与 DSL 一致", async () => {
    const { widget } = await build("systemMedium");
    const rows = widget.items.filter(
      (item) => item.kind === "stack" && findItem(item, (k) => k.size?.height === 4),
    );
    expect(rows).toHaveLength(5);
  });

  it("自适应颜色走 Color.dynamic，浅深两档分别落到 light / dark", async () => {
    const { widget } = await build("systemSmall", { NODE: "hk-01" });
    const name = findItem(widget, (item) => item.value === "HK-01");
    expect(name.textColor.dynamic).toBe(true);
    expect(name.textColor.light).toBeInstanceOf(FakeColor);
    expect(name.textColor.light.hex).not.toBe(name.textColor.dark.hex);
  });

  it("玻璃底：渐变的颜色带透明度，方向从上到下", async () => {
    const { widget } = await build("systemMedium", { BACKGROUND: "glass" });
    const gradient = widget.backgroundGradient;
    expect(gradient).toBeInstanceOf(FakeLinearGradient);
    expect(gradient.colors.map((c) => c.light.alpha)).toEqual([0.26, 0.12]);
    expect(gradient.locations).toEqual([0, 1]);
    expect(gradient.endPoint).toEqual(new FakePoint(0, 1));
  });

  it("错误卡片：文字居中、上下各一个弹性 spacer", async () => {
    const { widget } = await build("systemMedium", {}, { status: 403, json: async () => ({}) });
    expect(widget.items[0].kind).toBe("spacer");
    expect(widget.items.at(-1).kind).toBe("spacer");
    expect(textsOf(widget)).toEqual(["站点已开启人机验证\n小组件不支持"]);
  });
});

describe("renderWidget：用 Scriptable 的 Request 取数", () => {
  const core = runtime.toModule(CORE_SOURCE);

  it("请求 /api/servers，超时按秒换算", async () => {
    const seen = [];
    const api = fakeApi((url, request) => {
      seen.push({ url, timeout: request.timeoutInterval, headers: request.headers });
      return { status: 200, body: JSON.stringify(buildSnapshot()) };
    });
    const widget = await runtime.renderWidget(core, { API_BASE }, "medium", api);
    expect(seen).toEqual([
      { url: `${API_BASE}/api/servers`, timeout: 10, headers: { Accept: "application/json" } },
    ]);
    expect(widget).toBeInstanceOf(FakeWidget);
    expect(textsOf(widget)).toContain("HK-01");
  });

  it("状态码照样交给核心脚本判断", async () => {
    const api = fakeApi(() => ({ status: 401, body: "" }));
    const widget = await runtime.renderWidget(core, { API_BASE }, "small", api);
    expect(textsOf(widget)[0]).toMatch(/站点未公开/);
  });

  it("网络失败显示「无法连接」", async () => {
    const api = fakeApi(() => {
      throw new Error("offline");
    });
    const widget = await runtime.renderWidget(core, { API_BASE }, "small", api);
    expect(textsOf(widget)[0]).toBe("无法连接\nstatus.example.com");
  });
});

describe("loader.js：粘进 Scriptable 的那一段", () => {
  const REPO = "https://raw.githubusercontent.com/volcano-1025/cfsm-egern-widget/main/";
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const GLOBAL_NAMES = [
    "FileManager",
    "Request",
    "ListWidget",
    "Color",
    "Font",
    "Size",
    "Point",
    "LinearGradient",
    "Alert",
    "Script",
    "config",
    "args",
  ];
  let saved;
  let state;

  /** 装上一套假的 Scriptable 全局对象。`repoDown` 为 true 时仓库下载全部失败。 */
  function install({ runsInWidget = true, family = "small", parameter, repoDown = false, files } = {}) {
    state.repoRequests = 0;
    state.widget = null;
    state.completed = false;
    const { local, fm } = fakeFileManager(files ?? state.files);
    state.files = fm.files;
    const handler = (url) => {
      if (url.startsWith(REPO)) {
        state.repoRequests += 1;
        if (repoDown) throw new Error("timed out");
        return { status: 200, body: read(`../${url.slice(REPO.length)}`) };
      }
      return { status: 200, body: JSON.stringify(buildSnapshot()) };
    };
    Object.assign(globalThis, {
      FileManager: { local },
      Request: fakeRequest(handler),
      ListWidget: FakeWidget,
      Color: FakeColor,
      Font: FakeFont,
      Size: FakeSize,
      Point: FakePoint,
      LinearGradient: FakeLinearGradient,
      Alert: class {
        addAction() {}
        addCancelAction() {}
        async presentSheet() {
          return 1; // 选「中」
        }
      },
      Script: {
        setWidget: (widget) => (state.widget = widget),
        complete: () => (state.completed = true),
      },
      config: { runsInWidget, runsInApp: !runsInWidget, widgetFamily: runsInWidget ? family : null },
      args: { widgetParameter: parameter ?? null },
    });
  }

  /** 真机上 Script.setWidget 不会被调用的那条路（App 里预览）把 present 出来的小组件记下来。 */
  async function runLoader() {
    const presented = [];
    const original = FakeWidget.prototype.presentMedium;
    FakeWidget.prototype.presentMedium = async function presentMedium() {
      presented.push(this);
    };
    try {
      await new AsyncFunction(LOADER_SOURCE)();
    } finally {
      FakeWidget.prototype.presentMedium = original;
    }
    return state.widget ?? presented[0] ?? null;
  }

  beforeEach(() => {
    saved = Object.fromEntries(GLOBAL_NAMES.map((name) => [name, globalThis[name]]));
    state = { files: new Map() };
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  });

  it("首次运行：下载两份代码、缓存下来，渲染出 Parameter 指定的那台", async () => {
    install({ parameter: `${API_BASE}; NODE=jp-tokyo` });
    const widget = await runLoader();
    expect(state.repoRequests).toBe(2);
    expect([...state.files.keys()].sort()).toEqual([
      "/docs/cfsm-widget/cfsm-status.js",
      "/docs/cfsm-widget/scriptable_runtime.js",
    ]);
    expect(textsOf(widget)).toContain("JP-Tokyo-BandwagonHost-KVM");
    expect(state.completed).toBe(true);
  });

  it("缓存一天内有效：再次刷新不再下载", async () => {
    install({ parameter: API_BASE });
    await runLoader();
    install({ parameter: API_BASE });
    await runLoader();
    expect(state.repoRequests).toBe(0);
  });

  it("在 App 里运行强制更新，并弹出尺寸选择来预览", async () => {
    install({ parameter: API_BASE });
    await runLoader();
    install({ runsInWidget: false });
    const widget = await runLoader();
    expect(state.repoRequests).toBe(2);
    // App 里没有 Parameter，CONFIG 里的 API_BASE 又是空的 —— 预览出的是「未配置」提示卡
    expect(textsOf(widget)[0]).toBe("未配置 API_BASE");
  });

  it("仓库连不上时用旧缓存顶着", async () => {
    install({ parameter: API_BASE });
    await runLoader();
    for (const entry of state.files.values()) entry.mtime = new Date(0); // 让缓存过期
    install({ family: "medium", parameter: API_BASE, repoDown: true });
    const widget = await runLoader();
    expect(state.repoRequests).toBe(2);
    expect(textsOf(widget)).toContain("在线 8/10");
  });

  it("从没下载成功过：小组件上直接写明原因", async () => {
    install({ repoDown: true });
    const widget = await runLoader();
    expect(textsOf(widget)[0]).toMatch(/^CFSM 小组件加载失败\n下载 .* 失败：timed out$/);
    expect(state.completed).toBe(true);
  });
});
