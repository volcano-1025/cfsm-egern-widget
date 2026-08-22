/**
 * CF-Server-Monitor 探针面板的 Egern iOS 主屏小组件。
 *
 * 适配 systemSmall / systemMedium / systemLarge 三个主屏尺寸：
 *   小 —— 单台机器的 CPU / 内存 / 磁盘 / 延迟丢包 / 实时网速
 *   中 —— 全站汇总条 + 若干节点行（CPU、内存、延迟、丢包）
 *   大 —— 标题 + 三块汇总 + 更长的节点列表（多一列磁盘）+ 离线名单
 *
 * 延迟看哪条线路由 CARRIER 环境变量决定（电信/联通/移动/BD），默认 auto 取三网最优。
 * 丢包默认显示**最近一小时的均值**（LOSS_WINDOW=now 可换回瞬时值），数据来自同一个响应里的
 * `loss[]` 窗口 —— 见下面的 WINDOW_MS。
 *
 * 只发一个请求：`GET {API_BASE}/api/servers`，它一次带回 stats 汇总与每台机器的全部指标，
 * 连最近一小时的探测窗口都在里面。绝不碰 `/api/history/all` —— 逐节点查历史会让后端 D1
 * 读行翻几十倍，面板主题同样禁止在概览场景使用它。
 *
 * 必须保持单文件、无依赖：Egern 通过 script_url 远程加载本文件，没有打包步骤。
 * 文件末尾的具名导出只给单元测试用，Egern 只取 default。
 *
 * 与 CFSM-Theme-LuminaPlus 主题保持一致的口径（主题改了这几处要跟着改）：
 *   - 在线判定：`is_online` 是布尔值时以它为准，否则 now - last_updated < 5 分钟
 *     （主题 src/services/cfsm/mappers.ts 的 isServerOnline / ONLINE_THRESHOLD_MS）
 *   - 延迟配色阶梯 60/100/160/200 ms（主题 src/utils/metricTone.ts 的 latencyHeatColor）
 *   - 字节格式化：1024 进制，≥100 取整、≥10 一位、其余两位小数
 *     （主题 src/utils/format.ts 的 formatBytes）
 *   - 丢包窗口：复印段的判定与丢弃规则抄自主题 src/services/pingLiveStore.ts 的
 *     dropBackfilledRuns（连续 4 格逐字节相同即整段丢掉）
 *   - 配色取自主题 src/styles/tokens.css 的 light / dark 两套 token
 *   - 单位：ram_* / disk_* 是 MiB，速率与累计量是字节，last_updated 是毫秒
 */

/** 超过这个时长没上报就算离线，与后端和主题一致。 */
const ONLINE_THRESHOLD_MS = 300_000;

/**
 * 配色。每项都是 Egern 的自适应 Color，跟随系统浅色/深色，
 * 值逐一抄自主题 tokens.css（:root 与 :root[data-appearance="dark"]）。
 */
const COLORS = {
  text: { light: "#18181b", dark: "#d1d7e0" }, // --text-primary
  textSub: { light: "#52525b", dark: "#b7bdc8" }, // --text-secondary
  textDim: { light: "#71717a", dark: "#9198a1" }, // --text-tertiary
  track: { light: "#e4e4e7", dark: "#343b45" }, // --progress-bg
  cpu: { light: "#3b82f6", dark: "#539bf5" }, // --progress-cpu
  mem: { light: "#8b5cf6", dark: "#b083f0" }, // --progress-memory
  disk: { light: "#e97b35", dark: "#e0823d" }, // --progress-disk
  online: { light: "#2f9e65", dark: "#57ab5a" }, // --status-online
  offline: { light: "#dc2626", dark: "#f47067" }, // --status-offline
  up: { light: "#3b82f6", dark: "#539bf5" }, // --traffic-up
  down: { light: "#2f9e65", dark: "#57ab5a" }, // --traffic-down
  hairline: { light: "rgba(24, 24, 27, 0.10)", dark: "rgba(101, 108, 118, 0.30)" },
  fill: { light: "rgba(24, 24, 27, 0.05)", dark: "rgba(101, 108, 118, 0.12)" }, // --fill-tertiary
};

/**
 * 延迟阶梯配色。档位与阈值抄自主题 metricTone.ts 的 latencyHeatColor。
 *
 * **深色逐值等于主题 tokens.css 的 --latency-*；浅色同色相压深一档。**
 * 主题那几档（#9fe339 / #cbd83a）是画在深色卡片和色带上的黄绿，直接当文字色摆在浅色
 * 小组件上根本读不出来。注意这不是自作主张：主题自己的 --latency-critical 就是浅深两套值
 * （浅 #dc2626 / 深 #f47067），这里只是把同一个做法延伸到另外几档。
 */
const LATENCY_COLORS = {
  excellent: { light: "#15803d", dark: "#2fc66e" },
  good: { light: "#4d7c0f", dark: "#9fe339" },
  moderate: { light: "#a16207", dark: "#cbd83a" },
  elevated: { light: "#b45309", dark: "#e2a928" },
  critical: { light: "#dc2626", dark: "#f47067" },
};

/**
 * 丢包配色。主题用的是连续 HSL 热力渐变而不是离散色阶（src/utils/metricTone.ts 的
 * lossHeatColor → heatRamp(pct, [1,3,5,10], 20)），这里把那五段曲线与分段边界原样搬过来，
 * 逐值一致。曲线本身不分浅深色，明度 48–62% 在白底和深底上都读得出来。
 *
 * 注意 0% 在主题里是绿色而不是灰色 —— 只有「没有样本」才回退中性色。
 */
const LOSS_RAMP = [
  (t) => [145 - 18 * t, 62 + 8 * t, 48 + 3 * t],
  (t) => [127 - 47 * t, 70 + 6 * t, 51 + 1 * t],
  (t) => [80 - 30 * t, 76 + 6 * t, 52 + 1 * t],
  (t) => [50 - 20 * t, 82 + 4 * t, 53 - 1 * t],
  (t) => [30 - 24 * t, 86 - 2 * t, 52 - 8 * t],
];
const LOSS_BOUNDS = [1, 3, 5, 10];
const LOSS_TAIL_SPAN = 20;

