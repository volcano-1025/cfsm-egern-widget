import { describe, expect, it } from "vitest";
import {
  deriveStats,
  flagEmoji,
  formatBytes,
  formatLoss,
  formatRate,
  isOnline,
  latencyColor,
  lossColor,
  metricsOf,
  normalizeCarrier,
  pickList,
  pickOne,
  pingOf,
  readEnv,
  render,
} from "../cfsm-status.js";
import { NOW, SERVERS, buildSnapshot } from "./fixture.js";
import { collectNodeRows, collectText, countNodeRows, validateTree } from "./dsl-schema.js";

const API_BASE = "https://status.example.com";

function ctxWith({ family = "systemMedium", env = {}, response, throws = false } = {}) {
  return {
    widgetFamily: family,
    env: { API_BASE, ...env },
    http: {
      get: async () => {
        if (throws) throw new Error("ETIMEDOUT");
        return response ?? { status: 200, json: async () => buildSnapshot() };
      },
    },
  };
}

describe("formatBytes", () => {
  it("按 1024 进制取位，与主题 formatBytes 一致", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(10 * 1024)).toBe("10.0 KB");
    expect(formatBytes(100 * 1024)).toBe("100 KB");
    expect(formatBytes(1024 ** 4)).toBe("1.00 TB");
  });

  it("负数与非数字都归零，不会渲染出 NaN", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("0 B");
    expect(formatBytes("abc")).toBe("0 B");
  });

  it("速率只是加个后缀", () => {
    expect(formatRate(1024 * 1024)).toBe("1.00 MB/s");
  });
});

describe("latencyColor", () => {
  const step = (ms) => latencyColor(ms).dark;

  it("阈值落在 60 / 100 / 160 / 200 上（与主题 latencyHeatColor 同档）", () => {
    expect(step(60)).toBe(step(1));
    expect(step(61)).not.toBe(step(60));
    expect(step(100)).toBe(step(61));
    expect(step(101)).not.toBe(step(100));
    expect(step(160)).toBe(step(101));
    expect(step(161)).not.toBe(step(160));
    expect(step(200)).toBe(step(161));
    expect(step(201)).not.toBe(step(200));
  });

  it("没有值时用次要文字色，不给出健康度暗示", () => {
    expect(latencyColor(null).dark).toBe("#9198a1");
    expect(latencyColor(-1).dark).toBe("#9198a1");
  });

  it("色值与主题 tokens.css 的 --latency-* 逐一对上", () => {
    expect(latencyColor(50)).toEqual({ light: "#2fc66e", dark: "#2fc66e" });
    expect(latencyColor(80)).toEqual({ light: "#9fe339", dark: "#9fe339" });
    expect(latencyColor(140)).toEqual({ light: "#cbd83a", dark: "#cbd83a" });
    expect(latencyColor(180)).toEqual({ light: "#e2a928", dark: "#e2a928" });
    // 只有 critical 一档主题本身就分浅深色
    expect(latencyColor(300)).toEqual({ light: "#dc2626", dark: "#f47067" });
  });
});

describe("flagEmoji", () => {
  it("两位国家码转成区域指示符", () => {
    expect(flagEmoji("HK")).toBe("🇭🇰");
    expect(flagEmoji("jp")).toBe("🇯🇵");
  });

  it("拿不准的一律留空", () => {
    expect(flagEmoji("")).toBe("");
    expect(flagEmoji(null)).toBe("");
    expect(flagEmoji("CHN")).toBe("");
    expect(flagEmoji("1A")).toBe("");
  });
});

describe("isOnline", () => {
  it("有 is_online 布尔值时以它为准，哪怕上报时间很旧", () => {
    expect(isOnline({ is_online: true, last_updated: 0 }, NOW)).toBe(true);
    expect(isOnline({ is_online: false, last_updated: NOW }, NOW)).toBe(false);
  });

  it("没有该字段时看 5 分钟阈值", () => {
    expect(isOnline({ last_updated: NOW - 299_000 }, NOW)).toBe(true);
    expect(isOnline({ last_updated: NOW - 300_000 }, NOW)).toBe(false);
  });
});

