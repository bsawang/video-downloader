"""spikes/session.py — 常驻测试会话（页面 + 网络捕获状态累积，增量推进测试）。

解决"每次测试都从头跑"：一个常驻服务进程持有 常驻浏览器连接 + 当前页面 + 网络拦截
捕获数据。每个命令只是给会话发一次请求，页面不重载、捕获不丢，新测试直接推进。

用法（先 driver.py start 起常驻浏览器）:
  .venv/Scripts/python spikes/session.py start            # 启动常驻会话服务
  .venv/Scripts/python spikes/session.py navigate <链接>   # 当前 tab 内导航
  .venv/Scripts/python spikes/session.py eval "<js>"       # 对当前页面执行 JS
  .venv/Scripts/python spikes/session.py watch <子串>      # 拦截 url 含该子串的响应（累积）
  .venv/Scripts/python spikes/session.py captured          # 查看已捕获响应摘要
  .venv/Scripts/python spikes/session.py extract           # 从捕获响应提取视频条目
  .venv/Scripts/python spikes/session.py items             # 查看已提取条目
  .venv/Scripts/python spikes/session.py download <编号>   # 下载条目（httpx，存 downloads/）
  .venv/Scripts/python spikes/session.py stop              # 关闭会话服务（浏览器保持）

典型流程（登录态搜索下载，全程一个会话）:
  session.py watch general/search
  session.py navigate https://www.douyin.com/
  session.py eval 在搜索框输入关键词的回车 JS     # 页面触发搜索
  session.py captured   # 看到 general/search 响应已捕获
  session.py extract && session.py items
  session.py download 1

架构: async Playwright 跑在单事件循环（唯一线程），所有页面/网络操作都经
asyncio.run_coroutine_threadsafe 桥接到该循环 → 避免 sync API 跨线程 greenlet 报错。
"""
import argparse
import asyncio
import json
import pathlib
import re
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[1]
PORT = 9100
BASE = f"http://127.0.0.1:{PORT}"
LOG = ROOT / "spikes" / "session.log"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


# ---------------------------------------------------------------------------
# 服务端（async Playwright 单事件循环）
# ---------------------------------------------------------------------------
def run_server():
    sys.path.insert(0, str(ROOT / "spikes"))
    from search import parse_search_body, summarize  # noqa: E402
    from playwright.async_api import async_playwright  # noqa: E402

    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_forever, daemon=True).start()

    state = {"captured": [], "patterns": [], "items": []}

    async def on_response(resp):
        if not state["patterns"]:
            return
        if any(pat in resp.url for pat in state["patterns"]):
            try:
                body = await resp.text()
                state["captured"].append({"url": resp.url[:170], "status": resp.status,
                                          "body": body, "t": time.strftime("%H:%M:%S")})
            except Exception:
                pass

    async def _init():
        p = await async_playwright().start()
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        page = None
        for ctx in browser.contexts:
            for pg in ctx.pages:
                if "douyin.com" in pg.url:
                    page = pg
                    break
            if page:
                break
        if not page:
            page = await browser.contexts[0].new_page()
        page.on("response", on_response)
        return p, browser, page

    p, browser, page = asyncio.run_coroutine_threadsafe(_init(), loop).result()

    def call(coro):
        return asyncio.run_coroutine_threadsafe(coro, loop).result(timeout=180)

    def _extract():
        """解析捕获的响应体，提取视频条目（search 流式帧 / detail JSON）。"""
        items, seen = [], set()
        for c in state["captured"]:
            for it in parse_search_body(c["body"]):
                sid = str(it.get("aweme_id"))
                if sid not in seen:
                    seen.add(sid)
                    items.append(it)
            try:
                d = json.loads(c["body"]).get("aweme_detail") or {}
                if d.get("aweme_id") and str(d["aweme_id"]) not in seen:
                    seen.add(str(d["aweme_id"]))
                    items.append(d)
            except Exception:
                pass
        return items

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, obj, code=200):
            data = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n).decode() or "{}") if n else {}

        def do_GET(self):
            if self.path == "/status":
                return self._send({"ok": True, "url": page.url[:80],
                                   "captured": len(state["captured"]),
                                   "items": len(state["items"])})
            if self.path == "/captured":
                return self._send([{"url": c["url"], "status": c["status"],
                                    "len": len(c["body"]), "t": c["t"]}
                                   for c in state["captured"]])
            if self.path == "/items":
                return self._send([summarize(i) for i in state["items"]])
            self._send({"error": "unknown"}, 404)

        def do_POST(self):
            try:
                body = self._body()
                if self.path == "/eval":
                    r = call(page.evaluate(body["js"]))
                    return self._send({"ok": True, "result": r})
                if self.path == "/navigate":
                    async def _nav():
                        await page.goto(body["url"], wait_until="domcontentloaded",
                                        timeout=40000)
                        await page.wait_for_timeout(3000)
                        return page.url[:90]
                    return self._send({"ok": True, "url": call(_nav())})
                if self.path == "/watch":
                    pat = body["pattern"]
                    if pat not in state["patterns"]:
                        state["patterns"].append(pat)
                    return self._send({"ok": True, "patterns": state["patterns"]})
                if self.path == "/extract":
                    found = _extract()
                    added = 0
                    for it in found:
                        if not any(str(s.get("aweme_id")) == str(it.get("aweme_id"))
                                   for s in state["items"]):
                            state["items"].append(it)
                            added += 1
                    return self._send({"ok": True, "found": len(found),
                                       "added": added, "total": len(state["items"])})
                if self.path == "/download":
                    idx = int(body["index"]) - 1
                    if not (0 <= idx < len(state["items"])):
                        return self._send({"ok": False, "error": "编号越界"}, 400)
                    info = summarize(state["items"][idx])
                    if not info["streams"]:
                        return self._send({"ok": False, "error": "无直链"}, 400)
                    dest = _httpx_download(info["streams"][0]["url"], info["author"],
                                           info["title"], info["streams"][0]["label"])
                    return self._send({"ok": True, "file": str(dest)})
                if self.path == "/stop":
                    self._send({"ok": True, "bye": True})
                    threading.Thread(target=lambda: (loop.call_soon_threadsafe(loop.stop),
                                                     self.server.shutdown()),
                                     daemon=True).start()
                    return
                self._send({"error": "unknown"}, 404)
            except Exception as e:
                self._send({"ok": False, "error": str(e)[:300]}, 500)

    def _httpx_download(url, author, title, label):
        import httpx
        out = ROOT / "downloads"
        out.mkdir(parents=True, exist_ok=True)
        fname = re.sub(r'[\\/:*?"<>|]', "_", f"{author}_{title}_{label}").strip() or "video"
        dest = out / (fname + ".mp4")
        with httpx.Client(headers={"User-Agent": UA, "Referer": "https://www.douyin.com/"},
                          follow_redirects=True, timeout=60) as c:
            with c.stream("GET", url) as r:
                r.raise_for_status()
                with open(dest, "wb") as f:
                    for chunk in r.iter_bytes(chunk_size=262144):
                        f.write(chunk)
        return dest

    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"会话服务就绪: {BASE}  (页面: {page.url[:60]})", flush=True)
    srv.serve_forever()
    try:
        browser.close()
    except Exception:
        pass
    p.stop()
    print("会话服务已停止", flush=True)