/**
 * 后端固定的四条探测线路，与主题 mappers.ts 的 CARRIER_TASKS 一一对应。
 * 探测目标和方式是后台配的，公开接口不下发，所以这里只能按线路名区分。
 */
const CARRIERS = {
  ct: { label: "电信", ping: "ping_ct", loss: "loss_ct" },
  cu: { label: "联通", ping: "ping_cu", loss: "loss_cu" },
  cm: { label: "移动", ping: "ping_cm", loss: "loss_cm" },
  bd: { label: "BD", ping: "ping_bd", loss: "loss_bd" },
};

/** auto 模式只在三网里选最优，不含 BD —— 与主题首页卡片的口径一致。 */
const AUTO_CARRIERS = ["ct", "cu", "cm"];

/** 四条线路的 key，顺序与窗口点里的字段名一致。 */
const CARRIER_KEYS = ["ct", "cu", "cm", "bd"];

/**
 * `/api/servers` 从 Workers 2.8.3 Beta2 起还会下发最近一小时的探测窗口：
 * `ping[]` 与 `loss[]` 各 30 格、每 2 分钟一个，格式是 `{ ts, ct, cu, cm, bd }`。
 * 它和实时值在同一个响应里，用它算一小时丢包**不增加任何请求**。
 *
 * 旧版后端没有这两个字段，这时只能回落到 `loss_*` 那个瞬时值。
 */
const WINDOW_MS = 60 * 60 * 1000;

/**
 * 连续这么多格逐字节相同就整段丢掉（主题 pingLiveStore 的 BACKFILL_RUN_MIN_LENGTH）。
 *
 * 后端不是「没数据就留空」，而是保证凑够 30 格：缺的格子取最近邻复制过来（没有距离上限）。
 * 于是一台刚加进来 7 分钟的机器，窗口里也有一整个小时的「数据」。复印件的特征是四条线路的
 * 延迟和丢包同时逐字节相同 —— 真探测做不到 —— 所以整段丢掉，不让它把一小时均值带偏。
 */
const BACKFILL_RUN_MIN = 4;

/** CARRIER 环境变量的容错写法，中英文都收。 */
const CARRIER_ALIASES = {
  auto: "auto",
  best: "auto",
  最优: "auto",
  自动: "auto",
  ct: "ct",
  telecom: "ct",
  chinatelecom: "ct",
  电信: "ct",
  cu: "cu",
  unicom: "cu",
  chinaunicom: "cu",
  联通: "cu",
  cm: "cm",
  mobile: "cm",
  cmcc: "cm",
  chinamobile: "cm",
  移动: "cm",
  bd: "bd",
  baidu: "bd",
  百度: "bd",
};

/**
 * 灰玻璃底色。
 *
 * **做不出原生小组件那种真透明**：真机验证过，Egern 自己铺了一层不透明的容器底，
 * 我们给的颜色只能压在它上面 —— 连 `clear`（全透明）出来也还是一块浅灰，透不出壁纸。
 * 所以这一档不是「毛玻璃」，只是一层上深下浅的灰色渐变，权当换个质感，默认不启用。
 */
const GLASS_GRADIENT = {
  type: "linear",
  startPoint: { x: 0, y: 0 },
  endPoint: { x: 0, y: 1 },
  colors: [
    { light: "rgba(142, 144, 152, 0.26)", dark: "rgba(118, 130, 146, 0.26)" },
    { light: "rgba(142, 144, 152, 0.12)", dark: "rgba(118, 130, 146, 0.12)" },
  ],
};

/** 不透明背景，取主题 tokens.css 的 --surface。 */
const SOLID_BACKGROUND = { light: "#ffffff", dark: "#22272e" };

/**
 * 全透明。真机上与 `system` 看不出区别 —— Egern 的容器底是不透明的，这一档透不出壁纸。
 * 留着是为了记住这个结论，以后 Egern 若支持了容器透明，这里就是现成的开关。
 */
const CLEAR_BACKGROUND = "rgba(0, 0, 0, 0)";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