describe("normalizeCarrier", () => {
  it("认中英文与常见别名", () => {
    expect(normalizeCarrier("ct")).toBe("ct");
    expect(normalizeCarrier("电信")).toBe("ct");
    expect(normalizeCarrier("Unicom")).toBe("cu");
    expect(normalizeCarrier("CMCC")).toBe("cm");
    expect(normalizeCarrier("bd")).toBe("bd");
  });

  it("空值与认不出来的写法都退回 auto", () => {
    expect(normalizeCarrier("")).toBe("auto");
    expect(normalizeCarrier(undefined)).toBe("auto");
    expect(normalizeCarrier("移动宽带")).toBe("auto");
  });
});

describe("pingOf", () => {
  const hk = SERVERS.find((s) => s.id === "hk-01");

  it("auto 取三网里最小的一条，不看 BD", () => {
    // hk-01 的 bd 是 21，比电信的 38 更低，但不该被选中
    expect(pingOf(hk, "auto")).toMatchObject({ key: "ct", ms: 38, label: "电信" });
  });

  it("auto 会带出胜出线路自己的丢包，而不是别条的", () => {
    const server = {
      ping_ct: 200,
      loss_ct: 9,
      ping_cu: 50,
      loss_cu: 1,
      ping_cm: null,
      loss_cm: 40,
    };
    expect(pingOf(server, "auto")).toMatchObject({ key: "cu", ms: 50, loss: 1 });
  });

  it("指定线路就认那一条，没有值也不回退到别条", () => {
    // hk-01 三网都有值，点名移动就得是 74
    expect(pingOf(hk, "cm").ms).toBe(74);
    // jp-tokyo 只有电信有值，点名联通只能是空
    const jp = SERVERS.find((s) => s.id === "jp-tokyo");
    expect(pingOf(jp, "cu")).toMatchObject({ key: "cu", ms: null, loss: null });
    expect(pingOf(jp, "ct")).toMatchObject({ ms: 61, loss: 2 });
  });

  it("负延迟按探测失败处理", () => {
    expect(pingOf({ ping_ct: -1, ping_cu: 50 }, "auto").ms).toBe(50);
    expect(pingOf({ ping_ct: -1 }, "ct").ms).toBe(null);
  });

  it("全丢包时延迟为空但丢包要显示出来", () => {
    const dead = { ping_ct: null, loss_ct: 100, ping_cu: null, ping_cm: null };
    expect(pingOf(dead, "auto")).toMatchObject({ key: "ct", ms: null, loss: 100 });
  });

  it("什么都没有时给一组空值，不会抛", () => {
    expect(pingOf({}, "auto")).toMatchObject({ ms: null, loss: null });
    expect(pingOf(undefined, "ct")).toMatchObject({ ms: null, loss: null });
  });
});

describe("丢包展示", () => {
  it("不足 1% 保留一位小数，免得把偶发丢包抹成 0", () => {
    expect(formatLoss(0)).toBe("0%");
    expect(formatLoss(0.4)).toBe("0.4%");
    expect(formatLoss(1.5)).toBe("2%");
    expect(formatLoss(16.7)).toBe("17%");
    expect(formatLoss(null)).toBe("—");
  });

  it("逐值复刻主题的连续热力渐变 heatRamp(pct, [1,3,5,10], 20)", () => {
    // hsl(145 62% 48%) —— 主题 LOSS_RAMP 第一段的起点，0% 是绿色而不是灰色
    expect(lossColor(0)).toBe("#2fc66e");
    expect(lossColor(1)).toBe("#2bda3f");
    expect(lossColor(3)).toBe("#a4e228");
    expect(lossColor(5)).toBe("#e9c925");
    expect(lossColor(10)).toBe("#ee851b");
    // 末段跨度 20，30% 以上封顶
    expect(lossColor(30)).toBe("#ce2512");
    expect(lossColor(100)).toBe("#ce2512");
  });

  it("只有「没有样本」才回退中性色", () => {
    expect(lossColor(null).dark).toBe("#9198a1");
    expect(lossColor(-1).dark).toBe("#9198a1");
  });
});

describe("metricsOf", () => {
  it("按 MiB 口径算百分比", () => {
    const m = metricsOf(SERVERS.find((s) => s.id === "hk-01"), NOW);
    expect(m.cpuPct).toBeCloseTo(42.4);
    expect(Math.round(m.ramPct)).toBe(31);
    expect(Math.round(m.diskPct)).toBe(55);
  });

  it("总量为 0 时百分比给 0 而不是 NaN", () => {
    const m = metricsOf({ ram_total: 0, ram_used: 0, disk_total: 0, disk_used: 0 }, NOW);
    expect(m.ramPct).toBe(0);
    expect(m.diskPct).toBe(0);
  });
});

