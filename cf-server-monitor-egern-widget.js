// CF Server Monitor - Egern widget (LuminaPlus-style light theme)
//
// Setup:
// 1. Tools -> Scripts -> "+", type = generic, e.g. name "cf-server-monitor",
//    File Location = Local, filename "cf-server-monitor.js", paste this file.
// 2. Analytics tab -> top-left button -> Widget Gallery -> "+"
//    Name: e.g. "CF Server Monitor"
//    Script Name: cf-server-monitor
// 3. Edit the widget and set env vars:
//    BASE_URL   -> e.g. https://www.example.com   (required)
//    SERVER_ID  -> your server id                  (required)
//    ISP        -> 电信 / 联通 / 移动 / 北京 (可选，默认 电信)
//                  控制延迟(ms)和丢包率(%)展示哪条运营商线路的数据
//
// Or define it in your config file:
//
// scriptings:
//   - generic:
//       name: "cf-server-monitor"
//       script_url: "https://your-host/cf-server-monitor-egern-widget.js"
//       timeout: 20
//
// widgets:
//   - name: "cf-server-monitor"
//     env:
//       BASE_URL: "https://www.example.com"
//       SERVER_ID: "your-server-id"
//       ISP: "电信"
//
// ------------------------------------------------------------------------
// NOTE about the "延迟 / 丢包率" (latency / packet loss) row:
// The CF-Server-Monitor `/api/server` endpoint only returns the LATEST
// snapshot for a server, not a time-series history. So unlike the
// Komari-Theme-LuminaPlus web dashboard (which has a dedicated history
// API and draws a real per-sample sparkline), this widget cannot draw a
// genuine historical bar chart from a single snapshot request. Instead it
// draws a proportional "quality bar" (same visual language as the
// CPU/RAM/DISK/LOAD rows) colored by threshold. If your fork of the
// backend exposes a real ping/loss history array in the payload, tell me
// the field name and I can wire up an actual sparkline.
//
// NOTE about ISP field names:
// The agent reports per-line ping/loss as CT (电信) / CU (联通) / CM (移动)
// / BD (北京/字节) probe results, but different backend versions may name
// the JSON fields differently (e.g. `ct_ping` vs `ct_latency` vs
// `latency_ct`). This script tries several common candidate names per ISP
// and picks the first one present in the response - see PING_FIELD_CANDIDATES
// / LOSS_FIELD_CANDIDATES below. If none match your backend, open the
// widget's `url` (BASE_URL + /api/server?id=...) in a browser, find the
// actual field names in the JSON, and add them to the candidate lists.
// ------------------------------------------------------------------------

