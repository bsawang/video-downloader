import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function modules(rel = "") {
  return readdirSync(path.join(ROOT, "src", rel), { withFileTypes: true }).flatMap((e) => {
    const child = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) return modules(child);
    return e.name.endsWith(".js") ? [child] : [];
  });
}

// 拼接构建靠 ORDER 手写拓扑序，漏一个模块只会在浏览器里报 xxx is not defined；
// 单测直接 import 模块，抓不到这类漏拼。
test("构建产物包含 src 下每个模块，版本取自 package.json", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vd-build-"));
  const out = path.join(dir, "douyin.user.js");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs"), out], { cwd: ROOT });
    const code = readFileSync(out, "utf8");
    for (const rel of modules()) {
      assert.ok(code.includes("// ---- " + rel + " ----"), "漏拼 " + rel);
    }
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.match(code, new RegExp("// @version\\s+" + pkg.version.replace(/\./g, "\\.") + "\\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