describe("pickOne", () => {
  it("id 全等优先", () => {
    expect(pickOne(SERVERS, "hk-01").name).toBe("HK-01");
  });

  it("其次名称全等（忽略大小写）", () => {
    expect(pickOne(SERVERS, "us-la").id).toBe("us-la");
    expect(pickOne(SERVERS, "SG-01").id).toBe("sg-01");
  });

  it("最后才退到名称包含", () => {
    expect(pickOne(SERVERS, "Tokyo").id).toBe("jp-tokyo");
  });

  it("空 token 与匹配不到都返回 null", () => {
    expect(pickOne(SERVERS, "")).toBe(null);
    expect(pickOne(SERVERS, "不存在")).toBe(null);
  });
});

describe("pickList", () => {
  it("默认剔除隐藏节点", () => {
    const list = pickList(SERVERS, { limit: 99, now: NOW });
    expect(list.map((s) => s.id)).not.toContain("hidden-01");
  });

  it("默认跟随后台的 sort_order", () => {
    const list = pickList(SERVERS, { limit: 4, now: NOW });
    expect(list.map((s) => s.id)).toEqual(["hk-01", "jp-tokyo", "us-la", "sg-01"]);
  });

  it("sort_order 全相同时保持后端下发的顺序", () => {
    const flat = SERVERS.slice(0, 3).map((s) => ({ ...s, sort_order: 0 }));
    expect(pickList(flat, { limit: 9, now: NOW }).map((s) => s.id)).toEqual([
      "hk-01",
      "jp-tokyo",
      "us-la",
    ]);
  });

  it("sort=health 时离线优先，其次 CPU 降序", () => {
    const list = pickList(SERVERS, { limit: 4, now: NOW, sort: "health" });
    expect(list.map((s) => s.id)).toEqual(["de-fra", "ru-mow", "us-la", "kr-icn"]);
  });

  it("GROUP 过滤只保留该分组", () => {
    const list = pickList(SERVERS, { group: "欧洲", limit: 99, now: NOW });
    expect(list.map((s) => s.id).sort()).toEqual(["de-fra", "ru-mow", "uk-lon"]);
  });

  it("NODES 按给定顺序取，未命中的 token 静默跳过", () => {
    const list = pickList(SERVERS, {
      nodes: "sg-01, 不存在的机器 ,hk-01,Tokyo",
      limit: 99,
      now: NOW,
    });
    expect(list.map((s) => s.id)).toEqual(["sg-01", "hk-01", "jp-tokyo"]);
  });

  it("NODES 里重复指定同一台只算一次", () => {
    const list = pickList(SERVERS, { nodes: "hk-01,HK-01", limit: 99, now: NOW });
    expect(list).toHaveLength(1);
  });

  it("NODES 也受 limit 约束", () => {
    const list = pickList(SERVERS, { nodes: "hk-01,us-la,sg-01", limit: 2, now: NOW });
    expect(list).toHaveLength(2);
  });

  it("隐藏节点即使被 NODES 点名也不出现", () => {
    expect(pickList(SERVERS, { nodes: "hidden-01", limit: 9, now: NOW })).toEqual([]);
  });
});

describe("deriveStats", () => {
  it("后端给了就原样用", () => {
    const stats = deriveStats(SERVERS, { total: 42, online: 40, offline: 2 }, NOW);
    expect(stats.total).toBe(42);
    expect(stats.online).toBe(40);
  });

  it("后端没给（旧版 Workers）就按同样口径自己算，且不数隐藏节点", () => {
    const stats = deriveStats(SERVERS, {}, NOW);
    expect(stats.total).toBe(9); // 10 台里有 1 台隐藏
    expect(stats.offline).toBe(2); // de-fra 明确离线，ru-mow 超过 5 分钟没上报
    expect(stats.online).toBe(7);
    expect(stats.globalSpeedIn).toBeGreaterThan(0);
  });

  it("只缺其中几个字段时只补缺的那几个", () => {
    const stats = deriveStats(SERVERS, { total: 99 }, NOW);
    expect(stats.total).toBe(99);
    expect(stats.online).toBe(7);
  });
});