export default async function (ctx) {
  const ISP_MAP = {
    "电信": "ct", "ct": "ct", "CT": "ct",
    "联通": "cu", "cu": "cu", "CU": "cu",
    "移动": "cm", "cm": "cm", "CM": "cm",
    "北京": "bd", "字节": "bd", "bd": "bd", "BD": "bd",
  };

  const CONFIG = {
    baseURL: String(ctx.env.BASE_URL || "").replace(/\/+$/, ""),
    serverId: String(ctx.env.SERVER_ID || "").trim(),
    isp: ISP_MAP[String(ctx.env.ISP || "电信").trim()] || "ct",
  };

  const family = ctx.widgetFamily || "systemLarge";
  const large = family === "systemLarge" || family === "systemExtraLarge";
  const small = family === "systemSmall";
  const accessory = family.indexOf("accessory") === 0;

  // ---------- LuminaPlus-inspired light / cream theme ----------
  const COL = {
    bg1: "#FBF8F0",
    bg2: "#FDFBF6",
    card: "#F1EBDB",       // beige placeholder / track color
    fg: "#1C1B18",          // near-black title text
    dim: "#9A9384",         // warm gray label text
    dim2: "#C6BFAE",
    track: "#EDE6D4",       // unfilled segment color
    green: "#5FA83C",
    amber: "#E0A93C",
    red: "#E2574C",
    blue: "#4E7CF6",
    purple: "#8B5CF6",
    orange: "#F0A24E",
    pink: "#EC5A9A",
    latency: "#AECB3A",     // yellow-green, matches screenshot
  };

  const ISP_LABEL = { ct: "电信", cu: "联通", cm: "移动", bd: "北京" };

  const PING_FIELD_CANDIDATES = (isp) => [
    `${isp}_ping`, `${isp}_latency`, `ping_${isp}`, `latency_${isp}`,
    `${isp}Ping`, `${isp}Latency`, `${isp}_ping_ms`, `${isp}_rtt`,
  ];
  const LOSS_FIELD_CANDIDATES = (isp) => [
    `${isp}_loss`, `${isp}_packet_loss`, `loss_${isp}`, `packet_loss_${isp}`,
    `${isp}Loss`, `${isp}PacketLoss`, `${isp}_loss_rate`, `${isp}_lossrate`,
  ];

  function firstDefined(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") {
        const n = Number(obj[k]);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  // ---------- helpers ----------

  function hexToRgb(hex) {
    const h = String(hex || "").replace("#", "");
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
    return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
  }

  function getFlagRegionCode(region) {
    const code = String(region || "").trim().toUpperCase();
    if (!code || code === "XX") return "";
    if (code === "TW" || code === "HK" || code === "MO") return "cn";
    return code.toLowerCase();
  }

  async function fetchFlagDataUri(region) {
    const code = getFlagRegionCode(region);
    if (!code) return null;
    try {
      const resp = await ctx.http.get(`https://flagcdn.com/${code}.svg`, { timeout: 5000 });
      const svg = await resp.text();
      if (!svg || svg.length > 500000) return null;
      return `data:image/svg+xml,${svg}`;
    } catch (e) {
      return null;
    }
  }

  function normalizeTimestamp(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 10000000000 ? n * 1000 : n;
  }

  function isOnline(server) {
    const ts = normalizeTimestamp(server.report_timestamp || server.last_updated || server.timestamp);
    return ts > 0 && Date.now() - ts < 300000;
  }

  function percent(used, total) {
    const u = Number(used) || 0;
    const t = Number(total) || 0;
    return t > 0 ? (u / t) * 100 : 0;
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function usageColor(p) {
    return p < 60 ? COL.green : p < 85 ? COL.amber : COL.red;
  }

  function latencyMsColor(ms) {
    if (ms === null) return COL.dim2;
    return ms < 80 ? COL.green : ms < 150 ? COL.amber : COL.red;
  }

  function lossPctColor(p) {
    if (p === null) return COL.dim2;
    return p <= 2 ? COL.green : p <= 10 ? COL.amber : COL.red;
  }

  function formatBytes(bytes) {
    let n = Math.abs(Number(bytes) || 0);
    if (n === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(1)} ${units[i]}`;
  }

  function trafficUsedBytes(server) {
    const rx = Number(server.net_rx_monthly) || 0;
    const tx = Number(server.net_tx_monthly) || 0;
    const type = server.traffic_calc_type || "total";
    if (type === "dl") return rx;
    if (type === "ul") return tx;
    if (type === "max") return Math.max(rx, tx);
    return rx + tx;
  }

  function trafficLimitBytes(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return 0;
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (raw.includes("TB")) return n * 1024 ** 4;
    if (raw.includes("GB")) return n * 1024 ** 3;
    if (raw.includes("MB")) return n * 1024 ** 2;
    return n * 1024 ** 3;
  }

  function trafficPercent(server) {
    const limit = trafficLimitBytes(server.traffic_limit);
    if (limit <= 0) return 0;
    return percent(trafficUsedBytes(server), limit);
  }

  function hhmm() {
    const d = new Date();
    const p = (n) => (n < 10 ? "0" : "") + n;
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function serverName(server) {
    return server.name || server.id || "Server";
  }

  // Continuous rounded progress bar (kept for compact/small layout).
  function barSvg(value, width, height, color) {
    const p = clampPercent(value);
    const r = height / 2;
    const fw = Math.max(height, (width * p) / 100);
    return (
      `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'>` +
      `<rect x='0' y='0' width='${width}' height='${height}' rx='${r}' ry='${r}' fill='${hexToRgb(COL.track)}'/>` +
      `<rect x='0' y='0' width='${fw}' height='${height}' rx='${r}' ry='${r}' fill='${hexToRgb(color)}'/>` +
      `</svg>`
    );
  }

  // "Pixel row" segmented bar - a row of small rounded squares, matching the
  // LuminaPlus/Komari-style dotted usage indicator. `value` is 0-100.
  function segmentedBarSvg(value, width, opts) {
    const o = Object.assign({ square: 12, gap: 4, color: COL.blue, track: COL.track, radius: 3 }, opts || {});
    const step = o.square + o.gap;
    const count = Math.max(1, Math.floor((width + o.gap) / step));
    const p = clampPercent(value);
    const filled = Math.round((count * p) / 100);
    let rects = "";
    for (let i = 0; i < count; i++) {
      const x = i * step;
      const fill = i < filled ? hexToRgb(o.color) : hexToRgb(o.track);
      rects += `<rect x='${x}' y='0' width='${o.square}' height='${o.square}' rx='${o.radius}' ry='${o.radius}' fill='${fill}'/>`;
    }
    const actualWidth = count * o.square + (count - 1) * o.gap;
    return {
      src: `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${actualWidth} ${o.square}'>${rects}</svg>`,
      width: actualWidth,
      height: o.square,
    };
  }

  // ---------- DSL builders ----------

  // A metric block: "ICON label ......... value%" row, then a pixel bar below.
  function metricBlock(iconSymbol, label, value, width) {
    const p = clampPercent(value);
    const color = usageColor(value);
    const bar = segmentedBarSvg(value, width, { color });
    return {
      type: "stack",
      direction: "column",
      alignItems: "start",
      gap: 8,
      width,
      children: [
        {
          type: "stack",
          direction: "row",
          alignItems: "center",
          width,
          gap: 5,
          children: [
            { type: "image", src: `sf-symbol:${iconSymbol}`, color: COL.dim, width: 13, height: 13 },
            { type: "text", text: label, font: { size: 12, weight: "semibold" }, textColor: COL.dim, maxLines: 1 },
            { type: "spacer" },
            { type: "text", text: `${Math.round(p)}`, font: { size: 17, weight: "bold" }, textColor: COL.fg, maxLines: 1 },
            { type: "text", text: "%", font: { size: 11, weight: "semibold" }, textColor: COL.dim, maxLines: 1 },
          ],
        },
        { type: "image", src: bar.src, width: bar.width, height: bar.height },
      ],
    };
  }

  // Latency / packet-loss block: "ICON label ......... value" then a
  // proportional quality bar (see note at top of file re: no real history).
  function statBlock(iconSymbol, label, valueText, valueColor, barValue, barColor, width) {
    const bar = segmentedBarSvg(barValue, width, { color: barColor, square: 10, gap: 3 });
    return {
      type: "stack",
      direction: "column",
      alignItems: "start",
      gap: 8,
      width,
      children: [
        {
          type: "stack",
          direction: "row",
          alignItems: "center",
          width,
          gap: 5,
          children: [
            { type: "image", src: `sf-symbol:${iconSymbol}`, color: COL.dim, width: 13, height: 13 },
            { type: "text", text: label, font: { size: 12, weight: "semibold" }, textColor: COL.dim, maxLines: 1 },
            { type: "spacer" },
            { type: "text", text: valueText, font: { size: 17, weight: "bold" }, textColor: valueColor, maxLines: 1 },
          ],
        },
        { type: "image", src: bar.src, width: bar.width, height: bar.height },
      ],
    };
  }

  function divider() {
    return { type: "stack", height: 1, backgroundColor: "rgba(28,27,24,0.06)", children: [] };
  }

  function headerRow(server, flagDataUri, nameFontSize, flagSize) {
    const online = isOnline(server);
    const children = [];
    if (flagDataUri) {
      children.push({ type: "image", src: flagDataUri, width: flagSize.w, height: flagSize.h, borderRadius: 2 });
    } else {
      const code = getFlagRegionCode(server.region);
      if (code) children.push({ type: "text", text: String(server.region).toUpperCase(), font: { size: 10, weight: "semibold" }, textColor: COL.dim, maxLines: 1 });
    }
    children.push({
      type: "text",
      text: serverName(server),
      font: { size: nameFontSize, weight: "bold" },
      textColor: COL.fg,
      maxLines: 1,
      minScale: 0.6,
      flex: 1,
    });
    children.push({ type: "text", text: "●", font: { size: 10 }, textColor: online ? COL.green : COL.red, maxLines: 1 });
    return { type: "stack", direction: "row", alignItems: "center", gap: 8, children };
  }

  function errWidget(message) {
    return {
      type: "widget",
      backgroundColor: COL.bg1,
      padding: 14,
      gap: 8,
      children: [
        { type: "text", text: "CF Server Monitor", font: { size: 14, weight: "bold" }, textColor: COL.red, maxLines: 1 },
        { type: "text", text: message, font: { size: 11 }, textColor: COL.fg, maxLines: 3 },
      ],
    };
  }

  function buildAccessory(server) {
    const online = isOnline(server);
    const status = online
      ? `↓${formatBytes(server.net_in_speed)}/s ↑${formatBytes(server.net_out_speed)}/s`
      : "offline";
    return {
      type: "widget",
      children: [
        { type: "text", text: `${serverName(server)}: ${status}`, font: { size: "headline", weight: "semibold" }, maxLines: 2, minScale: 0.6 },
      ],
    };
  }

  function buildSmall(server, flagDataUri) {
    const online = isOnline(server);
    const cpu = Number(server.cpu) || 0;
    const ram = percent(server.ram_used, server.ram_total);
    const disk = percent(server.disk_used, server.disk_total);

    function miniRow(label, value) {
      const color = usageColor(value);
      return {
        type: "stack",
        direction: "column",
        alignItems: "start",
        gap: 4,
        children: [
          {
            type: "stack",
            direction: "row",
            alignItems: "center",
            width: 108,
            children: [
              { type: "text", text: label, font: { size: 10, weight: "bold" }, textColor: COL.dim, maxLines: 1 },
              { type: "spacer" },
              { type: "text", text: `${Math.round(value)}%`, font: { size: 11, weight: "bold" }, textColor: color, maxLines: 1 },
            ],
          },
          { type: "image", src: barSvg(value, 108, 7, color), width: 108, height: 7 },
        ],
      };
    }

    return {
      type: "widget",
      backgroundColor: COL.bg1,
      padding: 14,
      gap: 9,
      url: CONFIG.baseURL || undefined,
      refreshAfter: new Date(Date.now() + 60 * 1000).toISOString(),
      children: [
        headerRow(server, flagDataUri, 14, { w: 18, h: 13 }),
        divider(),
        { type: "spacer", length: 2 },
        miniRow("CPU", cpu),
        miniRow("内存", ram),
        miniRow("磁盘", disk),
        { type: "spacer" },
        {
          type: "text",
          text: online ? `↓${formatBytes(server.net_in_speed)}/s ↑${formatBytes(server.net_out_speed)}/s` : "离线",
          font: { size: 10 },
          textColor: online ? COL.dim : COL.red,
          maxLines: 1,
          minScale: 0.6,
        },
        { type: "text", text: `更新于 ${hhmm()}`, font: { size: 8 }, textColor: COL.dim2, textAlign: "center" },
      ],
    };
  }

  function buildMedium(server, flagDataUri) {
    const cpu = Number(server.cpu) || 0;
    const ram = percent(server.ram_used, server.ram_total);
    const disk = percent(server.disk_used, server.disk_total);
    const load = Number(server.load) || Number(server.load1) || 0;
    const loadPercent = clampPercent((load / 8) * 100); // scale load average onto a 0-100 bar
    const colW = 148;

    return {
      type: "widget",
      backgroundColor: COL.bg1,
      padding: 16,
      gap: 12,
      url: CONFIG.baseURL || undefined,
      refreshAfter: new Date(Date.now() + 60 * 1000).toISOString(),
      children: [
        headerRow(server, flagDataUri, 16, { w: 20, h: 15 }),
        divider(),
        {
          type: "stack",
          direction: "row",
          gap: 18,
          children: [
            metricBlock("cpu", "CPU", cpu, colW),
            metricBlock("memorychip", "内存", ram, colW),
          ],
        },
        {
          type: "stack",
          direction: "row",
          gap: 18,
          children: [
            metricBlock("internaldrive", "磁盘", disk, colW),
            metricBlock("gauge.medium", "负载", loadPercent, colW),
          ],
        },
      ],
    };
  }

  function buildLarge(server, flagDataUri) {
    const cpu = Number(server.cpu) || 0;
    const ram = percent(server.ram_used, server.ram_total);
    const disk = percent(server.disk_used, server.disk_total);
    const load = Number(server.load) || Number(server.load1) || 0;
    const loadPercent = clampPercent((load / 8) * 100);
    const colW = 158;

    const pingMs = firstDefined(server, PING_FIELD_CANDIDATES(CONFIG.isp));
    const lossPct = firstDefined(server, LOSS_FIELD_CANDIDATES(CONFIG.isp));
    const ispLabel = ISP_LABEL[CONFIG.isp] || "延迟";

    const trafficLimit = trafficLimitBytes(server.traffic_limit);
    const usedBytes = trafficUsedBytes(server);
    const trafficPct = trafficPercent(server);
    const trafficValueText = trafficLimit > 0
      ? `${formatBytes(usedBytes)} / ${formatBytes(trafficLimit)}`
      : `${formatBytes(usedBytes)} / ∞`;

    const children = [
      headerRow(server, flagDataUri, 19, { w: 24, h: 18 }),
      { type: "spacer", length: 4 },
      divider(),
      { type: "spacer", length: 12 },
      {
        type: "stack",
        direction: "row",
        gap: 20,
        children: [
          metricBlock("cpu", "CPU", cpu, colW),
          metricBlock("memorychip", "内存", ram, colW),
        ],
      },
      { type: "spacer", length: 14 },
      {
        type: "stack",
        direction: "row",
        gap: 20,
        children: [
          metricBlock("internaldrive", "磁盘", disk, colW),
          metricBlock("gauge.medium", "负载", loadPercent, colW),
        ],
      },
      { type: "spacer", length: 16 },
      divider(),
      { type: "spacer", length: 14 },
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        width: colW * 2 + 20,
        children: [
          { type: "image", src: "sf-symbol:cylinder.split.1x2", color: COL.dim, width: 13, height: 13 },
          { type: "text", text: "剩余流量", font: { size: 12, weight: "semibold" }, textColor: COL.dim, maxLines: 1 },
          { type: "spacer" },
          { type: "text", text: trafficValueText, font: { size: 15, weight: "bold" }, textColor: COL.fg, maxLines: 1 },
        ],
      },
      { type: "spacer", length: 8 },
      (() => {
        const bar = segmentedBarSvg(trafficPct, colW * 2 + 20, { color: COL.dim, square: 10, gap: 3 });
        return { type: "image", src: bar.src, width: bar.width, height: bar.height };
      })(),
      { type: "spacer", length: 16 },
      divider(),
      { type: "spacer", length: 14 },
      {
        type: "stack",
        direction: "row",
        gap: 20,
        children: [
          statBlock(
            "clock",
            `延迟(${ispLabel})`,
            pingMs === null ? "-" : `${Math.round(pingMs)} ms`,
            latencyMsColor(pingMs),
            pingMs === null ? 0 : clampPercent((pingMs / 300) * 100),
            COL.latency,
            colW
          ),
          statBlock(
            "antenna.radiowaves.left.and.right",
            `丢包率(${ispLabel})`,
            lossPct === null ? "-" : `${lossPct.toFixed(1)} %`,
            lossPctColor(lossPct),
            lossPct === null ? 0 : lossPct,
            lossPctColor(lossPct),
            colW
          ),
        ],
      },
      { type: "spacer" },
      { type: "text", text: `更新于 ${hhmm()}`, font: { size: 9 }, textColor: COL.dim2, textAlign: "right" },
    ];

    return {
      type: "widget",
      backgroundColor: COL.bg1,
      padding: 18,
      gap: 2,
      url: CONFIG.baseURL || undefined,
      refreshAfter: new Date(Date.now() + 60 * 1000).toISOString(),
      children,
    };
  }

  // ---------- main ----------

  if (!CONFIG.baseURL) {
    return errWidget("Set env BASE_URL first.");
  }
  if (!CONFIG.serverId) {
    return errWidget("Set env SERVER_ID first.");
  }

  let server;
  try {
    const resp = await ctx.http.get(
      `${CONFIG.baseURL}/api/server?id=${encodeURIComponent(CONFIG.serverId)}`,
      { timeout: 15000 }
    );
    const data = await resp.json();
    if (data && data.error) throw new Error(`${CONFIG.serverId}: ${data.error}`);
    server = data && data.data && typeof data.data === "object" ? data.data : data;
  } catch (e) {
    return errWidget("Request failed: " + (e && e.message ? e.message : String(e)));
  }

  const flagDataUri = await fetchFlagDataUri(server.region);

  if (accessory) return buildAccessory(server);
  if (small) return buildSmall(server, flagDataUri);
  if (large) return buildLarge(server, flagDataUri);
  return buildMedium(server, flagDataUri);
}