// ---------------------------------------------------------------- 纯函数

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 1024 进制，与主题 formatBytes 同一套取位规则。 */
export function formatBytes(n) {
  const value = toNumber(n);
  if (value <= 0) return "0 B";
  let idx = 0;
  let v = value;
  while (v >= 1024 && idx < BYTE_UNITS.length - 1) {
    v /= 1024;
    idx += 1;
  }
  if (idx === 0) return `${Math.round(v)} ${BYTE_UNITS[idx]}`;
  const dec = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(dec)} ${BYTE_UNITS[idx]}`;
}

export function formatRate(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}

/** 国家码 → emoji 旗帜。拿不准的一律返回空串，让调用方自然留白。 */
export function flagEmoji(region) {
  const code = String(region ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}

export function latencyColor(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return COLORS.textDim;
  if (ms <= 60) return LATENCY_COLORS.excellent;
  if (ms <= 100) return LATENCY_COLORS.good;
  if (ms <= 160) return LATENCY_COLORS.moderate;
  if (ms <= 200) return LATENCY_COLORS.elevated;
  return LATENCY_COLORS.critical;
}

/** 主题的 toHsl() 产出 `hsl(...)` 字符串，但 Egern 的 Color 只认 hex / rgba，这里补上换算。 */
function hslToHex(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function lossColor(pct) {
  if (pct == null || !Number.isFinite(pct) || pct < 0) return COLORS.textDim;
  const [b0, b1, b2, b3] = LOSS_BOUNDS;
  let index = 4;
  let t = (pct - b3) / LOSS_TAIL_SPAN;
  if (pct <= b0) {
    index = 0;
    t = pct / b0;
  } else if (pct <= b1) {
    index = 1;
    t = (pct - b0) / (b1 - b0);
  } else if (pct <= b2) {
    index = 2;
    t = (pct - b1) / (b2 - b1);
  } else if (pct <= b3) {
    index = 3;
    t = (pct - b2) / (b3 - b2);
  }
  return hslToHex(...LOSS_RAMP[index](clamp(t, 0, 1)));
}

/**
 * 丢包率文案。不足 1% 保留一位小数 —— 后端的丢包是按窗口算的百分比，
 * 0.4% 直接四舍五入成 0% 会把「偶尔掉一个包」和「一个都没掉」混为一谈。
 */
export function formatLoss(pct) {
  if (pct == null || !Number.isFinite(pct)) return "—";
  if (pct <= 0) return "0%";
  if (pct < 1) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/**
 * LOSS_WINDOW 环境变量 → 丢包的口径。认不出来的一律当 hour。
 *
 * 默认 hour：瞬时值是最后一次探测的结果，一次抖动就把整行染红，看完刷新一次又没了；
 * 一小时均值更能说明「这台是不是真的在掉包」。想要原来那个瞬时值就填 now。
 */
export function normalizeLossWindow(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  return /^(now|instant|实时|瞬时|当前)$/.test(key) ? "now" : "hour";
}

/** SORT 环境变量 → 排序方式。认不出来的一律当 order（跟随后台）。 */
export function normalizeSort(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  return /^(health|负载|健康)$/.test(key) ? "health" : "order";
}

/** BACKGROUND 环境变量 → 背景样式。认不出来的一律当 system。 */
export function normalizeBackground(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (/^(glass|毛玻璃|玻璃)$/.test(key)) return "glass";
  if (/^(solid|不透明|纯色)$/.test(key)) return "solid";
  if (/^(clear|transparent|透明)$/.test(key)) return "clear";
  return "system";
}

/** LATENCY_STYLE 环境变量 → 延迟数值的画法。认不出来的一律当 text。 */
export function normalizeLatencyStyle(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  return /^(chip|色块|底色)$/.test(key) ? "chip" : "text";
}

/** CARRIER 环境变量 → 线路 key 或 "auto"。认不出来的一律当 auto。 */
export function normalizeCarrier(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return "auto";
  return CARRIER_ALIASES[key] ?? "auto";
}

export function isOnline(server, now = Date.now()) {
  if (typeof server?.is_online === "boolean") return server.is_online;
  return now - toNumber(server?.last_updated) < ONLINE_THRESHOLD_MS;
}

/** 窗口里的一个线路值。`false` 是「这台禁用了这条线路」，和缺值一样按 null 处理。 */
function pointValue(raw) {
  if (raw == null || typeof raw === "boolean") return null;
  const value = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/** 秒级时间戳补成毫秒（与主题 normalizeTimestamp 同一套判据）。 */
function pointTime(raw) {
  const value = pointValue(raw);
  if (value == null || value <= 0) return 0;
  return value < 10_000_000_000 ? value * 1000 : value;
}

/**
 * 把 `ping[]` / `loss[]` 两个数组按时间戳合成一串格子，按时间升序。
 *
 * 两个数组是分开下发的，靠 `ts` 对齐；复印段的判定要求延迟和丢包同时相同，
 * 所以必须合起来看，只比丢包会把「探测正常、丢包恒为 0」的真数据误判成复印件。
 */
function latencyWindow(server, now) {
  const lossPoints = Array.isArray(server?.loss) ? server.loss : [];
  if (!lossPoints.length) return [];

  const pingByTs = new Map();
  for (const point of Array.isArray(server?.ping) ? server.ping : []) {
    const time = pointTime(point?.ts);
    if (time > 0) pingByTs.set(time, point);
  }

  const slots = [];
  for (const point of lossPoints) {
    const time = pointTime(point?.ts);
    if (time <= 0 || now - time > WINDOW_MS) continue;
    const ping = pingByTs.get(time);
    slots.push({
      time,
      // 前四个是丢包、后四个是延迟，复印段判定按这八个值整体比对。
      loss: { ct: pointValue(point?.ct), cu: pointValue(point?.cu), cm: pointValue(point?.cm), bd: pointValue(point?.bd) },
      ping: { ct: pointValue(ping?.ct), cu: pointValue(ping?.cu), cm: pointValue(ping?.cm), bd: pointValue(ping?.bd) },
    });
  }
  return slots.sort((a, b) => a.time - b.time);
}

function sameSlot(a, b) {
  return CARRIER_KEYS.every((k) => a.loss[k] === b.loss[k] && a.ping[k] === b.ping[k]);
}

/**
 * 丢掉窗口里连续复印出来的那几段（见 {@link BACKFILL_RUN_MIN}）。
 *
 * 整段丢掉而不是留一格：复制源可能在这段的任意一端，留哪一格都是猜；真值那一格在
 * 相邻的非重复段里本来就还在。全被丢光就当这台没有窗口，回落到瞬时值。
 */
function dropBackfilled(slots) {
  if (slots.length < BACKFILL_RUN_MIN) return slots;
  const kept = [];
  let runStart = 0;
  for (let i = 1; i <= slots.length; i += 1) {
    if (i < slots.length && sameSlot(slots[i], slots[runStart])) continue;
    if (i - runStart < BACKFILL_RUN_MIN) kept.push(...slots.slice(runStart, i));
    runStart = i;
  }
  return kept;
}

/**
 * 一条线路最近一小时的平均丢包。没有可用格子返回 null（交给调用方回落到瞬时值）。
 *
 * 每格是一次探测采样（后端历史每行 `count` 恒为 1），所以直接对有值的格子取算术平均，
 * 等价于主题 `bucketPingLoss` 的加权平均。没值的格子不计入分母 —— 那是「没探测到」，
 * 不是「没丢包」，拿 0 补进去会把丢包率冲淡。
 */
/** 这台机器在窗口里还剩几个可用格子（扣掉复印段）。只给 DEBUG 视图用。 */
function windowSlotCount(server, now) {
  return dropBackfilled(latencyWindow(server, now)).length;
}

export function windowLoss(server, key, now = Date.now()) {
  const slots = dropBackfilled(latencyWindow(server, now));
  let sum = 0;
  let count = 0;
  for (const slot of slots) {
    const value = slot.loss[key];
    if (value == null) continue;
    sum += clamp(value, 0, 100);
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

/**
 * 读一条线路的延迟与丢包。延迟为负在后端语义里是探测失败，按「没有值」处理。
 *
 * `lossWindow` 为 hour 时丢包取最近一小时的均值；窗口不可用（旧版后端、或整段都是
 * 复印件）就回落到 `loss_*` 那个瞬时值，`windowed` 记下这次实际用的是哪一种。
 */
function carrierSample(server, key, { now = Date.now(), lossWindow = "hour" } = {}) {
  const carrier = CARRIERS[key];
  if (!carrier) return null;
  const pingRaw = server?.[carrier.ping];
  const lossRaw = server?.[carrier.loss];
  const ms = pingRaw == null ? null : toNumber(pingRaw);
  const instant = lossRaw == null ? null : clamp(toNumber(lossRaw), 0, 100);
  const hourly = lossWindow === "hour" ? windowLoss(server, key, now) : null;
  return {
    key,
    label: carrier.label,
    ms: ms != null && ms > 0 ? ms : null,
    loss: hourly ?? instant,
    windowed: hourly != null,
  };
}

const EMPTY_PING = { key: null, label: "", ms: null, loss: null, windowed: false };

/**
 * 要显示的那条线路的延迟与丢包。
 *
 * 指定线路时就认那一条（点名了电信却显示联通的数才是真的误导，所以不做回退）；
 * `auto` 在三网里挑延迟最低的。三条都没有延迟值时退而取有丢包数据的那条 ——
 * 100% 丢包恰恰表现为「有丢包、没延迟」，这时候更该把丢包显示出来。
 */
export function pingOf(server, carrier = "auto", opts = {}) {
  if (carrier !== "auto") return carrierSample(server, carrier, opts) ?? EMPTY_PING;

  const samples = AUTO_CARRIERS.map((key) => carrierSample(server, key, opts)).filter(Boolean);
  const measured = samples.filter((s) => s.ms != null);
  if (measured.length) return measured.reduce((best, s) => (s.ms < best.ms ? s : best));
  return samples.find((s) => s.loss != null) ?? EMPTY_PING;
}

export function metricsOf(server, now = Date.now(), carrier = "auto", lossWindow = "hour") {
  const ramTotal = toNumber(server?.ram_total);
  const diskTotal = toNumber(server?.disk_total);
  return {
    online: isOnline(server, now),
    cpuPct: clamp(toNumber(server?.cpu), 0, 100),
    ramPct: ramTotal > 0 ? clamp((toNumber(server?.ram_used) / ramTotal) * 100, 0, 100) : 0,
    diskPct: diskTotal > 0 ? clamp((toNumber(server?.disk_used) / diskTotal) * 100, 0, 100) : 0,
    netIn: toNumber(server?.net_in_speed),
    netOut: toNumber(server?.net_out_speed),
    ping: pingOf(server, carrier, { now, lossWindow }),
  };
}

/** 三级匹配：id 全等 → 名称全等（忽略大小写）→ 名称包含。都没中返回 null。 */
export function pickOne(servers, token) {
  const needle = String(token ?? "").trim();
  if (!needle) return null;
  const lower = needle.toLowerCase();
  return (
    servers.find((s) => String(s.id) === needle) ??
    servers.find((s) => String(s.name ?? "").toLowerCase() === lower) ??
    servers.find((s) => String(s.name ?? "").toLowerCase().includes(lower)) ??
    null
  );
}

/**
 * 中/大尺寸的节点列表。
 *
 * 给了 `nodes` 就按给定顺序取（未命中的 token 静默跳过，不报错——机器改名了也不该让
 * 整个小组件变成错误页）；没给就按「最需要关注」排序：离线优先，其次 CPU 高，
 * 最后按名称兜底保证顺序稳定。
 */
export function pickList(
  servers,
  { nodes = "", group = "", limit = 4, now = Date.now(), sort = "order" } = {},
) {
  let pool = servers.filter((s) => String(s.is_hidden ?? "0") !== "1");
  if (group) pool = pool.filter((s) => String(s.server_group ?? "") === group);

  const tokens = String(nodes)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length) {
    const picked = [];
    for (const token of tokens) {
      const hit = pickOne(pool, token);
      if (hit && !picked.includes(hit)) picked.push(hit);
    }
    return picked.slice(0, limit);
  }

  // 下标兜底保证排序稳定：sort_order 全是 0 的站点（后台没排过序）就保持后端下发的顺序。
  const indexed = pool.map((server, index) => ({ server, index }));
  indexed.sort((a, b) => {
    if (sort === "health") {
      const onlineA = isOnline(a.server, now);
      const onlineB = isOnline(b.server, now);
      if (onlineA !== onlineB) return onlineA ? 1 : -1;
      const cpuDiff = toNumber(b.server.cpu) - toNumber(a.server.cpu);
      if (cpuDiff !== 0) return cpuDiff;
      const nameDiff = String(a.server.name ?? "").localeCompare(String(b.server.name ?? ""));
      if (nameDiff !== 0) return nameDiff;
    } else {
      const orderDiff = toNumber(a.server.sort_order) - toNumber(b.server.sort_order);
      if (orderDiff !== 0) return orderDiff;
    }
    return a.index - b.index;
  });

  return indexed.slice(0, limit).map((entry) => entry.server);
}

export function readEnv(ctx) {
  const env = ctx?.env ?? {};
  const rows = Number.parseInt(env.ROWS, 10);
  const refresh = Number.parseFloat(env.REFRESH);
  return {
    apiBase: String(env.API_BASE ?? "").trim().replace(/\/+$/, ""),
    node: String(env.NODE ?? "").trim(),
    nodes: String(env.NODES ?? "").trim(),
    group: String(env.GROUP ?? "").trim(),
    title: String(env.TITLE ?? "").trim() || "服务器状态",
    carrier: normalizeCarrier(env.CARRIER),
    lossWindow: normalizeLossWindow(env.LOSS_WINDOW),
    sort: normalizeSort(env.SORT),
    background: normalizeBackground(env.BACKGROUND),
    latencyStyle: normalizeLatencyStyle(env.LATENCY_STYLE),
    debug: /^(1|true|yes|on)$/i.test(String(env.DEBUG ?? "").trim()),
    rows: Number.isFinite(rows) && rows > 0 ? rows : null,
    refreshMinutes: Number.isFinite(refresh) && refresh > 0 ? refresh : 1,
  };
}

// ---------------------------------------------------------------- 取数

/** 带人话消息的错误，直接渲染给用户看。 */
class WidgetError extends Error {}

async function fetchSnapshot(ctx, apiBase) {
  let resp;
  try {
    resp = await ctx.http.get(`${apiBase}/api/servers`, {
      headers: { Accept: "application/json" },
      timeout: 10_000,
    });
  } catch {
    throw new WidgetError(`无法连接\n${hostOf(apiBase)}`);
  }

  const status = typeof resp?.status === "number" ? resp.status : 200;
  // 站点开了全局 Turnstile 时后端回 403，那份凭证只能在浏览器里解人机验证才能拿到，
  // 脚本无解，只能明说。
  if (status === 403) throw new WidgetError("站点已开启人机验证\n小组件不支持");
  if (status === 401) throw new WidgetError("站点未公开\n需要登录才能查看");
  if (status >= 400) throw new WidgetError(`请求失败 ${status}`);

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new WidgetError("返回的不是 JSON\n请检查 API_BASE");
  }

  const servers = Array.isArray(data?.servers) ? data.servers : [];
  if (!servers.length) throw new WidgetError("没有节点");
  return { servers, stats: data?.stats ?? {} };
}

/**
 * stats 是后端算好下发的，但旧版本 Workers 可能不带（或少带字段）。
 * 缺什么就按同样口径自己算一遍，免得小组件显示成「在线 0/0」。
 */
export function deriveStats(servers, stats = {}, now = Date.now()) {
  const visible = servers.filter((s) => String(s.is_hidden ?? "0") !== "1");
  const online = visible.filter((s) => isOnline(s, now));
  const has = (key) => Number.isFinite(Number(stats?.[key]));
  return {
    total: has("total") ? toNumber(stats.total) : visible.length,
    online: has("online") ? toNumber(stats.online) : online.length,
    offline: has("offline") ? toNumber(stats.offline) : visible.length - online.length,
    globalSpeedIn: has("globalSpeedIn")
      ? toNumber(stats.globalSpeedIn)
      : online.reduce((sum, s) => sum + toNumber(s.net_in_speed), 0),
    globalSpeedOut: has("globalSpeedOut")
      ? toNumber(stats.globalSpeedOut)
      : online.reduce((sum, s) => sum + toNumber(s.net_out_speed), 0),
    globalNetRx: has("globalNetRx")
      ? toNumber(stats.globalNetRx)
      : visible.reduce((sum, s) => sum + toNumber(s.net_rx), 0),
    globalNetTx: has("globalNetTx")
      ? toNumber(stats.globalNetTx)
      : visible.reduce((sum, s) => sum + toNumber(s.net_tx), 0),
  };
}

function hostOf(apiBase) {
  return String(apiBase).replace(/^https?:\/\//, "").split("/")[0];
}

// ---------------------------------------------------------------- DSL 积木

function text(
  content,
  { size = 10, weight, color = COLORS.text, align, maxLines, minScale, opacity, flex } = {},
) {
  const node = { type: "text", text: String(content), font: { size }, textColor: color };
  if (weight) node.font.weight = weight;
  if (align) node.textAlign = align;
  if (maxLines) node.maxLines = maxLines;
  if (minScale) node.minScale = minScale;
  if (opacity != null) node.opacity = opacity;
  if (flex != null) node.flex = flex;
  return node;
}

function row(children, { gap = 4, align = "center", ...rest } = {}) {
  return { type: "stack", direction: "row", alignItems: align, gap, children, ...rest };
}

/** text 元素没有 width 属性，需要定宽列时用 stack 包一层。 */
function cell(width, node) {
  return { type: "stack", direction: "row", width, children: [node] };
}

/**
 * 进度条。
 *
 * 填充块用 flex 占比而不是像素宽度：小组件的实际点宽随机型变化，按占比分配才能在
 * 定宽列和自适应列里都对得上。
 */
function bar(pct, color, { width, flex = 1, height = 4 } = {}) {
  const value = clamp(toNumber(pct), 0, 100);
  const track = {
    type: "stack",
    direction: "row",
    height,
    borderRadius: height / 2,
    backgroundColor: COLORS.track,
    gap: 0,
    children: [
      {
        type: "stack",
        flex: value,
        height,
        borderRadius: height / 2,
        backgroundColor: color,
        children: [],
      },
      { type: "stack", flex: 100 - value, height, children: [] },
    ],
  };
  if (width) track.width = width;
  else track.flex = flex;
  return track;
}

/**
 * 分隔线。里面塞一个 spacer 是必要的：容器默认按内容收缩并居中，
 * 一个只有高度没有宽度的空 stack 会被压成 0 宽，什么都看不见。
 */
function divider() {
  return {
    type: "stack",
    direction: "row",
    height: 1,
    backgroundColor: COLORS.hairline,
    children: [{ type: "spacer" }],
  };
}

/**
 * 背景样式铺到 widget 根节点上。
 * `system` 什么都不设 —— 交给系统自己的小组件材质，那才是最「原生」的一档。
 */
function backgroundOf(style) {
  if (style === "solid") return { backgroundColor: SOLID_BACKGROUND };
  if (style === "glass") return { backgroundGradient: GLASS_GRADIENT };
  if (style === "clear") return { backgroundColor: CLEAR_BACKGROUND };
  return {};
}

/** hex → 同色的半透明 rgba。已经是 rgba 之类的写法就原样返回。 */
function withAlpha(color, alpha) {
  const convert = (value) => {
    const match = /^#([0-9a-f]{6})$/i.exec(String(value).trim());
    if (!match) return String(value);
    const n = Number.parseInt(match[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };
  if (typeof color === "string") return convert(color);
  return { light: convert(color.light), dark: convert(color.dark) };
}

/**
 * 延迟数值。
 *
 * `text`（默认）把数字直接染成延迟色 —— 可读性靠 LATENCY_COLORS 里压深过的浅色档位保证。
 * `chip` 改成「延迟色当底、数字用正文色」，可读性最好但一行里多出几块色斑，观感偏花。
 */
function latencyValue(ms, { width, size, style, suffix = "" }) {
  const tone = latencyColor(ms);
  const label = ms == null ? "—" : `${Math.round(ms)}${suffix}`;
  if (style === "text" || ms == null) {
    return cell(width, text(label, { size, color: tone, align: "right" }));
  }
  return {
    type: "stack",
    direction: "row",
    alignItems: "center",
    width,
    height: 14,
    borderRadius: 4,
    backgroundColor: withAlpha(tone, 0.3),
    children: [text(label, { size, color: COLORS.text, align: "center", flex: 1 })],
  };
}

function statusDot(online) {
  return text("●", { size: 7, color: online ? COLORS.online : COLORS.offline });
}

/** 相对时间由系统自己走秒，不占用小组件的刷新预算。 */
function relativeDate(timeMs, { size = 9, color = COLORS.textDim, align = "right" } = {}) {
  return {
    type: "date",
    date: new Date(timeMs).toISOString(),
    format: "relative",
    font: { size },
    textColor: color,
    textAlign: align,
  };
}

/**
 * 延迟与丢包两列。拆成两个定宽 cell 而不是一段文字，右端的数字才能对齐成一列。
 * 没有数据时占位画「—」，宁可留白也不让后面的列往回缩。
 */
function pingCells(ping, { size = 10, pingWidth = 30, lossWidth = 26, style = "chip" } = {}) {
  const ms = ping?.ms ?? null;
  const loss = ping?.loss ?? null;
  return [
    latencyValue(ms, { width: pingWidth, size, style }),
    cell(
      lossWidth,
      text(formatLoss(loss), { size: size - 1, color: lossColor(loss), align: "right" }),
    ),
  ];
}

// ---------------------------------------------------------------- 行渲染

/**
 * 中/大共用的节点行。dense=true 是中尺寸（两条进度条），false 是大尺寸（多一条磁盘）。
 * 不给每条进度条加文字标签——横向放不下，靠颜色区分（蓝=CPU 紫=内存 橙=磁盘），
 * 大尺寸的标题行有图例。
 *
 * 行高写死：小组件在 Mac / iPad 上比 iPhone 高不少，不定高的话 SwiftUI 会把多出来的
 * 竖直空间平摊给每一行，节点之间被拉出巨大的空隙（tile 定了高就没这个毛病）。
 */
/** 中/大尺寸在参考机型上排满时的行数与行距，listRowHeight 以此为预算。 */
const LIST_LAYOUT = {
  medium: { capacity: 5, base: 16, gap: 4, max: 26 },
  large: { capacity: 9, base: 16, gap: 6, max: 28 },
};

/**
 * 行高。
 *
 * 行必须定高（不定高的话 Egern 会把 Mac / iPad 上多出来的竖直空间平摊掉，行间被扯出巨大空隙），
 * 但一律用最小行高又会让「只有四台机器」的面板挤在顶上、下面空一大片。
 * 所以按机器台数把行拉高来填空档，并设上限 —— 无上限地填满，四台机器就会被扯成一屏大格子，
 * 那正是最初 Mac 上看着不对的样子。
 */
export function listRowHeight(count, { capacity, base, gap, max }) {
  if (!count || count >= capacity) return base;
  const budget = capacity * base + (capacity - 1) * gap;
  return clamp(Math.floor((budget - (count - 1) * gap) / count), base, max);
}

function nodeRow(
  server,
  {
    dense = true,
    now = Date.now(),
    carrier = "auto",
    lossWindow = "hour",
    height = 16,
    latencyStyle = "chip",
  } = {},
) {
  const m = metricsOf(server, now, carrier, lossWindow);
  const flag = flagEmoji(server.region);
  const nameColor = m.online ? COLORS.text : COLORS.textDim;
  const barWidth = dense ? 30 : 22;
  // 26 是「100%」在 9pt 下的实测占宽，再窄就会顶到后面的延迟列。
  const pctWidth = dense ? 26 : 24;
  const pctSize = 9;

  const children = [statusDot(m.online)];
  if (flag) children.push(text(flag, { size: dense ? 11 : 10 }));
  children.push(
    text(server.name ?? "", {
      size: dense ? 11 : 10,
      weight: "medium",
      color: nameColor,
      maxLines: 1,
      minScale: 0.7,
      flex: 1,
    }),
  );

  const metricPairs = dense
    ? [
        [m.cpuPct, COLORS.cpu],
        [m.ramPct, COLORS.mem],
      ]
    : [
        [m.cpuPct, COLORS.cpu],
        [m.ramPct, COLORS.mem],
        [m.diskPct, COLORS.disk],
      ];

  for (const [pct, color] of metricPairs) {
    // 离线机器的指标是上一次上报的残值，压成灰色免得看着像还在跑。
    children.push(bar(m.online ? pct : 0, m.online ? color : COLORS.track, { width: barWidth }));
    children.push(
      cell(
        pctWidth,
        text(`${Math.round(pct)}%`, {
          size: pctSize,
          color: m.online ? COLORS.textSub : COLORS.textDim,
          align: "right",
        }),
      ),
    );
  }

  children.push(
    ...pingCells(m.online ? m.ping : null, {
      size: dense ? 10 : 9,
      pingWidth: dense ? 30 : 26,
      lossWidth: dense ? 26 : 24,
      style: latencyStyle,
    }),
  );
  return row(children, { gap: dense ? 4 : 3, height });
}

// ---------------------------------------------------------------- 三个尺寸

/**
 * 小尺寸：单台机器。
 *
 * 每一行都刻意做成和 nodeRow 一样的形状 ——「一个 flex 文本 + 若干定宽块」，
 * 表头的 date 也和中/大尺寸一样放在行尾。原因是小尺寸在真机上曾经整块空白、只剩一个旗帜，
 * 而中/大尺寸用同一批积木渲染始终正常，所以这里不再使用任何它们没有的结构：
 * 没有行内 spacer、没有以定宽块开头的行、没有只有 flex 没有 width 的进度条轨道。
 * 改这里之前先想清楚新结构在中/大尺寸里有没有先例。
 */
function renderSmall(server, { now, refreshAfter, apiBase, env }) {
  const m = metricsOf(server, now, env.carrier, env.lossWindow);
  const flag = flagEmoji(server.region);

  const header = [statusDot(m.online)];
  if (flag) header.push(text(flag, { size: 12 }));
  header.push(
    text(server.name ?? "", {
      size: 13,
      weight: "semibold",
      color: m.online ? COLORS.text : COLORS.offline,
      maxLines: 1,
      minScale: 0.6,
      flex: 1,
    }),
  );
  // 更新时间放在行尾，和中尺寸汇总行、大尺寸标题行的位置一致。
  // 离线时不放，免得和页脚的「最后上报」两个相对时间撞在一起。
  if (m.online) header.push(relativeDate(now, { size: 8 }));

  const metricRow = (label, pct, color) =>
    row(
      [
        text(label, { size: 9, color: COLORS.textDim, maxLines: 1, flex: 1 }),
        bar(m.online ? pct : 0, m.online ? color : COLORS.track, { width: 50 }),
        cell(30, text(`${Math.round(pct)}%`, { size: 10, color: COLORS.textSub, align: "right" })),
      ],
      { gap: 4, height: 16 },
    );

  // auto 模式下标签是实际胜出的那条线路，顺带告诉用户这个数来自哪。
  const pingLabel = m.ping.label || (env.carrier === "auto" ? "延迟" : "");
  const pingRow = row(
    [
      text(pingLabel, { size: 9, color: COLORS.textDim, maxLines: 1, flex: 1 }),
      latencyValue(m.online ? m.ping.ms : null, {
        width: 50,
        size: 10,
        style: env.latencyStyle,
        suffix: " ms",
      }),
      cell(
        30,
        text(m.online ? formatLoss(m.ping.loss) : "—", {
          size: 9,
          color: lossColor(m.online ? m.ping.loss : null),
          align: "right",
        }),
      ),
    ],
    { gap: 4, height: 16 },
  );

  const footer = m.online
    ? row(
        [
          text(`↓ ${formatRate(m.netIn)}`, { size: 10, color: COLORS.down, maxLines: 1, flex: 1 }),
          text(`↑ ${formatRate(m.netOut)}`, { size: 10, color: COLORS.up, maxLines: 1 }),
        ],
        { gap: 4, height: 15 },
      )
    : row(
        [
          text("离线", { size: 11, weight: "semibold", color: COLORS.offline, flex: 1 }),
          relativeDate(toNumber(server.last_updated) || now, { size: 9 }),
        ],
        { gap: 4, height: 15 },
      );

  return {
    type: "widget",
    // 边距比早先大一档：贴边太紧，尤其是铺了玻璃底之后更显得挤。
    padding: 15,
    gap: 5,
    ...backgroundOf(env.background),
    url: `${apiBase}/#/server/${encodeURIComponent(String(server.id))}`,
    refreshAfter,
    children: [
      row(header, { gap: 4, height: 17 }),
      metricRow("CPU", m.cpuPct, COLORS.cpu),
      metricRow("内存", m.ramPct, COLORS.mem),
      metricRow("磁盘", m.diskPct, COLORS.disk),
      pingRow,
      { type: "spacer" },
      footer,
    ],
  };
}

