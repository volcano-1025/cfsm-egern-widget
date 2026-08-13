/**
 * 假的 `/api/servers` 响应，字段与 CF-Server-Monitor 后端一致。
 *
 * 单位约定跟后端一样：`ram_*` / `disk_*` 是 MiB，速率与累计量是字节，
 * `last_updated` 是毫秒时间戳。
 *
 * 覆盖面（测试和预览都靠这份数据把边界跑出来）：
 * - 在线 / 离线（离线用 `is_online: false`，另一台用超过 5 分钟的 last_updated）
 * - 三网延迟齐全 / 部分为 null / 全为 null
 * - 隐藏节点（`is_hidden: "1"`）
 * - 两个 server_group
 * - 0% 与 100% 两个极端百分比
 * - 长名字（用来验证名称列的截断与缩放）
 */

const MINUTE = 60_000;

/** 固定基准时刻，让快照可复现；测试里把 Date.now() 也钉到这个值。 */
export const NOW = 1_770_000_000_000;

const GiB = 1024; // MiB → GiB 的换算，写百分比时更直观

function server(overrides) {
  return {
    id: "",
    name: "",
    server_group: "默认",
    tags: "",
    region: "HK",
    os: "debian",
    is_hidden: "0",
    sort_order: 0,
    cpu: 0,
    load_avg: "0.10 0.10 0.10",
    net_in_speed: 0,
    net_out_speed: 0,
    net_rx: 0,
    net_tx: 0,
    net_rx_monthly: 0,
    net_tx_monthly: 0,
    ram_total: 4 * GiB,
    ram_used: 0,
    swap_total: 0,
    swap_used: 0,
    disk_total: 40 * GiB,
    disk_used: 0,
    ping_ct: null,
    ping_cu: null,
    ping_cm: null,
    ping_bd: null,
    loss_ct: null,
    loss_cu: null,
    loss_cm: null,
    loss_bd: null,
    last_updated: NOW - MINUTE,
    ...overrides,
  };
}

export const SERVERS = [
  server({
    id: "hk-01",
    name: "HK-01",
    region: "HK",
    server_group: "亚洲",
    cpu: 42.4,
    ram_used: 1.24 * GiB,
    disk_used: 22 * GiB,
    net_in_speed: 12.3 * 1024 * 1024,
    net_out_speed: 4.5 * 1024 * 1024,
    net_rx_monthly: 820 * 1024 * 1024 * 1024,
    net_tx_monthly: 210 * 1024 * 1024 * 1024,
    ping_ct: 38,
    ping_cu: 52,
    ping_cm: 74,
    ping_bd: 21,
    loss_ct: 0,
    loss_cu: 0,
    loss_cm: 0,
    is_online: true,
  }),
  server({
    id: "jp-tokyo",
    // 故意长名，检验名称列的 maxLines/minScale 是否够用
    name: "JP-Tokyo-BandwagonHost-KVM",
    region: "JP",
    server_group: "亚洲",
    cpu: 18,
    ram_used: 1.76 * GiB,
    disk_used: 17.6 * GiB,
    net_in_speed: 640 * 1024,
    net_out_speed: 210 * 1024,
    // 只有电信一条线路有值，另两条为 null
    ping_ct: 61,
    loss_ct: 2,
    is_online: true,
  }),
  server({
    id: "us-la",
    name: "US-LA",
    region: "US",
    server_group: "美洲",
    // 100% 极端值：满载 CPU、内存与磁盘写满
    cpu: 100,
    ram_used: 4 * GiB,
    ram_total: 4 * GiB,
    disk_used: 40 * GiB,
    disk_total: 40 * GiB,
    net_in_speed: 3.2 * 1024 * 1024,
    net_out_speed: 980 * 1024,
    ping_ct: 152,
    ping_cu: 168,
    ping_cm: 210,
    loss_ct: 1.5,
    loss_cu: 0,
    loss_cm: 8,
    is_online: true,
  }),
  server({
    id: "sg-01",
    name: "SG-01",
    region: "SG",
    server_group: "亚洲",
    // 0% 极端值：全空闲
    cpu: 0,
    ram_used: 0,
    disk_used: 0,
    net_in_speed: 0,
    net_out_speed: 0,
    ping_ct: 89,
    ping_cu: 95,
    ping_cm: 91,
    is_online: true,
  }),
  server({
    id: "de-fra",
    name: "DE-FRA",
    region: "DE",
    server_group: "欧洲",
    cpu: 7,
    ram_used: 0.9 * GiB,
    disk_used: 12 * GiB,
    // 明确离线
    is_online: false,
    last_updated: NOW - 40 * MINUTE,
  }),
  server({
    id: "ru-mow",
    name: "RU-MOW",
    region: "RU",
    server_group: "欧洲",
    cpu: 3,
    ram_used: 0.4 * GiB,
    disk_used: 8 * GiB,
    // 没有 is_online 字段，只能靠 last_updated 超过 5 分钟阈值判离线
    last_updated: NOW - 12 * MINUTE,
  }),
  server({
    id: "kr-icn",
    name: "KR-ICN",
    region: "KR",
    server_group: "亚洲",
    cpu: 55,
    ram_used: 2.2 * GiB,
    disk_used: 30 * GiB,
    ping_ct: 44,
    ping_cu: 47,
    ping_cm: 250,
    is_online: true,
  }),
  server({
    id: "uk-lon",
    name: "UK-LON",
    region: "GB",
    server_group: "欧洲",
    cpu: 29,
    ram_used: 1.1 * GiB,
    disk_used: 19 * GiB,
    ping_ct: 190,
    is_online: true,
  }),
  server({
    id: "ca-tor",
    name: "CA-TOR",
    region: "CA",
    server_group: "美洲",
    cpu: 12,
    ram_used: 0.7 * GiB,
    disk_used: 9 * GiB,
    ping_ct: 205,
    is_online: true,
  }),
  server({
    id: "hidden-01",
    name: "内部机",
    region: "TW",
    server_group: "亚洲",
    is_hidden: "1",
    cpu: 99,
    is_online: true,
  }),
];

/** 与后端一致：stats 由后端算好下发，这里按同样口径生成。 */
export function buildSnapshot(servers = SERVERS) {
  const visible = servers;
  const online = visible.filter(
    (s) => (typeof s.is_online === "boolean" ? s.is_online : NOW - s.last_updated < 300_000),
  );
  return {
    servers: visible,
    latestReportUpdates: [],
    stats: {
      total: visible.length,
      online: online.length,
      offline: visible.length - online.length,
      globalSpeedIn: online.reduce((sum, s) => sum + s.net_in_speed, 0),
      globalSpeedOut: online.reduce((sum, s) => sum + s.net_out_speed, 0),
      globalNetRx: 1.24 * 1024 ** 4,
      globalNetTx: 340 * 1024 ** 3,
    },
    regionStats: {},
    sysConfig: { show_price: true, show_expire: true, show_tf: true, show_time: true },
  };
}
