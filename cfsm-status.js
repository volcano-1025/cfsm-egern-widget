/**
 * CF-Server-Monitor 探针面板的 Egern iOS 主屏小组件。
 *
 * 适配 systemSmall / systemMedium / systemLarge 三个主屏尺寸：
 *   小 —— 单台机器的 CPU / 内存 / 磁盘 / 实时网速
 *   中 —— 全站汇总条 + 若干节点行（CPU、内存、最优线路延迟）
 *   大 —— 标题 + 三块汇总 + 更长的节点列表（多一列磁盘）+ 离线名单
 *
 * 只发一个请求：`GET {API_BASE}/api/servers`，它一次带回 stats 汇总与每台机器的全部指标。
 * 绝不碰 `/api/history/all` —— 逐节点查历史会让后端 D1 读行翻几十倍，面板主题同样禁止在
 * 概览场景使用它。
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
 * 延迟阶梯配色，档位与阈值抄自主题的 latencyHeatColor。
 *
 * 深色沿用主题原值；浅色整体压深了一档 —— 主题里这些颜色画在深色卡片或色带上，
 * 而小组件浅色态是接近纯白的系统材质，原来的黄绿（#9fe339 / #cbd83a）在白底上几乎看不清。
 * 色相顺序仍是 绿 → 黄绿 → 金 → 橙 → 红，只是明度降下来。
 */
const LATENCY_COLORS = {
  excellent: { light: "#15803d", dark: "#2fc66e" },
  good: { light: "#4d7c0f", dark: "#9fe339" },
  moderate: { light: "#a16207", dark: "#cbd83a" },
  elevated: { light: "#b45309", dark: "#e2a928" },
  critical: { light: "#dc2626", dark: "#f47067" },
};

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

export function isOnline(server, now = Date.now()) {
  if (typeof server?.is_online === "boolean") return server.is_online;
  return now - toNumber(server?.last_updated) < ONLINE_THRESHOLD_MS;
}

/**
 * 三网（电信/联通/移动）里最优的一条延迟。
 * 负值在后端语义里表示探测失败，和 null 一样跳过；三条都没有就返回 null。
 */
export function bestPing(server) {
  const values = [server?.ping_ct, server?.ping_cu, server?.ping_cm]
    .map((v) => (v == null ? null : toNumber(v)))
    .filter((v) => v != null && v > 0);
  return values.length ? Math.min(...values) : null;
}

