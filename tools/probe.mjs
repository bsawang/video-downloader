// CDP 四指标自检：candidates / anchors / mounted / downloadable。
// 用法：node tools/probe.mjs --url <页面> [--port 9222] [--wait 6000]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { douyinAdapter } from "../src/platforms/douyin/adapter.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    out[key] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.url) {
  console.error("usage: node tools/probe.mjs --url <页面> [--port 9222] [--wait 6000]");
  process.exit(2);
}
const port = Number(args.port || 9222);
const base = `http://127.0.0.1:${port}`;
const scriptPath = args.script || path.join(ROOT, "dist", "douyin.user.js");

async function openTab(url) {
  const r = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!r.ok) throw new Error(`new tab failed: HTTP ${r.status}`);
  return r.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let seq = 0;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const p = msg.id && pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    };
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++seq;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => ws.close(),
      });
    ws.onerror = () => reject(new Error("CDP websocket error"));
  });
}

async function main() {
  try {
    const r = await fetch(`${base}/json/version`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`CDP 不可用（${base}）：${(e && (e.cause || e.message)) || e}`);
    console.error("先运行 .venv/Scripts/python spikes/driver.py start");
    process.exit(2);
  }

  const tab = await openTab("about:blank");
  const cdp = await connect(tab.webSocketDebuggerUrl);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(scriptPath, "utf8") });
    await cdp.send("Page.navigate", { url: args.url });
    await sleep(Number(args.wait || 6000));
    const res = await cdp.send("Runtime.evaluate", {
      expression: "JSON.stringify(window.__dlStats || null)",
      returnByValue: true,
    });
    const stats = res.result && res.result.value ? JSON.parse(res.result.value) : null;
    const report = {
      url: args.url,
      candidates: stats ? stats.candidates : 0,
      anchors: stats ? stats.anchors : 0,
      mounted: stats ? stats.mounted : 0,
      downloadable: stats ? stats.downloadable : 0,
      sources: douyinAdapter.sources.map((s) => ({ id: s.id, reachableInPage: s.reachableInPage !== false })),
    };
    console.log(JSON.stringify(report, null, 2));
    if (!stats) {
      console.error("页面未产出 __dlStats（脚本未注入或启动失败）");
      process.exit(3);
    }
  } finally {
    cdp.close();
    fetch(`${base}/json/close/${tab.id}`).catch(() => {});
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
