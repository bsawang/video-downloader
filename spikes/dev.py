"""spikes/dev.py — 当前页面切片式动态测试（F12 Console / Snippets 风格）。

连接常驻浏览器（driver.py start）里**已打开的抖音 tab**，直接对页面当前状态
执行 JS 片段并返回结果。不导航、不重开 tab、不重载——页面保持原状。

用法:
  .venv/Scripts/python spikes/dev.py eval "document.title"       # 对当前页面执行任意 JS
  .venv/Scripts/python spikes/dev.py navigate <链接>             # 在当前 tab 内导航（不新开）
  .venv/Scripts/python spikes/dev.py extract                     # 提取当前页视频候选（RENDER_DATA）
  .venv/Scripts/python spikes/dev.py perf                        # 当前页 performance 直链
  .venv/Scripts/python spikes/dev.py snippets/my.js              # 执行 JS 片段文件
  .venv/Scripts/python spikes/dev.py                             # 进入交互式 REPL（输 JS 直接跑）

原理:
  CDP Runtime.evaluate 绑定当前页面的 execution context，页面保持当前状态
  （滚动/已开视频/登录态），每次只执行一段逻辑并读回结果——切片式，秒级迭代。

内置片段: extract / perf / url / title / video / body
"""
import argparse
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PORT = "http://127.0.0.1:9222"

# 内置 JS 片段（F12 Snippets 的常驻版）
SNIPPETS = {
    "url": "location.href",
    "title": "document.title",
    "video": ("Array.from(document.querySelectorAll('video'))"
              ".map(v=>(v.currentSrc||v.src||'').slice(0,90))"),
    "perf": ("performance.getEntriesByType('resource')"
             ".map(e=>e.name).filter(u=>u.includes('douyinvod')).slice(-5)"),
    "body": ("{len: document.body ? document.body.innerHTML.length : -1, "
             "text: (document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,120)}"),
    "extract": """(() => {
        // 从 RENDER_DATA / 页面对象递归提取视频候选（插件 main.js 的提取逻辑精简版）
        const items = [];
        const seen = new Set();
        const push = (o) => {
          if (!o || typeof o !== 'object') return;
          if (o.aweme_id && o.video) {
            const id = String(o.aweme_id);
            if (!seen.has(id)) {
              seen.add(id);
              items.push({id, desc: (o.desc||'').slice(0,40),
                          author: (o.author||{}).nickname||''});
            }
          }
          for (const k of Object.keys(o)) push(o[k]);
        };
        const s = document.querySelector('script#RENDER_DATA');
        if (s) {
          try { push(JSON.parse(decodeURIComponent(s.textContent))); }
          catch (e) { return {error: 'RENDER_DATA 解析失败: '+e.message}; }
        }
        const w = window;
        if (w.__INITIAL_STATE__) push(w.__INITIAL_STATE__);
        if (w._ROUTER_DATA) push(w._ROUTER_DATA);
        return {count: items.length, items: items.slice(0,15),
                render_data: !!document.querySelector('script#RENDER_DATA')};
      })()""",
}


def connect():
    p = sync_playwright().start()
    try:
        browser = p.chromium.connect_over_cdp(PORT)
    except Exception as e:
        print(f"连接常驻浏览器失败: {str(e)[:80]}\n先跑: .venv/Scripts/python spikes/driver.py start")
        p.stop()
        sys.exit(1)
    return p, browser


def find_douyin_page(browser):
    for ctx in browser.contexts:
        for pg in ctx.pages:
            if "douyin.com" in pg.url:
                return pg
    return None


def out(result):
    if isinstance(result, str):
        print(result)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", nargs="?", default="repl",
                    help="eval <JS> | 内置片段名 | 片段文件路径（省略则进 REPL）")
    ap.add_argument("rest", nargs="*", help="eval 模式的 JS 代码")
    args = ap.parse_args()

    p, browser = connect()
    page = find_douyin_page(browser)
    if not page:
        print("常驻浏览器里没有抖音 tab，先在窗口里打开一个抖音页面")
        p.stop(); return 1
    print(f"[当前页面] {page.url[:80]}")

    # 解析命令：eval <js> / 内置片段 / 片段文件
    # 在当前 tab 内导航（替换内容，不新开）——切片测试的目标页
    if args.cmd == "navigate":
        target = args.rest[0] if args.rest else "https://www.douyin.com/"
        page.goto(target, wait_until="domcontentloaded", timeout=40000)
        page.wait_for_timeout(5000)
        print(f"已导航: {page.url[:90]}")
        p.stop()
        return 0

    js = None
    if args.cmd == "eval":
        js = " ".join(args.rest)
    elif args.cmd == "repl":
        run_repl(page)
        p.stop(); return 0
    elif pathlib.Path(args.cmd).exists():
        js = pathlib.Path(args.cmd).read_text(encoding="utf-8")
    elif args.cmd in SNIPPETS:
        js = SNIPPETS[args.cmd]
    else:
        print(f"未知命令或片段: {args.cmd}\n内置片段: {list(SNIPPETS.keys())}")
        p.stop(); return 1

    try:
        result = page.evaluate(js)
        out(result)
    except Exception as e:
        print("执行错误:", str(e)[:200])
        p.stop(); return 1
    p.stop()
    return 0


def run_repl(page):
    """交互式 Console：输入 JS 直接对当前页面执行。"""
    print("切片式 REPL（Ctrl+C 或输入 exit 退出）")
    while True:
        try:
            line = input("> ")
        except (EOFError, KeyboardInterrupt):
            break
        if not line.strip():
            continue
        if line.strip() in ("exit", "quit"):
            break
        if line.strip() in SNIPPETS:
            line = SNIPPETS[line.strip()]
        try:
            out(page.evaluate(line))
        except Exception as e:
            print("执行错误:", str(e)[:200])


if __name__ == "__main__":
    main()
