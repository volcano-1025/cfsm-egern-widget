/**
 * Egern Single Server Monitor Widget for CF-Server-Monitor
 * 已修复：全局异常兜底（彻底解决 Missing required key 'type' at $ 报错）
 */

export default async function(ctx) {
  // 最外层全局 try-catch 兜底，确保无论发生何种错误，均 100% 返回带 type: 'widget' 的对象
  try {
    const family = ctx?.widgetFamily || 'systemMedium';
    const env = ctx?.env || {};

    // 1. 读取环境变量
    const BASE_URL = (env.BASE_URL || '').replace(/\/+$/, '');
    const SERVER_ID = env.SERVER_ID || '';
    const ISP_LINE = env.ISP_LINE || '默认';

    // 2. 状态调色盘 (绿色 -> 嫩绿色 -> 黄绿色 -> 黄色 -> 红色)
    const PALETTE = {
      GREEN: '#34C759',        // 级别 1 (极佳/低占用)
      LIGHT_GREEN: '#30D158',  // 级别 2 (良好/轻度)
      YELLOW_GREEN: '#A2E048', // 级别 3 (中度)
      YELLOW: '#FFCC00',       // 级别 4 (预警)
      RED: '#FF3B30',          // 级别 5 (严重/高占用/离线)
      BG: '#1C1C1E',           // 暗色背景
      TEXT_MAIN: '#FFFFFF',
      TEXT_SUB: '#8E8E93'
    };

    // 色阶映射
    function getColor(val, thresholds = [20, 40, 65, 85]) {
      if (val === undefined || val === null || isNaN(val)) return PALETTE.GREEN;
      if (val < thresholds[0]) return PALETTE.GREEN;
      if (val < thresholds[1]) return PALETTE.LIGHT_GREEN;
      if (val < thresholds[2]) return PALETTE.YELLOW_GREEN;
      if (val < thresholds[3]) return PALETTE.YELLOW;
      return PALETTE.RED;
    }

    function getPingColor(ms) { return getColor(ms, [30, 70, 130, 220]); }
    function getLossColor(loss) { return getColor(loss, [0.1, 0.5, 2.0, 5.0]); }

    // 格式化字节
    function formatBytes(bytes) {
      if (!bytes || bytes <= 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
    }

    // 安全转换国旗/地区 Emoji (防护中文及非法字符)
    function getFlagEmoji(code) {
      if (!code || typeof code !== 'string') return '🌐';
      const trimmed = code.trim();
      if (/^[A-Za-z]{2}$/.test(trimmed)) {
        const pts = trimmed.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0));
        try {
          return String.fromCodePoint(...pts);
        } catch (e) {
          return trimmed;
        }
      }
      return trimmed;
    }

    // 绘制标准内联 SVG 进度条
    function createSvgBar(pct, color, w = 60, h = 5) {
      const val = Math.min(Math.max(pct || 0, 0), 100);
      const fillW = Math.round((val / 100) * w);
      const c = color.replace('#', '%23');
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' width='${w}' height='${h}'><rect width='${w}' height='${h}' rx='${h/2}' fill='%233A3A3C'/><rect width='${fillW}' height='${h}' rx='${h/2}' fill='${c}'/></svg>`;
      return `data:image/svg+xml,${svg}`;
    }

    // 错误卡片构造器
    function renderErrorCard(message) {
      return {
        type: 'widget',
        padding: 16,
        backgroundColor: PALETTE.BG,
        children: [
          { type: 'spacer' },
          { type: 'text', text: '⚠️ 监控组件提示', font: { size: 'headline', weight: 'bold' }, textColor: PALETTE.RED },
          { type: 'spacer', length: 6 },
          { type: 'text', text: String(message), font: { size: 'footnote' }, textColor: PALETTE.TEXT_SUB, maxLines: 4 },
          { type: 'spacer' }
        ]
      };
    }

    if (!BASE_URL) {
      return renderErrorCard('未配置 BASE_URL 环境变量，请在 Egern 的环境变量中配置 BASE_URL。');
    }

    // 3. 安全请求网络数据
    let serversData = [];
    try {
      const apiUrl = `${BASE_URL}/api/servers`;
      const resp = await ctx.http.get(apiUrl, { timeout: 10000 });
      if (resp.status < 200 || resp.status >= 300) {
        return renderErrorCard(`API 状态码非 200: HTTP ${resp.status}`);
      }
      serversData = await resp.json();
    } catch (e) {
      return renderErrorCard(`无法连接 API (${BASE_URL}):\n${e?.message || e}`);
    }

    if (!Array.isArray(serversData) || serversData.length === 0) {
      return renderErrorCard('API 返回数据为空或格式不正确。');
    }

    // 匹配 SERVER_ID
    let server = serversData.find(s => String(s.id) === String(SERVER_ID) || String(s.name) === String(SERVER_ID));
    if (!server) server = serversData[0];

    // 4. 数据标准化解析
    const isOnline = server.online !== false;
    const serverName = server.name || server.id || '未知主机';
    const flag = getFlagEmoji(server.location || server.region || '');

    let updatedAtIso = new Date().toISOString();
    if (server.updated_at) {
      const ts = server.updated_at > 1e11 ? server.updated_at : server.updated_at * 1000;
      updatedAtIso = new Date(ts).toISOString();
    }

    // 算力与存储
    const cpuPct = typeof server.cpu === 'number' ? server.cpu : (server.cpu?.percent || 0);
    const memPct = server.mem?.percent ?? (server.mem ? (server.mem.used / server.mem.total * 100) : 0);
    const memUsedStr = formatBytes(server.mem?.used);
    const diskPct = server.disk?.percent ?? (server.disk ? (server.disk.used / server.disk.total * 100) : 0);
    const diskUsedStr = formatBytes(server.disk?.used);

    // 负载 & 在线天数
    const load5 = Array.isArray(server.load) ? (server.load[1] ?? server.load[0] ?? 0) : (server.load5 || server.load || 0);
    const uptimeDays = Math.floor((server.uptime || 0) / 86400);

    // 到期时间
    let expireStr = '永久';
    let daysLeftStr = '';
    if (server.expire_at || server.expired_at) {
      const expTs = (server.expire_at || server.expired_at);
      const expMs = expTs > 1e11 ? expTs : expTs * 1000;
      const expDate = new Date(expMs);
      expireStr = `${expDate.getFullYear()}-${String(expDate.getMonth()+1).padStart(2,'0')}-${String(expDate.getDate()).padStart(2,'0')}`;
      const diffDays = Math.ceil((expMs - Date.now()) / (1000 * 3600 * 24));
      daysLeftStr = diffDays > 0 ? `(剩 ${diffDays} 天)` : '(已到期)';
    }

    // 流量
    const netUp = server.net?.total_up || server.network?.total_up || 0;
    const netDown = server.net?.total_down || server.network?.total_down || 0;
    const totalUsed = netUp + netDown;
    const transferMax = server.net?.transfer_max || server.network?.transfer_max || 0;
    const trafficStr = transferMax > 0 ? `${formatBytes(totalUsed)} / ${formatBytes(transferMax)}` : formatBytes(totalUsed);

    // Ping & 丢包率提取
    let pingData = { latency: 0, latency_1h: 0, loss_1h: 0 };
    if (server.ping && typeof server.ping === 'object') {
      const lineKey = Object.keys(server.ping).find(k => k.toLowerCase().includes(ISP_LINE.toLowerCase())) || Object.keys(server.ping)[0];
      if (lineKey && server.ping[lineKey]) {
        const p = server.ping[lineKey];
        pingData.latency = p.latency || p.lat_1m || p['1m'] || 0;
        pingData.latency_1h = p.latency_1h || p.lat_1h || p['1h'] || pingData.latency;
        pingData.loss_1h = p.loss_1h || p.loss || p.packet_loss || 0;
      }
    }

    const linkUrl = `${BASE_URL}/#/server/${server.id || ''}`;

    // 颜色计算
    const cpuColor = getColor(cpuPct);
    const memColor = getColor(memPct);
    const diskColor = getColor(diskPct);
    const ping1mColor = getPingColor(pingData.latency);
    const ping1hColor = getPingColor(pingData.latency_1h);
    const lossColor = getLossColor(pingData.loss_1h);
    const statusColor = isOnline ? PALETTE.GREEN : PALETTE.RED;

    // ==========================================
    // 5. 根据尺寸生成小组件 DSL
    // ==========================================

    // --- 小尺寸 (systemSmall) ---
    if (family === 'systemSmall') {
      return {
        type: 'widget',
        padding: 10,
        gap: 6,
        backgroundColor: PALETTE.BG,
        url: linkUrl,
        children: [
          {
            type: 'stack',
            direction: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            children: [
              { type: 'text', text: `${flag} ${serverName}`, font: { size: 'footnote', weight: 'bold' }, textColor: PALETTE.TEXT_MAIN, maxLines: 1 },
              { type: 'text', text: isOnline ? '🟢' : '🔴', font: { size: 9 } }
            ]
          },
          {
            type: 'stack',
            direction: 'row',
            justifyContent: 'space-between',
            children: [
              { type: 'text', text: `CPU: ${cpuPct.toFixed(0)}%`, font: { size: 10, weight: 'medium' }, textColor: cpuColor },
              { type: 'text', text: `RAM: ${memPct.toFixed(0)}%`, font: { size: 10, weight: 'medium' }, textColor: memColor }
            ]
          },
          {
            type: 'stack',
            direction: 'row',
            justifyContent: 'space-between',
            children: [
              { type: 'text', text: `Disk: ${diskPct.toFixed(0)}%`, font: { size: 10, weight: 'medium' }, textColor: diskColor },
              { type: 'text', text: `${pingData.latency}ms`, font: { size: 10, weight: 'bold' }, textColor: ping1mColor }
            ]
          },
          {
            type: 'stack',
            direction: 'row',
            justifyContent: 'space-between',
            children: [
              { type: 'text', text: `${ISP_LINE}`, font: { size: 9 }, textColor: PALETTE.TEXT_SUB },
              { type: 'text', text: `丢包:${pingData.loss_1h}%`, font: { size: 9 }, textColor: lossColor }
            ]
          },
          { type: 'spacer' },
          {
            type: 'stack',
            direction: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            children: [
              { type: 'text', text: trafficStr, font: { size: 8 }, textColor: PALETTE.TEXT_SUB, maxLines: 1 },
              { type: 'date', date: updatedAtIso, format: 'relative', font: { size: 8 }, textColor: PALETTE.TEXT_SUB }
            ]
          }
        ]
      };
    }

    // --- 中尺寸 (systemMedium) ---
    if (family === 'systemMedium') {
      return {
        type: 'widget',
        padding: 12,
        backgroundColor: PALETTE.BG,
        url: linkUrl,
        children: [
          {
            type: 'stack',
            direction: 'row',
            gap: 12,
            flex: 1,
            children: [
              // 左栏
              {
                type: 'stack',
                direction: 'column',
                flex: 1,
                gap: 4,
                children: [
                  {
                    type: 'stack',
                    direction: 'row',
                    alignItems: 'center',
                    gap: 4,
                    children: [
                      { type: 'text', text: `${flag} ${serverName}`, font: { size: 'subheadline', weight: 'bold' }, textColor: PALETTE.TEXT_MAIN, maxLines: 1 },
                      { type: 'text', text: isOnline ? '🟢' : '🔴', font: { size: 9 } }
                    ]
                  },
                  { type: 'text', text: `5m Load: ${load5.toFixed(2)} | 在线 ${uptimeDays} 天`, font: { size: 9 }, textColor: PALETTE.TEXT_SUB },
                  { type: 'spacer', length: 2 },
                  {
                    type: 'stack',
                    direction: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    children: [
                      { type: 'text', text: `CPU ${cpuPct.toFixed(1)}%`, font: { size: 10 }, textColor: cpuColor },
                      { type: 'image', src: createSvgBar(cpuPct, cpuColor, 65, 5), width: 65, height: 5 }
                    ]
                  },
                  {
                    type: 'stack',
                    direction: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    children: [
                      { type: 'text', text: `RAM ${memPct.toFixed(1)}%`, font: { size: 10 }, textColor: memColor },
                      { type: 'image', src: createSvgBar(memPct, memColor, 65, 5), width: 65, height: 5 }
                    ]
                  },
                  {
                    type: 'stack',
                    direction: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    children: [
                      { type: 'text', text: `DISK ${diskPct.toFixed(1)}%`, font: { size: 10 }, textColor: diskColor },
                      { type: 'image', src: createSvgBar(diskPct, diskColor, 65, 5), width: 65, height: 5 }
                    ]
                  }
                ]
              },
              // 右栏
              {
                type: 'stack',
                direction: 'column',
                flex: 1,
                gap: 4,
                children: [
                  { type: 'text', text: `🌐 线路: ${ISP_LINE}`, font: { size: 'footnote', weight: 'medium' }, textColor: PALETTE.GREEN },
                  { type: 'spacer', length: 2 },
                  {
                    type: 'stack',
                    direction: 'row',
                    justifyContent: 'space-between',
                    children: [
                      { type: 'text', text: `延迟(1m/1h):`, font: { size: 10 }, textColor: PALETTE.TEXT_SUB },
                      { type: 'text', text: `${pingData.latency}/${pingData.latency_1h}ms`, font: { size: 10, weight: 'bold' }, textColor: ping1mColor }
                    ]
                  },
                  {
                    type: 'stack',
                    direction: 'row',
                    justifyContent: 'space-between',
                    children: [
                      { type: 'text', text: `丢包率(1h):`, font: { size: 10 }, textColor: PALETTE.TEXT_SUB },
                      { type: 'text', text: `${pingData.loss_1h}%`, font: { size: 10, weight: 'bold' }, textColor: lossColor }
                    ]
                  },
                  { type: 'text', text: `流量: ${trafficStr}`, font: { size: 10 }, textColor: PALETTE.TEXT_MAIN, maxLines: 1 },
                  { type: 'text', text: `到期: ${expireStr} ${daysLeftStr}`, font: { size: 9 }, textColor: PALETTE.YELLOW, maxLines: 1 },
                  { type: 'spacer' },
                  {
                    type: 'stack',
                    direction: 'row',
                    justifyContent: 'flex-end',
                    children: [
                      { type: 'date', date: updatedAtIso, format: 'relative', font: { size: 8 }, textColor: PALETTE.TEXT_SUB }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };
    }

    // --- 大尺寸 (systemLarge) ---
    return {
      type: 'widget',
      padding: 14,
      gap: 8,
      backgroundColor: PALETTE.BG,
      url: linkUrl,
      children: [
        {
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          children: [
            { type: 'text', text: `${flag} ${serverName}`, font: { size: 'headline', weight: 'bold' }, textColor: PALETTE.TEXT_MAIN },
            { type: 'text', text: isOnline ? '🟢 在线' : '🔴 离线', font: { size: 'caption1', weight: 'bold' }, textColor: statusColor }
          ]
        },
        {
          type: 'stack',
          direction: 'row',
          gap: 12,
          children: [
            { type: 'text', text: `测速线路: ${ISP_LINE}`, font: { size: 'footnote' }, textColor: PALETTE.GREEN },
            { type: 'text', text: `5m Load: ${load5.toFixed(2)}`, font: { size: 'footnote' }, textColor: PALETTE.TEXT_SUB },
            { type: 'text', text: `连续在线: ${uptimeDays} 天`, font: { size: 'footnote' }, textColor: PALETTE.TEXT_SUB }
          ]
        },
        { type: 'spacer', length: 4 },

        { type: 'text', text: '核心资源占用', font: { size: 'footnote', weight: 'medium' }, textColor: PALETTE.TEXT_SUB },
        {
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          children: [
            { type: 'text', text: `CPU 占用`, font: { size: 'subheadline' }, textColor: PALETTE.TEXT_MAIN },
            { type: 'text', text: `${cpuPct.toFixed(1)}%`, font: { size: 'subheadline', weight: 'bold' }, textColor: cpuColor },
            { type: 'image', src: createSvgBar(cpuPct, cpuColor, 120, 6), width: 120, height: 6 }
          ]
        },
        {
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          children: [
            { type: 'text', text: `内存占用`, font: { size: 'subheadline' }, textColor: PALETTE.TEXT_MAIN },
            { type: 'text', text: `${memPct.toFixed(1)}% (${memUsedStr})`, font: { size: 'subheadline', weight: 'bold' }, textColor: memColor },
            { type: 'image', src: createSvgBar(memPct, memColor, 120, 6), width: 120, height: 6 }
          ]
        },
        {
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          children: [
            { type: 'text', text: `磁盘占用`, font: { size: 'subheadline' }, textColor: PALETTE.TEXT_MAIN },
            { type: 'text', text: `${diskPct.toFixed(1)}% (${diskUsedStr})`, font: { size: 'subheadline', weight: 'bold' }, textColor: diskColor },
            { type: 'image', src: createSvgBar(diskPct, diskColor, 120, 6), width: 120, height: 6 }
          ]
        },
        { type: 'spacer', length: 4 },

        { type: 'text', text: `网络质量与丢包 (${ISP_LINE})`, font: { size: 'footnote', weight: 'medium' }, textColor: PALETTE.TEXT_SUB },
        {
          type: 'stack',
          direction: 'row',
          justifyContent: 'space-between',
          children: [
            {
              type: 'stack',
              direction: 'column',
              gap: 2,
              children: [
                { type: 'text', text: '1min 延迟', font: { size: 'caption2' }, textColor: PALETTE.TEXT_SUB },
                { type: 'text', text: `${pingData.latency} ms`, font: { size: 'callout', weight: 'bold' }, textColor: ping1mColor }
              ]
            },
            {
              type: 'stack',
              direction: 'column',
              gap: 2,
              children: [
                { type: 'text', text: '1hr 延迟', font: { size: 'caption2' }, textColor: PALETTE.TEXT_SUB },
                { type: 'text', text: `${pingData.latency_1h} ms`, font: { size: 'callout', weight: 'bold' }, textColor: ping1hColor }
              ]
            },
            {
              type: 'stack',
              direction: 'column',
              gap: 2,
              children: [
                { type: 'text', text: '1hr 丢包率', font: { size: 'caption2' }, textColor: PALETTE.TEXT_SUB },
                { type: 'text', text: `${pingData.loss_1h}%`, font: { size: 'callout', weight: 'bold' }, textColor: lossColor }
              ]
            }
          ]
        },
        { type: 'spacer', length: 4 },

        { type: 'text', text: '流量配额与生命周期', font: { size: 'footnote', weight: 'medium' }, textColor: PALETTE.TEXT_SUB },
        {
          type: 'stack',
          direction: 'row',
          justifyContent: 'space-between',
          children: [
            { type: 'text', text: `流量情况: ${trafficStr}`, font: { size: 'footnote' }, textColor: PALETTE.TEXT_MAIN },
            { type: 'text', text: `到期: ${expireStr} ${daysLeftStr}`, font: { size: 'footnote' }, textColor: PALETTE.YELLOW }
          ]
        },
        { type: 'spacer' },

        {
          type: 'stack',
          direction: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          children: [
            { type: 'text', text: 'CF-Server-Monitor', font: { size: 'caption2' }, textColor: PALETTE.TEXT_SUB },
            {
              type: 'stack',
              direction: 'row',
              gap: 2,
              children: [
                { type: 'text', text: '更新于 ', font: { size: 'caption2' }, textColor: PALETTE.TEXT_SUB },
                { type: 'date', date: updatedAtIso, format: 'relative', font: { size: 'caption2' }, textColor: PALETTE.TEXT_SUB }
              ]
            }
          ]
        }
      ]
    };

  } catch (fatalErr) {
    // 顶层致命异常兜底：若有任何未捕获错误，在此返回红字提示卡片，绝不返回 undefined
    return {
      type: 'widget',
      padding: 16,
      backgroundColor: '#1C1C1E',
      children: [
        { type: 'spacer' },
        { type: 'text', text: '⚠️ 监控小组件运行异常', font: { size: 'headline', weight: 'bold' }, textColor: '#FF3B30' },
        { type: 'spacer', length: 6 },
        { type: 'text', text: String(fatalErr?.message || fatalErr), font: { size: 'footnote' }, textColor: '#8E8E93', maxLines: 4 },
        { type: 'spacer' }
      ]
    };
  }
}