describe("readEnv", () => {
  it("给出默认值并抹掉 API_BASE 结尾的斜杠", () => {
    const env = readEnv({ env: { API_BASE: "https://a.com///" } });
    expect(env.apiBase).toBe("https://a.com");
    expect(env.title).toBe("服务器状态");
    expect(env.rows).toBe(null);
    expect(env.carrier).toBe("auto");
    expect(env.refreshMinutes).toBe(1);
  });

  it("非法的 ROWS / REFRESH 退回默认，不会算出 NaN 时间", () => {
    const env = readEnv({ env: { ROWS: "abc", REFRESH: "-3" } });
    expect(env.rows).toBe(null);
    expect(env.refreshMinutes).toBe(1);
  });

  it("CARRIER 归一到线路 key", () => {
    expect(readEnv({ env: { CARRIER: "电信" } }).carrier).toBe("ct");
  });

  it("SORT 默认跟随后台，只认 health 一个反向值", () => {
    expect(readEnv({ env: {} }).sort).toBe("order");
    expect(readEnv({ env: { SORT: "health" } }).sort).toBe("health");
    expect(readEnv({ env: { SORT: "乱写" } }).sort).toBe("order");
  });

  it("BACKGROUND 默认毛玻璃", () => {
    expect(readEnv({ env: {} }).background).toBe("glass");
    expect(readEnv({ env: { BACKGROUND: "system" } }).background).toBe("system");
    expect(readEnv({ env: { BACKGROUND: "solid" } }).background).toBe("solid");
    expect(readEnv({ env: { BACKGROUND: "乱写" } }).background).toBe("glass");
  });

  it("没有 env 也不炸", () => {
    expect(readEnv({}).apiBase).toBe("");
    expect(readEnv(undefined).apiBase).toBe("");
  });
});