function summaryLine(stats, now) {
  const total = toNumber(stats.total);
  const online = toNumber(stats.online);
  const offline = toNumber(stats.offline);
  const children = [
    text(`在线 ${online}/${total}`, { size: 11, weight: "semibold" }),
  ];
  if (offline > 0) children.push(text(`离线 ${offline}`, { size: 10, color: COLORS.offline }));
  children.push({ type: "spacer" });
  children.push(text(`↓ ${formatRate(stats.globalSpeedIn)}`, { size: 10, color: COLORS.down }));
  children.push(text(`↑ ${formatRate(stats.globalSpeedOut)}`, { size: 10, color: COLORS.up }));
  children.push(relativeDate(now, { size: 9 }));
  return row(children, { gap: 6, height: 16 });
}

function renderMedium(servers, stats, { now, refreshAfter, apiBase, env }) {
  // 5 行是中尺寸能吃满的行数：再多一行在 iPhone SE 那档（141pt 高）会被裁掉。
  const list = pickList(servers, {
    nodes: env.nodes,
    group: env.group,
    limit: env.rows ?? LIST_LAYOUT.medium.capacity,
    sort: env.sort,
    now,
  });
  const height = listRowHeight(list.length, LIST_LAYOUT.medium);

  return {
    type: "widget",
    padding: 15,
    // 行定高之后不能再靠压缩来兜底，gap 留 4 才够 iPhone SE 那档（中尺寸只有 141pt 高）。
    gap: LIST_LAYOUT.medium.gap,
    ...backgroundOf(env.background),
    url: `${apiBase}/#/`,
    refreshAfter,
    children: [
      summaryLine(stats, now),
      divider(),
      ...list.map((server) => nodeRow(server, {
          dense: true,
          now,
          carrier: env.carrier,
          lossWindow: env.lossWindow,
          height,
          latencyStyle: env.latencyStyle,
        })),
      { type: "spacer" },
    ],
  };
}

