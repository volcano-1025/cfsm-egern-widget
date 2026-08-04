/**
 * Egern Single Server Monitor Widget for CF-Server-Monitor
 * 特性：单机模式、自适应小/中/大尺寸、5级渐变调色盘、内联 SVG 进度条
 */

(async () => {
  const family = ctx.widgetFamily || 'systemMedium';
  const env = ctx.env || {};

  // 1. 读取环境变量配置
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
    CARD_BG: '#2C2C2E',      // 卡片/柱状图背景
    TEXT_MAIN: '#FFFFFF',
    TEXT_SUB: '#8E8E93'
  };

  // 5 级色阶映射逻辑
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

  // 格式化字节数 (B, KB, MB, GB, TB)
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  }

  // 转换国旗/地区 Emoji
  function getFlagEmoji(code) {
    if (!code || typeof code !== 'string') return '🌐';
    if (code.length !== 2) return code;
    const pts = code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0));
    return String.fromCodePoint(...pts);
  }

  // 动态绘制 SVG 进度条
  function createSvgBar(pct, color, w = 60, h = 5) {
    const val = Math.min(Math.max(pct || 0, 0), 100);
    const fillW = Math.round((val / 100) * w);
    const c = color.replace('#', '%23');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${h/2}" fill="%233A3A3C"/><rect width="${fillW}" height="${h}" rx="${h/2}" fill="${c}"/></svg>`;
    return `data:image/svg+xml;utf8,${svg}`;
  }

  // 异常/报错卡片渲染
  function renderError(message) {
    return {
      type: 'widget',
      padding: 16,
      backgroundColor: PALETTE.BG,
      children: [
        { type: 'spacer' },
        { type: 'text', text: '⚠️ 监控组件提示', font: { size: 14, weight: 'bold' }, textColor: PALETTE.RED },
        { type: 'spacer', length: 6 },
        { type: 'text', text: message, font: { size: 11 }, textColor: PALETTE.TEXT_SUB, maxLines: 4 },
        { type: 'spacer' }
      ]
    };
  }

  if (!BASE_URL) {
    const w = renderError('未配置 BASE_URL 环境变量，请在 Egern 小组件设置中填入站点地址。');
    if (typeof $widget !== 'undefined') $widget.set(w);
    return w;
  }

  // 3. 网络请求数据获取
  let serversData = [];
  try {
    const apiUrl = `${BASE_URL}/api/servers`;
    if (typeof fetch !== 'undefined') {
      const resp = await fetch(apiUrl);
      serversData = await resp.json();
    } else if (typeof $http !== 'undefined') {
      const resp = await $http.get(apiUrl);
      serversData = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
    }
  } catch (e) {
    const w = renderError(`无法连接 API 服务:\n${e.message || e}`);
    if (typeof $widget !== 'undefined') $widget.set(w);
    return w;
  }

  if (!Array.isArray(serversData) || serversData.length === 0) {
    const w = renderError('API 返回服务器列表为空');
    if (typeof $widget !== 'undefined') $widget.set(w);
    return w;
  }

  // 根据 SERVER_ID 匹配指定主机
  let server = serversData.find(s => String(s.id) === String(SERVER_ID) || String(s.name) === String(SERVER_ID));
  if (!server) server = serversData[0]; // 若未找到则默认回退展示第 1 台

  // 4. 解析与标准化所有 14 项数据
  const isOnline = server.online !== false;
  const serverName = server.name || server.id || '未知主机';
  const flag = getFlagEmoji(server.location || server.region || '');
  const updatedAtMs = (server.updated_at ? (server.updated_at > 1e11 ? server.updated_at : server.updated_at * 1000) : Date.now());

  // 算力与存储
  const cpuPct = typeof server.cpu === 'number' ? server.cpu : (server.cpu?.percent || 0);
  const memPct = server.mem?.percent ?? (server.mem ? (server.mem.used / server.mem.total * 100) : 0);
  const memUsedStr = formatBytes(server.mem?.used);
  const memTotalStr = formatBytes(server.mem?.total);
  const diskPct = server.disk?.percent ?? (server.disk ? (server.disk.used / server.disk.total * 100) : 0);
  const diskUsedStr = formatBytes(server.disk?.used);
  const diskTotalStr = formatBytes(server.disk?.total);

  // 5 分钟负载
  const load5 = Array.isArray(server.load) ? (server.load[1] ?? server.load[0] ?? 0) : (server.load5 || server.load || 0);

  // 在线天数
  const uptimeDays = Math.floor((server.uptime || 0) / 86400);

  // 到期时间处理
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

  // 流量使用
  const netUp = server.net?.total_up || server.network?.total_up || 0;
  const netDown = server.net?.total_down || server.network?.total_down || 0;
  const totalUsed = netUp + netDown;
  const transferMax = server.net?.transfer_max || server.network?.transfer_max || 0;
  const trafficStr = transferMax > 0 ? `${formatBytes(totalUsed)} / ${formatBytes(transferMax)}` : formatBytes(totalUsed);

  // Ping 延迟与丢包数据提取 (模糊匹配 ISP_LINE)
  let pingData = { latency: 0, latency_1h: 0, loss_1h: 0 };
  if (server.ping) {
    const lineKey = Object.keys(server.ping).find(k => k.toLowerCase().includes(ISP_LINE.toLowerCase())) || Object.keys(server.ping)[0];
    if (lineKey && server.ping[lineKey]) {
      const p = server.ping[lineKey];
      pingData.latency = p.latency || p.lat_1m || p['1m'] || 0;
      pingData.latency_1h = p.latency_1h || p.lat_1h || p['1h'] || pingData.latency;
      pingData.loss_1h = p.loss_1h || p.loss || p.packet_loss || 0;
    }
  }

  const linkUrl = `${BASE_URL}/#/server/${server.id || ''}`;

  // 动态色阶分配
  const cpuColor = getColor(cpuPct);
  const memColor = getColor(memPct);
  const diskColor = getColor(diskPct);
  const ping1mColor = getPingColor(pingData.latency);
  const ping1hColor = getPingColor(pingData.latency_1h);
  const lossColor = getLossColor(pingData.loss_1h);
  const statusColor = isOnline ? PALETTE.GREEN : PALETTE.RED;

  // ==========================================
  // 5. 根据小组件尺寸进行 DSL 构建
  // ==========================================

  // --- 小尺寸 (systemSmall) ---
  if (family === 'systemSmall') {
    const widget = {
      type: 'widget',
      padding: 10,
      gap: 6,
      backgroundColor: PALETTE.BG,
      url: linkUrl,
      children: [
        // 顶栏：地区/名字 + 在线状态
        {
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          children: [
            { type: 'text', text: `${flag} ${serverName}`, font: { size: 12, weight: 'bold' }, textColor: PALETTE.TEXT_MAIN, maxLines: 1 },
            { type: 'text', text: isOnline ? '🟢' : '🔴', font: { size: 9 } }
          ]
        },
        // 核心资源 2x2 网格
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
        // 线路与丢包
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
        // 流量与更新时间 Footer
        {
          type: 'stack',
          direction: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          children: [
            { type: 'text', text: trafficStr, font: { size: 8 }, textColor: PALETTE.TEXT_SUB, maxLines: 1 },
            { type: 'date', date: updatedAtMs, format: 'relative', font: { size: 8 }, textColor: PALETTE.TEXT_SUB }
          ]
        }
      ]
    };
    if (typeof $widget !== 'undefined') $widget.set(widget);
    return widget;
  }

  // --- 中尺寸 (systemMedium) ---
  if (family === 'systemMedium') {
    const widget = {
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
            // 左栏：主机基础 & 资源柱状图
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
                    { type: 'text', text: `${flag} ${serverName}`, font: { size: 13, weight: 'bold' }, textColor: PALETTE.TEXT_MAIN, maxLines: 1 },
                    { type: 'text', text: isOnline ? '🟢' : '🔴', font: { size: 9 } }
                  ]
                },
                { type: 'text', text: `5m Load: ${load5.toFixed(2)} | 在线 ${uptimeDays} 天`, font: { size: 9 }, textColor: PALETTE.TEXT_SUB },
                { type: 'spacer', length: 2 },
                // CPU
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
                // RAM
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
                // DISK
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
            // 右栏：网络指标 & 生命周期
            {
              type: 'stack',
              direction: 'column',
              flex: 1,
              gap: 4,
              children: [
                { type: 'text', text: `🌐 线路: ${ISP_LINE}`, font: { size: 11, weight: 'medium' }, textColor: PALETTE.GREEN },
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
                    { type: 'date', date: updatedAtMs, format: 'relative', font: { size: 8 }, textColor: PALETTE.TEXT_SUB }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
    if (typeof $widget !== 'undefined') $widget.set(widget);
    return widget;
  }

  // --- 大尺寸 (systemLarge) ---
  const widgetLarge = {
    type: 'widget',
    padding: 14,
    gap: 8,
    backgroundColor: PALETTE.BG,
    url: linkUrl,
    children: [
      // Header: 节点身份
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        children: [
          { type: 'text', text: `${flag} ${serverName}`, font: { size: 16, weight: 'bold' }, textColor: PALETTE.TEXT_MAIN },
          { type: 'text', text: isOnline ? '🟢 在线' : '🔴 离线', font: { size: 12, weight: 'bold' }, textColor: statusColor }
        ]
      },
      {
        type: 'stack',
        direction: 'row',
        gap: 12,
        children: [
          { type: 'text', text: `测速线路: ${ISP_LINE}`, font: { size: 11 }, textColor: PALETTE.GREEN },
          { type: 'text', text: `5m Load: ${load5.toFixed(2)}`, font: { size: 11 }, textColor: PALETTE.TEXT_SUB },
          { type: 'text', text: `连续在线: ${uptimeDays} 天`, font: { size: 11 }, textColor: PALETTE.TEXT_SUB }
        ]
      },
      { type: 'spacer', length: 4 },

      // 模块 1: 算力与存储
      { type: 'text', text: '核心资源占用', font: { size: 11, weight: 'medium' }, textColor: PALETTE.TEXT_SUB },
      // CPU
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        children: [
          { type: 'text', text: `CPU 占用`, font: { size: 12 }, textColor: PALETTE.TEXT_MAIN },
          { type: 'text', text: `${cpuPct.toFixed(1)}%`, font: { size: 12, weight: 'bold' }, textColor: cpuColor },
          { type: 'image', src: createSvgBar(cpuPct, cpuColor, 120, 6), width: 120, height: 6 }
        ]
      },
      // RAM
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        children: [
          { type: 'text', text: `内存占用`, font: { size: 12 }, textColor: PALETTE.TEXT_MAIN },
          { type: 'text', text: `${memPct.toFixed(1)}% (${memUsedStr})`, font: { size: 12, weight: 'bold' }, textColor: memColor },
          { type: 'image', src: createSvgBar(memPct, memColor, 120, 6), width: 120, height: 6 }
        ]
      },
      // DISK
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        children: [
          { type: 'text', text: `磁盘占用`, font: { size: 12 }, textColor: PALETTE.TEXT_MAIN },
          { type: 'text', text: `${diskPct.toFixed(1)}% (${diskUsedStr})`, font: { size: 12, weight: 'bold' }, textColor: diskColor },
          { type: 'image', src: createSvgBar(diskPct, diskColor, 120, 6), width: 120, height: 6 }
        ]
      },
      { type: 'spacer', length: 4 },

      // 模块 2: 网络质量 (3 列看板)
      { type: 'text', text: `网络质量与丢包 (${ISP_LINE})`, font: { size: 11, weight: 'medium' }, textColor: PALETTE.TEXT_SUB },
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
              { type: 'text', text: '1min 延迟', font: { size: 10 }, textColor: PALETTE.TEXT_SUB },
              { type: 'text', text: `${pingData.latency} ms`, font: { size: 14, weight: 'bold' }, textColor: ping1mColor }
            ]
          },
          {
            type: 'stack',
            direction: 'column',
            gap: 2,
            children: [
              { type: 'text', text: '1hr 延迟', font: { size: 10 }, textColor: PALETTE.TEXT_SUB },
              { type: 'text', text: `${pingData.latency_1h} ms`, font: { size: 14, weight: 'bold' }, textColor: ping1hColor }
            ]
          },
          {
            type: 'stack',
            direction: 'column',
            gap: 2,
            children: [
              { type: 'text', text: '1hr 丢包率', font: { size: 10 }, textColor: PALETTE.TEXT_SUB },
              { type: 'text', text: `${pingData.loss_1h}%`, font: { size: 14, weight: 'bold' }, textColor: lossColor }
            ]
          }
        ]
      },
      { type: 'spacer', length: 4 },

      // 模块 3: 流量与生命周期
      { type: 'text', text: '流量配额与生命周期', font: { size: 11, weight: 'medium' }, textColor: PALETTE.TEXT_SUB },
      {
        type: 'stack',
        direction: 'row',
        justifyContent: 'space-between',
        children: [
          { type: 'text', text: `流量情况: ${trafficStr}`, font: { size: 11 }, textColor: PALETTE.TEXT_MAIN },
          { type: 'text', text: `到期: ${expireStr} ${daysLeftStr}`, font: { size: 11 }, textColor: PALETTE.YELLOW }
        ]
      },
      { type: 'spacer' },

      // Footer
      {
        type: 'stack',
        direction: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        children: [
          { type: 'text', text: 'CF-Server-Monitor', font: { size: 9 }, textColor: PALETTE.TEXT_SUB },
          {
            type: 'stack',
            direction: 'row',
            gap: 2,
            children: [
              { type: 'text', text: '更新于 ', font: { size: 9 }, textColor: PALETTE.TEXT_SUB },
              { type: 'date', date: updatedAtMs, format: 'relative', font: { size: 9 }, textColor: PALETTE.TEXT_SUB }
            ]
          }
        ]
      }
    ]
  };

  if (typeof $widget !== 'undefined') $widget.set(widgetLarge);
  return widgetLarge;
})();