export function metricsOf(server, now = Date.now()) {
  const ramTotal = toNumber(server?.ram_total);
  const diskTotal = toNumber(server?.disk_total);
  return {
    online: isOnline(server, now),
    cpuPct: clamp(toNumber(server?.cpu), 0, 100),
    ramPct: ramTotal > 0 ? clamp((toNumber(server?.ram_used) / ramTotal) * 100, 0, 100) : 0,
    diskPct: diskTotal > 0 ? clamp((toNumber(server?.disk_used) / diskTotal) * 100, 0, 100) : 0,
    netIn: toNumber(server?.net_in_speed),
    netOut: toNumber(server?.net_out_speed),
    ping: bestPing(server),
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
export function pickList(servers, { nodes = "", group = "", limit = 4, now = Date.now() } = {}) {
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

  return [...pool]
    .sort((a, b) => {
      const onlineA = isOnline(a, now);
      const onlineB = isOnline(b, now);
      if (onlineA !== onlineB) return onlineA ? 1 : -1;
      const cpuDiff = toNumber(b.cpu) - toNumber(a.cpu);
      if (cpuDiff !== 0) return cpuDiff;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""));
    })
    .slice(0, limit);
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
    rows: Number.isFinite(rows) && rows > 0 ? rows : null,
    refreshMinutes: Number.isFinite(refresh) && refresh > 0 ? refresh : 5,
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

function pingText(ms, { size = 10, width = 32 } = {}) {
  const label = ms == null ? "—" : `${Math.round(ms)}`;
  return cell(width, text(label, { size, color: latencyColor(ms), align: "right" }));
}

// ---------------------------------------------------------------- 行渲染

/**
 * 中/大共用的节点行。dense=true 是中尺寸（两条进度条），false 是大尺寸（多一条磁盘）。
 * 不给每条进度条加文字标签——横向放不下，靠颜色区分（蓝=CPU 紫=内存 橙=磁盘），
 * 大尺寸的标题行有图例。
 */
function nodeRow(server, { dense = true, now = Date.now() } = {}) {
  const m = metricsOf(server, now);
  const flag = flagEmoji(server.region);
  const nameColor = m.online ? COLORS.text : COLORS.textDim;
  const barWidth = dense ? 30 : 24;
  // 26 是「100%」在 9pt 下的实测占宽，再窄就会顶到后面的延迟列。
  const pctWidth = 26;
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

  children.push(pingText(m.online ? m.ping : null, { size: dense ? 10 : 9, width: dense ? 32 : 28 }));
  return row(children, { gap: dense ? 4 : 3 });
}

// ---------------------------------------------------------------- 三个尺寸

function renderSmall(server, { now, refreshAfter, apiBase }) {
  const m = metricsOf(server, now);
  const flag = flagEmoji(server.region);

  const header = [];
  if (flag) header.push(text(flag, { size: 13 }));
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
  header.push(statusDot(m.online));

  const metricRow = (label, pct, color) =>
    row(
      [
        cell(26, text(label, { size: 9, color: COLORS.textDim })),
        bar(m.online ? pct : 0, m.online ? color : COLORS.track, { flex: 1 }),
        cell(30, text(`${Math.round(pct)}%`, { size: 10, color: COLORS.textSub, align: "right" })),
      ],
      { gap: 5 },
    );

  const footer = m.online
    ? row([
        text(`↓ ${formatRate(m.netIn)}`, { size: 10, color: COLORS.down }),
        { type: "spacer" },
        text(`↑ ${formatRate(m.netOut)}`, { size: 10, color: COLORS.up }),
      ])
    : row([
        text("离线", { size: 11, weight: "semibold", color: COLORS.offline }),
        { type: "spacer" },
        relativeDate(toNumber(server.last_updated) || now, { size: 10 }),
      ]);

  return {
    type: "widget",
    padding: 14,
    gap: 6,
    url: `${apiBase}/#/server/${encodeURIComponent(String(server.id))}`,
    refreshAfter,
    children: [
      row(header, { gap: 4 }),
      metricRow("CPU", m.cpuPct, COLORS.cpu),
      metricRow("内存", m.ramPct, COLORS.mem),
      metricRow("磁盘", m.diskPct, COLORS.disk),
      { type: "spacer" },
      footer,
      // 在线时才在末行标更新时间；离线时时间已经在 footer 里了。
      ...(m.online ? [row([{ type: "spacer" }, relativeDate(now)])] : []),
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
  return row(children, { gap: 6 });
}

function renderMedium(servers, stats, { now, refreshAfter, apiBase, env }) {
  // 5 行是中尺寸能吃满的行数：再多一行在 iPhone SE 那档（141pt 高）会被裁掉。
  const list = pickList(servers, {
    nodes: env.nodes,
    group: env.group,
    limit: env.rows ?? 5,
    now,
  });

  return {
    type: "widget",
    padding: 12,
    gap: 5,
    url: `${apiBase}/#/`,
    refreshAfter,
    children: [
      summaryLine(stats, now),
      divider(),
      ...list.map((server) => nodeRow(server, { dense: true, now })),
      { type: "spacer" },
    ],
  };
}

/** 高度写死，否则一行数字的第一块会比两行数字的另外两块矮一截，顶边参差。 */
function tile(children) {
  return {
    type: "stack",
    direction: "column",
    alignItems: "start",
    gap: 1,
    flex: 1,
    height: 56,
    padding: 7,
    borderRadius: 10,
    backgroundColor: COLORS.fill,
    children,
  };
}

function legend() {
  return row(
    [
      text("●", { size: 7, color: COLORS.cpu }),
      text("CPU", { size: 8, color: COLORS.textDim }),
      text("●", { size: 7, color: COLORS.mem }),
      text("内存", { size: 8, color: COLORS.textDim }),
      text("●", { size: 7, color: COLORS.disk }),
      text("磁盘", { size: 8, color: COLORS.textDim }),
    ],
    { gap: 2 },
  );
}

function renderLarge(servers, stats, { now, refreshAfter, apiBase, env }) {
  const list = pickList(servers, {
    nodes: env.nodes,
    group: env.group,
    limit: env.rows ?? 9,
    now,
  });

  const total = toNumber(stats.total);
  const online = toNumber(stats.online);
  const offline = toNumber(stats.offline);

  const offlineNames = servers
    .filter((s) => String(s.is_hidden ?? "0") !== "1" && !isOnline(s, now))
    .map((s) => s.name)
    .filter(Boolean);

  return {
    type: "widget",
    padding: 14,
    gap: 7,
    url: `${apiBase}/#/`,
    refreshAfter,
    children: [
      row([
        text(env.title, { size: 15, weight: "semibold", maxLines: 1, minScale: 0.7 }),
        { type: "spacer" },
        legend(),
        relativeDate(now),
      ], { gap: 6 }),
      row(
        [
          tile([
            text(`${online}/${total}`, {
              size: 20,
              weight: "semibold",
              color: offline > 0 ? COLORS.offline : COLORS.text,
            }),
            text("在线 / 总数", { size: 9, color: COLORS.textDim }),
          ]),
          tile([
            text(`↓ ${formatRate(stats.globalSpeedIn)}`, { size: 11, color: COLORS.down }),
            text(`↑ ${formatRate(stats.globalSpeedOut)}`, { size: 11, color: COLORS.up }),
            text("实时", { size: 9, color: COLORS.textDim }),
          ]),
          tile([
            text(`↓ ${formatBytes(stats.globalNetRx)}`, { size: 11, color: COLORS.down }),
            text(`↑ ${formatBytes(stats.globalNetTx)}`, { size: 11, color: COLORS.up }),
            text("累计", { size: 9, color: COLORS.textDim }),
          ]),
        ],
        { gap: 7, align: "start" },
      ),
      divider(),
      ...list.map((server) => nodeRow(server, { dense: false, now })),
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
      ]),
    ],
  };
}

function renderError(message, { refreshAfter, hint } = {}) {
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
  return { type: "widget", padding: 14, gap: 4, refreshAfter, children };
}

// ---------------------------------------------------------------- 入口

export async function render(ctx, now = Date.now()) {
  const env = readEnv(ctx);
  const refreshAfter = new Date(now + env.refreshMinutes * 60_000).toISOString();

  if (!env.apiBase) {
    return renderError("未配置 API_BASE", {
      refreshAfter,
      hint: "在 Egern 的 widget env 里填后端地址，例如 https://status.example.com",
    });
  }

  let snapshot;
  try {
    snapshot = await fetchSnapshot(ctx, env.apiBase);
  } catch (error) {
    const message = error instanceof WidgetError ? error.message : "取数失败";
    return renderError(message, { refreshAfter });
  }

  const { servers } = snapshot;
  const stats = deriveStats(servers, snapshot.stats, now);
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
    : pickList(visible, { group: env.group, limit: 1, now })[0];
  if (!target) {
    return renderError(`未找到节点\n${env.node}`, { refreshAfter });
  }
  return renderSmall(target, options);
}

export default async function (ctx) {
  return render(ctx);
}

// 测试用的内部件，Egern 不会读到。
export { COLORS, WidgetError, bar, nodeRow, renderError };