/** 汇总方块的高度。tile 与承载它们的那一行都要定高，见 TILE_HEIGHT 的用法。 */
const TILE_HEIGHT = 38;

/** 高度写死，否则一行数字的第一块会比两行数字的另外两块矮一截，顶边参差。 */
function tile(children) {
  return {
    type: "stack",
    direction: "column",
    alignItems: "start",
    gap: 1,
    flex: 1,
    height: TILE_HEIGHT,
    padding: 6,
    borderRadius: 10,
    backgroundColor: COLORS.fill,
    children,
  };
}

/**
 * 进度条只有颜色没有文字标签，靠这行图例说明；末尾顺带标明延迟列取的是哪条线路。
 * 标题行本来就窄，图例只留线路名 —— 写成「最优 ms / 丢包」会被挤成省略号。
 */
function legend(carrier) {
  const latencyLabel = carrier === "auto" ? "最优" : (CARRIERS[carrier]?.label ?? "最优");
  return row(
    [
      text("●", { size: 7, color: COLORS.cpu }),
      text("CPU", { size: 8, color: COLORS.textDim }),
      text("●", { size: 7, color: COLORS.mem }),
      text("内存", { size: 8, color: COLORS.textDim }),
      text("●", { size: 7, color: COLORS.disk }),
      text("磁盘", { size: 8, color: COLORS.textDim }),
      text(`｜${latencyLabel}`, { size: 8, color: COLORS.textDim, maxLines: 1 }),
    ],
    { gap: 2 },
  );
}

