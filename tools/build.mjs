// 把 src 下的 ESM 模块按固定拓扑序拼成单文件 user.js（零第三方依赖）。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { douyinAdapter } from "../src/platforms/douyin/adapter.js";
import { bilibiliAdapter } from "../src/platforms/bilibili/adapter.js";
import { xiaohongshuAdapter } from "../src/platforms/xiaohongshu/adapter.js";
import { youtubeAdapter } from "../src/platforms/youtube/adapter.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 更新源：GitHub Releases 固定别名（latest/download/<asset>），换版本只需重发同名资产，
// 脚本头的 URL 不用改。dist/ 不入库，必须发到 Releases 才能被 TM 拉取。
const UPDATE_URL = "https://github.com/bsawang/video-downloader/releases/latest/download/douyin.user.js";

// 顺序即依赖序：被依赖者在前。
const ORDER = [
  "kernel/extract.js",
  "kernel/store.js",
  "kernel/hook.js",
  "kernel/mount.js",
  "kernel/ui.js",
  "kernel/merge.js",
  "kernel/download.js",
  "kernel/core.js",
  "platforms/douyin/rules.js",
  "platforms/douyin/adapter.js",
  "platforms/bilibili/rules.js",
  "platforms/bilibili/adapter.js",
  "platforms/xiaohongshu/rules.js",
  "platforms/xiaohongshu/adapter.js",
  "platforms/youtube/rules.js",
  "platforms/youtube/adapter.js",
  "entry/tm.js",
];

const DECL = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;

function stripModuleSyntax(source, file) {
  const lines = source.split("\n");
  const out = [];
  for (const line of lines) {
    if (/^\s*import\s/.test(line)) continue;
    if (/^\s*export\s*\{/.test(line)) throw new Error(`${file}: 不支持 export {} 形式`);
    out.push(line.replace(/^(\s*)export\s+/, "$1"));
  }
  return out.join("\n");
}

export function build() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const chunks = [];
  const declared = new Map();

  for (const rel of ORDER) {
    const file = path.join(ROOT, "src", rel);
    const code = stripModuleSyntax(readFileSync(file, "utf8"), rel);
    for (const line of code.split("\n")) {
      const m = line.match(DECL);
      if (!m) continue;
      if (declared.has(m[1])) {
        throw new Error(`顶层重复声明 ${m[1]}: ${declared.get(m[1])} 与 ${rel}`);
      }
      declared.set(m[1], rel);
    }
    chunks.push(`// ---- ${rel} ----\n${code.trim()}`);
  }

  const matches = [
    ...new Set([
      ...douyinAdapter.matches,
      ...bilibiliAdapter.matches,
      ...xiaohongshuAdapter.matches,
      ...youtubeAdapter.matches,
    ]),
  ];
  const matchLines = matches.map((m) => `// @match        ${m}`).join("\n");
  const header = [
    "// ==UserScript==",
    "// @name         短视频下载器",
    "// @namespace    https://github.com/bsawang/video-downloader",
    `// @version      ${pkg.version}`,
    "// @description  页面附着的视频下载（抖音/B站/小红书/YouTube，无后端）",
    `// @updateURL    ${UPDATE_URL}`,
    `// @downloadURL  ${UPDATE_URL}`,
    matchLines,
    "// @run-at       document-start",
    "// @grant        none",
    "// ==/UserScript==",
  ].join("\n");

  const body = ["(function () {", '"use strict";', chunks.join("\n\n"), "})();"].join("\n");
  return `${header}\n\n${body}\n`;
}

const out = process.argv[2] || path.join(ROOT, "dist", "douyin.user.js");
mkdirSync(path.dirname(out), { recursive: true });
const code = build();
writeFileSync(out, code, "utf8");
console.log(`built ${path.relative(ROOT, out)} (${(code.length / 1024).toFixed(1)} KB)`);
