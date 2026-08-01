// CF Server Monitor - Egern widget (adapted from ios-scriptable-widget.js)
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

export default async function (ctx) {
  const CONFIG = {
    baseURL: String(ctx.env.BASE_URL || "").replace(/\/+$/, ""),
    serverId: String(ctx.env.SERVER_ID || "").trim(),
  };

  const family = ctx.widgetFamily || "systemMedium";
  const large = family === "systemLarge" || family === "systemExtraLarge";
  const small = family === "systemSmall";
  const accessory = family.indexOf("accessory") === 0;

  const COL = {
    bg1: "#0d1117",
    bg2: "#161b22",
    fg: "#e6edf3",
    dim: "#8b949e",
    dim2: "#6e7681",
    green: "#3fb950",
    amber: "#d29922",
    red: "#f85149",
    blue: "#58a6ff",
    cyan: "#39d2c0",
    track: "rgba(255,255,255,0.12)",
  };

  // ---------- helpers (ported from the Scriptable version) ----------

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

  // Draw a rounded progress bar as an inline SVG data URI.
  function barSvg(value, width, height, color) {
    const p = clampPercent(value);
    const r = height / 2;
    const fw = Math.max(height, (width * p) / 100);
    return (
      `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'>` +
      `<rect x='0' y='0' width='${width}' height='${height}' rx='${r}' ry='${r}' fill='${COL.track}'/>` +
      `<rect x='0' y='0' width='${fw}' height='${height}' rx='${r}' ry='${r}' fill='${hexToRgb(color)}'/>` +
      `</svg>`
    );
  }

  // ---------- DSL builders ----------

  function metricColumn(label, value, width) {
    const p = clampPercent(value);
    const color = usageColor(value);
    return {
      type: "stack",
      direction: "column",
      alignItems: "start",
      gap: 6,
      width,
      children: [
        {
          type: "stack",
          direction: "row",
          alignItems: "center",
          width,
          children: [
            { type: "text", text: label, font: { size: 10, weight: "bold" }, textColor: COL.dim, maxLines: 1 },
            { type: "spacer" },
            { type: "text", text: `${Math.round(p)}%`, font: { size: 11, weight: "semibold" }, textColor: color, maxLines: 1 },
          ],
        },
        { type: "image", src: barSvg(value, width, 8, color), width, height: 8 },
      ],
    };
  }

  function fullBar(label, value, width, height) {
    const color = usageColor(value);
    return {
      type: "stack",
      direction: "row",
      alignItems: "center",
      gap: 6,
      children: [
        { type: "text", text: label, font: { size: 10, weight: "bold" }, textColor: COL.dim, maxLines: 1, width: 34 },
        { type: "image", src: barSvg(value, width, height, color), width, height },
        { type: "text", text: `${Math.round(clampPercent(value))}%`, font: { size: 10, weight: "semibold" }, textColor: color, maxLines: 1 },
      ],
    };
  }

  // Thin horizontal divider between sections.
  function divider() {
    return { type: "stack", height: 1, backgroundColor: "rgba(255,255,255,0.08)", children: [] };
  }

  // Small rounded status badge (online / offline).
  function statusPill(online) {
    const color = online ? COL.green : COL.red;
    return {
      type: "stack",
      direction: "row",
      alignItems: "center",
      padding: [3, 8, 3, 8],
      borderRadius: 8,
      backgroundColor: online ? "rgba(63,185,80,0.15)" : "rgba(248,81,73,0.15)",
      children: [
        { type: "text", text: online ? "ONLINE" : "OFFLINE", font: { size: 9, weight: "bold" }, textColor: color, maxLines: 1 },
      ],
    };
  }

  function headerRow(server, flagDataUri, nameFontSize, dotFontSize, flagSize) {
    const online = isOnline(server);
    const children = [
      { type: "text", text: "●", font: { size: dotFontSize }, textColor: online ? COL.green : COL.dim2, maxLines: 1 },
    ];
    if (flagDataUri) {
      children.push({ type: "image", src: flagDataUri, width: flagSize.w, height: flagSize.h, borderRadius: 2 });
    } else {
      const code = getFlagRegionCode(server.region);
      if (code) children.push({ type: "text", text: String(server.region).toUpperCase(), font: { size: 9, weight: "semibold" }, textColor: COL.dim, maxLines: 1 });
    }
    children.push({
      type: "text",
      text: serverName(server),
      font: { size: nameFontSize, weight: "bold" },
      textColor: COL.fg,
      maxLines: 1,
      minScale: 0.65,
      flex: 1,
    });
    return { type: "stack", direction: "row", alignItems: "center", gap: 6, children };
  }

  function headerRowPill(server, flagDataUri, nameFontSize, flagSize) {
    const online = isOnline(server);
    const children = [];
    if (flagDataUri) {
      children.push({
        type: "image",
        src: flagDataUri,
        width: flagSize.w,
        height: flagSize.h,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.15)",
      });
    } else {
      const code = getFlagRegionCode(server.region);
      if (code) children.push({ type: "text", text: String(server.region).toUpperCase(), font: { size: 9, weight: "semibold" }, textColor: COL.dim, maxLines: 1 });
    }
    children.push({
      type: "text",
      text: serverName(server),
      font: { size: nameFontSize, weight: "bold" },
      textColor: COL.fg,
      maxLines: 1,
      minScale: 0.65,
      flex: 1,
    });
    children.push(statusPill(online));
    return { type: "stack", direction: "row", alignItems: "center", gap: 8, children };
  }

  function netLine(label, value, color, symbol) {
    return {
      type: "stack",
      direction: "row",
      alignItems: "center",
      gap: 6,
      children: [
        { type: "image", src: `sf-symbol:${symbol}`, color, width: 13, height: 13 },
        {
          type: "stack",
          direction: "column",
          alignItems: "start",
          gap: 1,
          children: [
            { type: "text", text: label, font: { size: 9, weight: "semibold" }, textColor: COL.dim, maxLines: 1 },
            { type: "text", text: `${formatBytes(value)}/s`, font: { size: 13, weight: "bold" }, textColor: color, maxLines: 1, minScale: 0.7 },
          ],
        },
      ],
    };
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
        {
          type: "text",
          text: `${serverName(server)}: ${status}`,
          font: { size: "headline", weight: "semibold" },
          maxLines: 2,
          minScale: 0.6,
        },
      ],
    };
  }

  function buildSmall(server, flagDataUri) {
    const online = isOnline(server);
    const cpu = Number(server.cpu) || 0;
    const ram = percent(server.ram_used, server.ram_total);
    const disk = percent(server.disk_used, server.disk_total);

    return {
      type: "widget",
      backgroundGradient: { type: "linear", colors: [COL.bg1, COL.bg2] },
      padding: 13,
      gap: 8,
      url: CONFIG.baseURL || undefined,
      refreshAfter: new Date(Date.now() + 60 * 1000).toISOString(),
      children: [
        headerRow(server, flagDataUri, 14, 10, { w: 20, h: 15 }),
        divider(),
        { type: "spacer", length: 2 },
        fullBar("CPU", cpu, 78, 8),
        fullBar("RAM", ram, 78, 8),
        fullBar("DSK", disk, 78, 8),
        { type: "spacer" },
        {
          type: "stack",
          direction: "row",
          alignItems: "center",
          gap: 4,
          children: [
            { type: "image", src: `sf-symbol:${online ? "wifi" : "wifi.slash"}`, color: online ? COL.cyan : COL.dim2, width: 11, height: 11 },
            {
              type: "text",
              text: online ? `↓${formatBytes(server.net_in_speed)}/s ↑${formatBytes(server.net_out_speed)}/s` : "offline",
              font: { size: 10 },
              textColor: online ? COL.dim : COL.red,
              maxLines: 1,
              minScale: 0.6,
            },
          ],
        },
        { type: "text", text: `Updated ${hhmm()}`, font: { size: 8 }, textColor: COL.dim2, textAlign: "center" },
      ],
    };
  }

  function buildMediumOrLarge(server, flagDataUri) {
    const online = isOnline(server);
    const cpu = Number(server.cpu) || 0;
    const ram = percent(server.ram_used, server.ram_total);
    const disk = percent(server.disk_used, server.disk_total);
    const traffic = trafficPercent(server);
    const colW = large ? 86 : 76;

    const children = [
      headerRowPill(server, flagDataUri, large ? 19 : 17, { w: large ? 24 : 22, h: large ? 18 : 16 }),
      { type: "text", text: `Updated ${hhmm()}`, font: { size: 9 }, textColor: COL.dim2, maxLines: 1 },
      { type: "spacer", length: large ? 10 : 8 },
      divider(),
      { type: "spacer", length: large ? 14 : 11 },
      {
        type: "stack",
        direction: "row",
        gap: 10,
        children: [
          metricColumn("CPU", cpu, colW),
          metricColumn("RAM", ram, colW),
          metricColumn("DISK", disk, colW),
        ],
      },
    ];

    if (server.traffic_limit) {
      children.push({ type: "spacer", length: large ? 12 : 9 });
      children.push(fullBar("TRF", traffic, large ? 245 : 216, 8));
    }

    children.push({ type: "spacer" });
    children.push(divider());
    children.push({ type: "spacer", length: large ? 12 : 9 });
    children.push({
      type: "stack",
      direction: "row",
      gap: large ? 32 : 22,
      children: [
        { type: "stack", direction: "column", flex: 1, children: [netLine("DOWN", server.net_in_speed, online ? COL.cyan : COL.dim2, "arrow.down")] },
        { type: "stack", direction: "column", flex: 1, children: [netLine("UP", server.net_out_speed, online ? COL.blue : COL.dim2, "arrow.up")] },
      ],
    });

    return {
      type: "widget",
      backgroundGradient: { type: "linear", colors: [COL.bg1, COL.bg2] },
      padding: large ? 16 : 14,
      gap: 4,
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
  return buildMediumOrLarge(server, flagDataUri);
}