function renderLarge(servers, stats, { now, refreshAfter, apiBase, env }) {
  const list = pickList(servers, {
    nodes: env.nodes,
    group: env.group,
    limit: env.rows ?? LIST_LAYOUT.large.capacity,
    sort: env.sort,
    now,
  });
  const height = listRowHeight(list.length, LIST_LAYOUT.large);

  const total = toNumber(stats.total);
  const online = toNumber(stats.online);
  const offline = toNumber(stats.offline);

  const offlineNames = servers
    .filter((s) => String(s.is_hidden ?? "0") !== "1" && !isOnline(s, now))
    .map((s) => s.name)
    .filter(Boolean);

  return {
    type: "widget",
    padding: 16,
    gap: LIST_LAYOUT.large.gap,
    ...backgroundOf(env.background),
    url: `${apiBase}/#/`,
    refreshAfter,
    children: [
      row(
        [
          text(env.title, { size: 15, weight: "semibold", maxLines: 1, minScale: 0.7 }),
          { type: "spacer" },
          legend(env.carrier),
          relativeDate(now),
        ],
        { gap: 6, height: 18 },
      ),
      // 这一行必须定高：不定高的话它会把整块小组件多出来的竖直空间全吃掉，
      // 方块贴在行顶、节点列表被推到底部，中间空出一大片。
      row(
        [
          tile([
            text(`${online}/${total}`, {
              size: 20,
              weight: "semibold",
              color: offline > 0 ? COLORS.offline : COLORS.text,
            }),
          ]),
          tile([
            text(`↓ ${formatRate(stats.globalSpeedIn)}`, { size: 11, color: COLORS.down }),
            text(`↑ ${formatRate(stats.globalSpeedOut)}`, { size: 11, color: COLORS.up }),
          ]),
          tile([
            text(`↓ ${formatBytes(stats.globalNetRx)}`, { size: 11, color: COLORS.down }),
            text(`↑ ${formatBytes(stats.globalNetTx)}`, { size: 11, color: COLORS.up }),
          ]),
        ],
        { gap: 7, align: "start", height: TILE_HEIGHT },
      ),
      divider(),
      ...list.map((server) => nodeRow(server, {
          dense: false,
          now,
          carrier: env.carrier,
          lossWindow: env.lossWindow,
          height,
          latencyStyle: env.latencyStyle,
        })),
      { type: "spacer" },
      divider(),
      row([
        offlineNames.length
          ? text(`离线：${offlineNames.join("、")}`, {
              size: 9,
              color: COLORS.offline,
              maxLines: 1,
              minScale: 0.7,
              flex: 1,
            })
          : text("全部在线", { size: 9, color: COLORS.online, flex: 1 }),
      ], { height: 12 }),
    ],
  };
}

