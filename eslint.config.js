import js from "@eslint/js";
import globals from "globals";

const SCRIPTABLE_GLOBALS = Object.fromEntries(
  [
    "Alert",
    "Color",
    "FileManager",
    "Font",
    "LinearGradient",
    "ListWidget",
    "Point",
    "Request",
    "Script",
    "Size",
    "args",
    "config",
  ].map((name) => [name, "readonly"]),
);

export default [
  { ignores: ["node_modules", "preview.html"] },
  js.configs.recommended,
  {
    // cfsm-status.js 跑在 Egern 的 JS 运行时里：没有 DOM，也没有 Node 的 fs/process，
    // 只有 ctx 与标准内置对象。这里只给 ES 内置全局，避免误用宿主没有的 API。
    files: ["cfsm-status.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.es2021,
    },
  },
  {
    // Scriptable 的 JS 运行时：标准内置对象 + Scriptable 自己的全局 API，没有 DOM / Node。
    // runtime.js 由加载器用 new Function 执行，是一个函数体（末尾有顶层 return），所以按 commonjs 解析；
    // loader.js 是直接粘进 App 的脚本，用了顶层 await，按 module 解析。
    files: ["scriptable/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.es2021, ...SCRIPTABLE_GLOBALS },
    },
  },
  { files: ["scriptable/runtime.js"], languageOptions: { sourceType: "commonjs" } },
  { files: ["scriptable/loader.js"], languageOptions: { sourceType: "module" } },
  {
    files: ["tools/**/*.mjs", "test/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2021 },
    },
  },
];
