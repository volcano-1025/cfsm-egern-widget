import js from "@eslint/js";
import globals from "globals";

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
    files: ["tools/**/*.mjs", "test/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2021 },
    },
  },
];