/**
 * DEBUG=1 时的排查视图：只用 widget + 一个 text，是这套 DSL 里最小的一棵树。
 *
 * 用来在真机上二分「是取数没成功，还是某个布局结构没渲染出来」——
 * 这里能显示内容就说明数据和文字都没问题，问题出在 stack / 定宽 / 进度条这些结构上。
 */
function renderDebug(ctx, env, servers, stats, refreshAfter) {
  const lines = [
    `family: ${ctx?.widgetFamily ?? "(空)"}`,
    `base: ${hostOf(env.apiBase)}`,
    `nodes: ${servers.length}`,
    `stats: ${toNumber(stats.online)}/${toNumber(stats.total)}`,
    `carrier: ${env.carrier}`,
    // 一小时窗口是 Workers 2.8.3 Beta2 起才有的字段，真机上先看这里有没有格子。
    `loss: ${env.lossWindow} (窗口 ${windowSlotCount(servers[0], Date.now())} 格)`,
    `node: ${env.node || "(空)"}`,
    ...servers.slice(0, 3).map((s) => `- ${s.name} cpu=${Math.round(toNumber(s.cpu))}`),
  ];
  return {
    type: "widget",
    padding: 16,
    refreshAfter,
    children: [
      text(lines.join("\n"), { size: 9, color: COLORS.text, maxLines: 12, minScale: 0.5 }),
    ],
  };
}

