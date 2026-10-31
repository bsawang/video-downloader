// 临时真页验证用的 dist 静态服务：带上 CORS + 私网访问头，
// Chrome 的 Private Network Access 会拦掉公网页面直连 127.0.0.1 的 fetch。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(ROOT, "dist", "douyin.user.js");

const server = createServer(async (req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Cache-Control": "no-store",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { ...headers, "Content-Type": "text/javascript; charset=utf-8" });
    res.end(body);
  } catch (e) {
    res.writeHead(500, headers);
    res.end(String(e));
  }
});

server.listen(8765, "127.0.0.1", () => console.log("serving dist on http://127.0.0.1:8765/douyin.user.js"));