describe("三个尺寸产出的 DSL", () => {
  for (const family of ["systemSmall", "systemMedium", "systemLarge"]) {
    it(`${family} 只用文档里存在的元素与属性`, async () => {
      const tree = await render(ctxWith({ family, env: { NODE: "hk-01" } }), NOW);
      expect(validateTree(tree)).toEqual([]);
      expect(tree.type).toBe("widget");
    });
  }

  it("小尺寸渲染指定的那台机器，并深链到它的详情页", async () => {
    const tree = await render(ctxWith({ family: "systemSmall", env: { NODE: "Tokyo" } }), NOW);
    expect(collectText(tree)).toContain("JP-Tokyo-BandwagonHost-KVM");
    expect(tree.url).toBe(`${API_BASE}/#/server/jp-tokyo`);
  });

  it("小尺寸没指定 NODE 时取排序里的第一台，与列表口径一致", async () => {
    const byOrder = await render(ctxWith({ family: "systemSmall" }), NOW);
    expect(collectText(byOrder)).toContain("HK-01");

    const byHealth = await render(
      ctxWith({ family: "systemSmall", env: { SORT: "health" } }),
      NOW,
    );
    expect(collectText(byHealth)).toContain("DE-FRA");
  });

  it("中尺寸默认 5 行，大尺寸默认 9 行", async () => {
    const medium = await render(ctxWith({ family: "systemMedium" }), NOW);
    const large = await render(ctxWith({ family: "systemLarge" }), NOW);
    expect(countNodeRows(medium)).toBe(5);
    expect(countNodeRows(large)).toBe(9);
  });

  it("ROWS 能覆盖行数", async () => {
    const tree = await render(ctxWith({ family: "systemMedium", env: { ROWS: "2" } }), NOW);
    expect(countNodeRows(tree)).toBe(2);
  });

  it("大尺寸列出离线机器名单", async () => {
    const tree = await render(ctxWith({ family: "systemLarge" }), NOW);
    expect(collectText(tree)).toContain("离线：DE-FRA、RU-MOW");
  });

  it("全在线时大尺寸底部显示「全部在线」", async () => {
    const online = SERVERS.filter((s) => s.is_online === true);
    const tree = await render(
      ctxWith({
        family: "systemLarge",
        response: { status: 200, json: async () => buildSnapshot(online) },
      }),
      NOW,
    );
    expect(collectText(tree)).toContain("全部在线");
  });

  it("锁屏等未知尺寸退回单节点视图而不是空白", async () => {
    const tree = await render(ctxWith({ family: "accessoryRectangular" }), NOW);
    expect(validateTree(tree)).toEqual([]);
    expect(countNodeRows(tree)).toBe(0);
    expect(collectText(tree)).toContain("CPU");
  });

  it("节点行一律定高，Mac / iPad 上多出来的竖直空间才不会摊到行间距里", async () => {
    for (const family of ["systemMedium", "systemLarge"]) {
      const tree = await render(ctxWith({ family }), NOW);
      const rows = collectNodeRows(tree);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.height).toBeGreaterThan(0);
    }
  });

  it("节点少时把行拉高填空档，排满时回到最小行高", async () => {
    const heights = async (family, ids) =>
      collectNodeRows(
        await render(ctxWith({ family, env: ids ? { NODES: ids } : {} }), NOW),
      ).map((r) => r.height);

    // 排满：中 5 行 / 大 9 行，都用最小行高
    expect(await heights("systemMedium")).toEqual([16, 16, 16, 16, 16]);
    expect(await heights("systemLarge")).toEqual(Array(9).fill(16));

    // 只有 4 台：行被拉高，但不会无上限地摊满
    const mediumFew = await heights("systemMedium", "hk-01,us-la,sg-01,kr-icn");
    const largeFew = await heights("systemLarge", "hk-01,us-la,sg-01,kr-icn");
    expect(mediumFew).toEqual([21, 21, 21, 21]);
    expect(largeFew).toEqual([28, 28, 28, 28]);
  });

  it("大尺寸的汇总方块那一行必须定高，否则它会吃掉整块的竖直空档", async () => {
    const tree = await render(ctxWith({ family: "systemLarge" }), NOW);
    const tileRow = tree.children.find((child) =>
      (child.children ?? []).some((c) => c.type === "stack" && c.borderRadius === 10),
    );
    expect(tileRow).toBeDefined();
    expect(tileRow.height).toBeGreaterThan(0);
  });

  it("大尺寸汇总方块只留数字，不带说明小字", async () => {
    const texts = collectText(await render(ctxWith({ family: "systemLarge" }), NOW));
    expect(texts).toContain("8/10");
    expect(texts).not.toContain("在线 / 总数");
    expect(texts).not.toContain("实时");
    expect(texts).not.toContain("累计");
  });

  it("BACKGROUND 决定根节点铺什么背景", async () => {
    for (const family of ["systemSmall", "systemMedium", "systemLarge"]) {
      const glass = await render(ctxWith({ family, env: { NODE: "hk-01" } }), NOW);
      expect(validateTree(glass)).toEqual([]);
      expect(glass.backgroundGradient?.type).toBe("linear");
      expect(glass.backgroundColor).toBeUndefined();

      const system = await render(
        ctxWith({ family, env: { NODE: "hk-01", BACKGROUND: "system" } }),
        NOW,
      );
      expect(system.backgroundGradient).toBeUndefined();
      expect(system.backgroundColor).toBeUndefined();

      const solid = await render(
        ctxWith({ family, env: { NODE: "hk-01", BACKGROUND: "solid" } }),
        NOW,
      );
      expect(validateTree(solid)).toEqual([]);
      expect(solid.backgroundColor).toEqual({ light: "#ffffff", dark: "#22272e" });
    }
  });

  it("错误态也铺同一套背景", async () => {
    const tree = await render(ctxWith({ throws: true, env: { BACKGROUND: "solid" } }), NOW);
    expect(tree.backgroundColor).toEqual({ light: "#ffffff", dark: "#22272e" });
  });

  it("进度条轨道一律定宽", async () => {
    // 真机上小尺寸曾整片空白、只剩一个旗帜，唯一不与中/大尺寸共享的结构就是
    // 「只有 flex、没有 width 的轨道」。三个尺寸都不许再出现这种轨道。
    for (const family of ["systemSmall", "systemMedium", "systemLarge"]) {
      const tree = await render(ctxWith({ family, env: { NODE: "hk-01" } }), NOW);
      const tracks = [];
      const walk = (n) => {
        if (!n || typeof n !== "object") return;
        const kids = n.children ?? [];
        // 轨道的判据：圆角容器，两个子元素都是按占比分配的 stack（填充段 + 剩余段）
        const isTrack =
          n.type === "stack" &&
          n.borderRadius != null &&
          kids.length === 2 &&
          kids.every((k) => k.type === "stack" && typeof k.flex === "number");
        if (isTrack) tracks.push(n);
        kids.forEach(walk);
      };
      walk(tree);
      expect(tracks.length).toBeGreaterThan(0);
      for (const track of tracks) expect(typeof track.width).toBe("number");
    }
  });

  it("每行都带延迟与丢包两列", async () => {
    const tree = await render(ctxWith({ family: "systemMedium", env: { NODES: "us-la" } }), NOW);
    const texts = collectText(tree);
    // us-la 电信 152ms / 丢包 1.5%
    expect(texts).toContain("152");
    expect(texts).toContain("2%");
  });

  it("CARRIER 决定延迟列取哪条线路", async () => {
    const auto = collectText(
      await render(ctxWith({ family: "systemMedium", env: { NODES: "hk-01" } }), NOW),
    );
    const mobile = collectText(
      await render(
        ctxWith({ family: "systemMedium", env: { NODES: "hk-01", CARRIER: "移动" } }),
        NOW,
      ),
    );
    expect(auto).toContain("38"); // 三网最优是电信
    expect(mobile).toContain("74"); // 点名移动
    expect(mobile).not.toContain("38");
  });

  it("小尺寸标出延迟来自哪条线路", async () => {
    const tree = await render(
      ctxWith({ family: "systemSmall", env: { NODE: "hk-01", CARRIER: "cu" } }),
      NOW,
    );
    const texts = collectText(tree);
    expect(texts).toContain("联通");
    expect(texts).toContain("52 ms");
  });

  it("大尺寸图例说明延迟列的线路", async () => {
    const auto = collectText(await render(ctxWith({ family: "systemLarge" }), NOW));
    const ct = collectText(
      await render(ctxWith({ family: "systemLarge", env: { CARRIER: "ct" } }), NOW),
    );
    expect(auto).toContain("｜最优");
    expect(ct).toContain("｜电信");
  });

  it("DEBUG=1 产出只有 widget + 一个 text 的最小树", async () => {
    const tree = await render(ctxWith({ family: "systemSmall", env: { DEBUG: "1" } }), NOW);
    expect(validateTree(tree)).toEqual([]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe("text");
    expect(tree.children[0].text).toContain("family: systemSmall");
    expect(tree.children[0].text).toContain("nodes: 10");
  });

  it("refreshAfter 按 REFRESH 分钟往后推", async () => {
    const tree = await render(ctxWith({ family: "systemSmall", env: { REFRESH: "12" } }), NOW);
    expect(tree.refreshAfter).toBe(new Date(NOW + 12 * 60_000).toISOString());
  });
});