function renderError(message, { refreshAfter, hint, background = "glass" } = {}) {
  const children = [
    { type: "spacer" },
    row([
      text(message, {
        size: 12,
        color: COLORS.textSub,
        align: "center",
        maxLines: 4,
        minScale: 0.7,
        flex: 1,
      }),
    ]),
  ];
  if (hint) {
    children.push(
      row([
        text(hint, { size: 9, color: COLORS.textDim, align: "center", maxLines: 3, flex: 1 }),
      ]),
    );
  }
  children.push({ type: "spacer" });
  return {
    type: "widget",
    padding: 16,
    gap: 4,
    ...backgroundOf(background),
    refreshAfter,
    children,
  };
}

// ---------------------------------------------------------------- 入口

export async function render(ctx, now = Date.now()) {
  const env = readEnv(ctx);
  const refreshAfter = new Date(now + env.refreshMinutes * 60_000).toISOString();

  if (!env.apiBase) {
    return renderError("未配置 API_BASE", {
      refreshAfter,
      background: env.background,
      hint: "在 Egern 的 widget env 里填后端地址，例如 https://status.example.com",
    });
  }

  let snapshot;
  try {
    snapshot = await fetchSnapshot(ctx, env.apiBase);
  } catch (error) {
    const message = error instanceof WidgetError ? error.message : "取数失败";
    return renderError(message, { refreshAfter, background: env.background });
  }

  const { servers } = snapshot;
  const stats = deriveStats(servers, snapshot.stats, now);
  if (env.debug) return renderDebug(ctx, env, servers, stats, refreshAfter);

  const family = ctx?.widgetFamily ?? "systemSmall";
  const options = { now, refreshAfter, apiBase: env.apiBase, env };

  if (family === "systemMedium") return renderMedium(servers, stats, options);
  if (family === "systemLarge" || family === "systemExtraLarge") {
    return renderLarge(servers, stats, options);
  }

  // systemSmall 与锁屏等未知尺寸都退回单节点视图，总比一片空白强。
  const visible = servers.filter((s) => String(s.is_hidden ?? "0") !== "1");
  const target = env.node
    ? pickOne(visible, env.node)
    : pickList(visible, { group: env.group, limit: 1, sort: env.sort, now })[0];
  if (!target) {
    return renderError(`未找到节点\n${env.node}`, {
      refreshAfter,
      background: env.background,
    });
  }
  return renderSmall(target, options);
}

export default async function (ctx) {
  return render(ctx);
}

// 测试用的内部件，Egern 不会读到。
export { CARRIERS, COLORS, WidgetError, bar, nodeRow, renderError };
