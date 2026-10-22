// CF-Server-Monitor 小组件 · Scriptable 版
// https://github.com/volcano-1025/cfsm-egern-widget
//
// 整段粘进 Scriptable 的新脚本里，只改下面 CONFIG 这一块。
// Scriptable 没有环境变量：这里填的是所有小组件共用的配置（相当于 Egern 填在脚本上的 env），
// 每个小组件自己的差异填在主屏「编辑小组件 → Parameter」里，写法是 KEY=值，多条用分号隔开，
// 例如 NODE=hk-01; CARRIER=电信 。可填的 key 和 Egern 版完全一样，见 README。

const CONFIG = {
  API_BASE: "", // 面板地址，只写 origin，例如 https://status.example.com
};

// ---- 下面不用改 ----
// 真正的代码从仓库下载并缓存在本机，一天最多更新一次；在 App 里手动运行一次会立刻更新。

const REPO = "https://raw.githubusercontent.com/volcano-1025/cfsm-egern-widget/main/";
const FILES = ["scriptable/runtime.js", "cfsm-status.js"];
const MAX_AGE_MS = 24 * 3600 * 1000;

const fm = FileManager.local();
const cacheDir = fm.joinPath(fm.documentsDirectory(), "cfsm-widget");
if (!fm.fileExists(cacheDir)) fm.createDirectory(cacheDir, true);

async function load(file, force) {
  const path = fm.joinPath(cacheDir, file.replace(/\//g, "_"));
  const cached = fm.fileExists(path);
  if (cached && !force && Date.now() - fm.modificationDate(path).getTime() < MAX_AGE_MS) {
    return fm.readString(path);
  }
  try {
    const request = new Request(REPO + file);
    request.timeoutInterval = 20;
    const text = await request.loadString();
    if (request.response.statusCode !== 200) throw new Error(`HTTP ${request.response.statusCode}`);
    fm.writeString(path, text);
    return text;
  } catch (error) {
    // 下载失败就用旧缓存顶着，总比一块报错强；从来没下载成功过才真的报错。
    if (cached) return fm.readString(path);
    throw new Error(`下载 ${file} 失败：${error.message}`);
  }
}

try {
  const [runtime, coreSource] = await Promise.all(FILES.map((f) => load(f, config.runsInApp)));
  await new Function(runtime)().run({ settings: CONFIG, coreSource, parameter: args.widgetParameter });
} catch (error) {
  const widget = new ListWidget();
  const line = widget.addText(`CFSM 小组件加载失败\n${error.message}`);
  line.font = Font.systemFont(11);
  line.textColor = Color.red();
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}