describe("错误态", () => {
  const cases = [
    ["未配置 API_BASE", { widgetFamily: "systemMedium", env: {}, http: { get: async () => ({}) } }, "未配置 API_BASE"],
    ["403 人机验证", ctxWith({ response: { status: 403, json: async () => ({}) } }), "站点已开启人机验证\n小组件不支持"],
    ["401 未公开", ctxWith({ response: { status: 401, json: async () => ({}) } }), "站点未公开\n需要登录才能查看"],
    ["500", ctxWith({ response: { status: 500, json: async () => ({}) } }), "请求失败 500"],
    ["连不上", ctxWith({ throws: true }), "无法连接\nstatus.example.com"],
    [
      "空列表",
      ctxWith({ response: { status: 200, json: async () => ({ servers: [] }) } }),
      "没有节点",
    ],
    [
      "不是 JSON",
      ctxWith({
        response: {
          status: 200,
          json: async () => {
            throw new Error("bad json");
          },
        },
      }),
      "返回的不是 JSON\n请检查 API_BASE",
    ],
  ];

  for (const [name, ctx, expected] of cases) {
    it(`${name} → 渲染一棵合法的提示树`, async () => {
      const tree = await render(ctx, NOW);
      expect(validateTree(tree)).toEqual([]);
      expect(collectText(tree)).toContain(expected);
    });
  }

  it("NODE 匹配不到时点名说是哪个", async () => {
    const tree = await render(
      ctxWith({ family: "systemSmall", env: { NODE: "不存在的机器" } }),
      NOW,
    );
    expect(validateTree(tree)).toEqual([]);
    expect(collectText(tree)).toContain("未找到节点\n不存在的机器");
  });

  it("错误态也带 refreshAfter，不然小组件不会再自己醒过来", async () => {
    const tree = await render(ctxWith({ throws: true }), NOW);
    expect(tree.refreshAfter).toBe(new Date(NOW + 60_000).toISOString());
  });
});

describe("只请求 /api/servers", () => {
  it("整个渲染过程只发一次请求，且打在 /api/servers 上", async () => {
    const calls = [];
    const ctx = {
      widgetFamily: "systemLarge",
      env: { API_BASE },
      http: {
        get: async (url) => {
          calls.push(url);
          return { status: 200, json: async () => buildSnapshot() };
        },
      },
    };
    await render(ctx, NOW);
    expect(calls).toEqual([`${API_BASE}/api/servers`]);
  });
});