# ---------------------------------------------------------------------------
# 客户端
# ---------------------------------------------------------------------------
def server_ready(port=PORT):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=2)
        return True
    except Exception:
        return False


def post(path, payload, timeout=180):
    req = urllib.request.Request(BASE + path,
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": e.read().decode()[:300]}


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", help="start/navigate/eval/watch/captured/extract/items/download/stop")
    ap.add_argument("args", nargs="*")
    a = ap.parse_args()
    cmd, rest = a.cmd, a.args

    if cmd == "start":
        if server_ready():
            print(f"会话服务已在运行: {BASE}")
            return 0
        subprocess.Popen([sys.executable, str(pathlib.Path(__file__).resolve()), "--server"],
                         cwd=str(ROOT), creationflags=subprocess.CREATE_NO_WINDOW,
                         stdout=open(LOG, "a", encoding="utf-8"),
                         stderr=subprocess.STDOUT)
        for _ in range(30):
            if server_ready():
                print(f"会话服务就绪: {BASE}")
                print("  用 session.py navigate/eval/watch/captured/extract/items/download 推进")
                return 0
            time.sleep(1)
        print("启动超时，看日志:", LOG)
        return 1

    if cmd == "stop":
        print(post("/stop", {}))
        return 0

    if not server_ready():
        print("会话服务未运行，先跑: .venv/Scripts/python spikes/session.py start")
        return 1

    if cmd == "navigate":
        print(post("/navigate", {"url": rest[0] if rest else "https://www.douyin.com/"}))
    elif cmd == "eval":
        print(post("/eval", {"js": " ".join(rest)}))
    elif cmd == "watch":
        print(post("/watch", {"pattern": rest[0] if rest else ""}))
    elif cmd == "extract":
        print(post("/extract", {}))
    elif cmd == "download":
        print(post("/download", {"index": int(rest[0])}))
    elif cmd in ("captured", "items", "status"):
        data = get(f"/{cmd}") if cmd in ("captured", "items") else get("/status")
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        ap.print_help()
        return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--server":
        run_server()
    else:
        sys.exit(main())
