"""抖音下载器 · 统一 Playwright 测试 runner（替代零散脚本）。

用法：
  .venv/Scripts/python spikes/run.py --list                          # 列出内置测试链接
  .venv/Scripts/python spikes/run.py --url <链接>                    # 后端解析验证（默认，headless）
  .venv/Scripts/python spikes/run.py --url <链接> --mode plugin      # 插件 UI + 下载链路验证（headed）
  .venv/Scripts/python spikes/run.py --url <链接> --mode probe       # 诊断：perf 直链 / iframe / aweme 请求
  .venv/Scripts/python spikes/run.py --url <链接> --download         # backend 模式顺带 httpx 验证直链下载
  .venv/Scripts/python spikes/run.py --url <链接> --keep-profile     # 保留临时 profile 供排查

三种模式：
  backend   headless 加载视频页 → 拦截 /aweme/v1/web/aweme/detail 响应 → 提取多路清晰度
            → 断言（标题/作者/清晰度数）→ 截图 → result.json。也是后端版的解析验证。
  plugin    headed + 加载真实插件 extension/ → 验证浮层按钮/标题/清晰度 → 触发下载
            → expect_download 捕获 blob 下载。发布前的 UI 回归。
  probe     诊断模式：打印 performance 直链 / iframe / aweme API 请求（排查登录态弹窗等）。

关键设计：
  每次运行用全新临时 profile（tempfile.mkdtemp）→ 内容脚本永远读磁盘，缓存坑根治，
  不需要改文件名、不需要手动移除重装扩展。
  输出统一写到 spikes/out/<run_时间戳>/：result.json + page.png + 各模式附带信息。

退出码：全部断言通过 = 0，任一失败 = 1。可直接用于 CI / 一条命令拿结论。
"""
import argparse
import asyncio
import datetime
import json
import os
import pathlib
import re
import shutil
import sys
import tempfile

# Windows: 默认 stdout 检测为 GBK，但本环境终端按 UTF-8 解读 → 中文乱码。
# 强制 UTF-8 输出，避免每条命令都手动加 PYTHONIOENCODING。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from playwright.async_api import async_playwright

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
ROOT = pathlib.Path(__file__).resolve().parents[1]
EXT_DIR = ROOT / "extension"
OUT_ROOT = ROOT / "spikes" / "out"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

DETAIL_URL_MARK = "/aweme/v1/web/aweme/detail"

# 内置测试链接：--list 可查看，--url preset名 直接使用
PRESETS = {
    "video": "https://www.douyin.com/video/7666780213276190857",
    "search": ("https://www.douyin.com/jingxuan/search/%E8%88%9E%E8%B9%88"
               "?type=general"),
}

# ---------------------------------------------------------------------------
# 结构化提取 / 断言汇总
# ---------------------------------------------------------------------------
class Checks:
    """累计断言，统一输出与退出码。"""
    def __init__(self):
        self.items = []

    def check(self, name, ok, detail=""):
        self.items.append({"name": name, "ok": bool(ok), "detail": detail})
        tag = "PASS" if ok else "FAIL"
        print(f"  [{tag}] {name}" + (f" — {detail}" if detail else ""))
        return ok

    def summary(self):
        fails = [c for c in self.items if not c["ok"]]
        print(f"\n== 结果: {'全部通过' if not fails else f'{len(fails)} 项失败'} "
              f"({len(self.items)} 项) ==")
        return 0 if not fails else 1


def summarize_item(item):
    """从 aweme_detail 提取结构化的下载信息。"""
    video = item.get("video") or {}
    author = item.get("author") or {}
    streams = []
    seen = set()
    for br in video.get("bit_rate") or []:
        pa = br.get("play_addr") or {}
        urls = pa.get("url_list") or []
        if not urls:
            continue
        gear = br.get("gear_name") or ""
        m = re.search(r"(\d{3,4})", str(gear))
        if m:
            label = m.group(1) + "p"
        else:
            # 过滤自适应/付费/HDR 特殊流（adapt_lowest_4_1、pay_bvc1_hdr_... 等，非完整 MP4 源）
            low = str(gear).lower()
            if "adapt" in low or "pay_" in low or "hdr" in low:
                continue
            label = gear or "默认"
        if label in seen:
            continue
        seen.add(label)
        streams.append({"label": label, "gear": gear,
                        "url": urls[0],
                        "size": pa.get("data_size")})

    def _num(lb):
        m = re.search(r"(\d{3,4})", lb)
        return int(m.group(1)) if m else 0

    streams.sort(key=lambda s: _num(s["label"]), reverse=True)  # 高清晰度在前
    if not streams:
        urls = (video.get("play_addr") or {}).get("url_list") or []
        if urls:
            streams.append({"label": "默认", "gear": "", "url": urls[0], "size": None})
    return {
        "video_id": str(item.get("aweme_id") or ""),
        "title": item.get("desc") or "",
        "author": author.get("nickname") or "",
        "watermark": bool(video.get("has_watermark")),
        "streams": streams,
    }


def save(out_dir, name, data):
    p = out_dir / name
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def cdp_ready(port=9222):
    """常驻浏览器（driver.py start）的 CDP 端口是否就绪。"""
    import urllib.request
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1.5)
        return True
    except Exception:
        return False


async def open_context(p, profile=None, headless=True, accept_downloads=False, ext=False,
                       connect=False):
    """打开浏览器上下文，返回 (ctx, page, close_fn)。

    connect=True → CDP 连接常驻浏览器（driver.py start）：新开 tab 执行，close 只关 tab，
    浏览器保持运行（改代码重跑 = 刷新页面，秒级）。profile 给定时复用持久化登录态
    （login.py 生成），否则新建临时会话。ext=True 加载真实插件（仅 plugin；扩展不支持 headless）。
    """
    if connect:
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        ctx = browser.contexts[0]
        page = await ctx.new_page()

        async def _close():
            await page.close()  # 只关这个 tab，常驻浏览器保持

        return ctx, page, _close
    if profile:
        args = []
        if ext:
            args += [f"--disable-extensions-except={EXT_DIR}", f"--load-extension={EXT_DIR}"]
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir=str(profile), channel="msedge",
            headless=headless, viewport={"width": 1280, "height": 800},
            user_agent=UA, accept_downloads=accept_downloads, args=args)
        page = await ctx.new_page() if not ctx.pages else ctx.pages[0]
        return ctx, page, ctx.close
    browser = await p.chromium.launch(channel="msedge", headless=headless)
    ctx = await browser.new_context(user_agent=UA, viewport={"width": 1280, "height": 800},
                                    accept_downloads=accept_downloads)
    page = await ctx.new_page()
    return ctx, page, browser.close


# ---------------------------------------------------------------------------
# backend 模式：headless 拦截 detail API，提取多路清晰度
# ---------------------------------------------------------------------------
async def run_backend(url, do_download, out_dir, profile=None, connect=False):
    print(f"[backend] 加载 {url}"
          + (f"（复用登录态 {profile}）" if profile else "")
          + ("（连接常驻浏览器）" if connect else ""))
    async with async_playwright() as p:
        ctx, page, close = await open_context(p, profile=profile, connect=connect)

        captured = {}

        async def on_response(resp):
            if DETAIL_URL_MARK in resp.url:
                try:
                    data = await resp.json()
                    if data.get("aweme_detail"):
                        captured["data"] = data
                        captured["url"] = resp.url
                except Exception:
                    pass

        page.on("response", on_response)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            print("  goto 警告:", type(e).__name__, str(e)[:120])
        for _ in range(40):  # 最多等 20s
            if "data" in captured:
                break
            await page.wait_for_timeout(500)
        await page.wait_for_timeout(2000)
        await page.screenshot(path=str(out_dir / "page.png"))

        checks = Checks()
        checks.check("捕获 detail API", "data" in captured,
                     captured.get("url", "")[:80] if "data" in captured else "")
        if "data" not in captured:
            await close()
            return checks.summary()

        info = summarize_item(captured["data"]["aweme_detail"])
        print("  标题:", info["title"][:50])
        print("  作者:", info["author"])
        print("  水印:", "无水印" if not info["watermark"] else "有水印")
        for s in info["streams"]:
            print(f"    {s['label']:<8} {s['url'][:80]}")

        checks.check("标题非空", bool(info["title"]), info["title"][:40])
        checks.check("有作者", bool(info["author"]), info["author"])
        checks.check("多路清晰度", len(info["streams"]) >= 1, f"{len(info['streams'])} 路")
        # bit_rate 的 play_addr 是下载源；detail 字段 has_watermark 仅表示原视频带不带水印，
        # 与直链是否无水印无关。无水印凭据：直链 URL 不含 watermark 标记（WORKLOG 已实测）。
        no_wm = all("watermark" not in s["url"] for s in info["streams"])
        checks.check("直链无水印", no_wm)

        if do_download and info["streams"]:
            await verify_httpx_download(info["streams"], checks)

        result = {"mode": "backend", "url": url, "info": info, "checks": checks.items}
        p2 = save(out_dir, "result.json", result)
        print("  结果文件:", p2)
        await close()
        return checks.summary()


async def verify_httpx_download(streams, checks):
    """用 httpx 直链下载最高清晰度前 1MB，确认 HTTP 200 + 内容非空。"""
    import httpx
    s = streams[0]
    print(f"  [httpx] 验证直链下载 {s['label']} ...")
    try:
        with httpx.Client(headers={"User-Agent": UA,
                                   "Referer": "https://www.douyin.com/"},
                          follow_redirects=True, timeout=20) as client:
            with client.stream("GET", s["url"]) as resp:
                got = 0
                for chunk in resp.iter_bytes(chunk_size=262144):
                    got += len(chunk)
                    if got >= 1_000_000:
                        break
                checks.check("httpx 直链 HTTP 200", resp.status_code == 200, str(resp.status_code))
                checks.check("httpx 内容非空", got > 0, f"{got} bytes")
    except Exception as e:
        checks.check("httpx 下载成功", False, type(e).__name__ + ": " + str(e)[:100])


# ---------------------------------------------------------------------------
# plugin 模式：headed + 真实扩展，验证浮层 UI + 下载链路
# ---------------------------------------------------------------------------
async def run_plugin(url, skip_download, profile, out_dir):
    print(f"[plugin] 加载扩展 {EXT_DIR} -> {url}"
          + (f"（复用登录态 {profile}）" if profile else ""))
    async with async_playwright() as p:
        ctx, page, close = await open_context(p, profile=profile, headless=False,
                                              accept_downloads=True, ext=True)

        # 扩展内容脚本在 launch 后加载，等扩展背景页/首个 tab 稳定
        await page.wait_for_timeout(1500)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            print("  goto 警告:", type(e).__name__, str(e)[:120])

        # 等浮层按钮出现（有元数据匹配才显示）
        found = False
        for _ in range(40):
            has_root = await page.evaluate("!!document.querySelector('#dy-downloader-root')")
            if has_root:
                fab_hidden = await page.evaluate(
                    "document.querySelector('#dy-downloader-root').shadowRoot"
                    ".querySelector('.fab').classList.contains('hidden')")
                if not fab_hidden:
                    found = True
                    break
            await page.wait_for_timeout(500)

        checks = Checks()
        checks.check("浮层按钮出现", found)

        ui = None
        if found:
            ui = await page.evaluate("""(() => {
                const root = document.querySelector('#dy-downloader-root');
                const sh = root.shadowRoot;
                return {
                    title: sh.querySelector('.title').textContent,
                    author: sh.querySelector('.author').textContent,
                    qualities: Array.from(sh.querySelectorAll('.quality option'))
                                 .map(o => o.textContent),
                };
            })()""")
            print("  标题:", ui["title"][:50])
            print("  作者:", ui["author"])
            print("  清晰度:", ui["qualities"])
            checks.check("标题非空", bool(ui["title"] and ui["title"] != "（无标题）"),
                         ui["title"][:40])
            checks.check("有作者", bool(ui["author"]), ui["author"])
            checks.check("多路清晰度", len(ui["qualities"]) >= 1,
                         "、".join(ui["qualities"]))

            if not skip_download:
                await trigger_download(page, checks)

        await page.screenshot(path=str(out_dir / "page.png"))

        result = {"mode": "plugin", "url": url, "ui": ui, "checks": checks.items}
        p2 = save(out_dir, "result.json", result)
        print("  结果文件:", p2)
        await close()
        return checks.summary()


async def trigger_download(page, checks):
    """打开浮层面板 → 点下载 → 用 expect_download 捕获 blob 下载。"""
    try:
        async with page.expect_download(timeout=60000) as dl_info:
            await page.evaluate("""
                const sh = document.querySelector('#dy-downloader-root').shadowRoot;
                sh.querySelector('.fab').click();
            """)
            await page.wait_for_timeout(400)
            await page.evaluate("""
                const sh = document.querySelector('#dy-downloader-root').shadowRoot;
                sh.querySelector('.go').click();
            """)
        dl = await dl_info.value
        checks.check("触发下载事件", True, dl.suggested_filename)
        # 等文件落到磁盘（blob fetch 已在 a.click 前完成，这里通常很快）
        try:
            path = await asyncio.wait_for(dl.path(), timeout=30)
            size = os.path.getsize(path) if path else 0
            checks.check("下载文件落盘", size > 0, f"{size} bytes")
        except Exception as e:
            checks.check("下载文件落盘", False, type(e).__name__)
    except Exception as e:
        checks.check("触发下载事件", False, type(e).__name__ + ": " + str(e)[:100])


# ---------------------------------------------------------------------------
# probe 模式：诊断 performance 直链 / iframe / aweme 请求
# ---------------------------------------------------------------------------
async def run_probe(url, out_dir, profile=None, connect=False):
    print(f"[probe] 诊断 {url}"
          + (f"（复用登录态 {profile}）" if profile else "")
          + ("（连接常驻浏览器）" if connect else ""))
    async with async_playwright() as p:
        ctx, page, close = await open_context(p, profile=profile, connect=connect)
        reqs = []
        page.on("request", lambda r: reqs.append(r.url))
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            print("  goto 警告:", type(e).__name__, str(e)[:120])
        await page.wait_for_timeout(6000)

        perf = await page.evaluate(
            "performance.getEntriesByType('resource').map(e=>e.name)"
            ".filter(u=>u.includes('douyinvod')).slice(-8)")
        print(f"  perf douyinvod 直链: {len(perf)}")
        for u in perf:
            print("    ", u[:110])

        dom = await page.evaluate("""(() => {
            const hrefs = Array.from(document.querySelectorAll('a[href]')).map(a=>a.href);
            const modal = hrefs.filter(h => h.includes('modal_id=')).slice(0,6);
            const video = hrefs.filter(h => h.includes('/video/')).slice(0,6);
            return {
                modal_links: modal, video_links: video,
                body_len: document.body ? document.body.innerHTML.length : -1,
                text: (document.body.innerText || '').replace(/\\n+/g, ' | ').slice(0, 160),
            };
        })()""")
        print(f"  modal_id 链接: {len(dom['modal_links'])}")
        for u in dom["modal_links"]:
            print("    ", u[:100])
        print(f"  /video/ 链接: {len(dom['video_links'])}")
        for u in dom["video_links"]:
            print("    ", u[:100])
        print("  body_len:", dom["body_len"], "| 文本:", dom["text"])

        vids = await page.evaluate(
            "Array.from(document.querySelectorAll('video')).map(v=>(v.currentSrc||v.src||'').slice(0,80))")
        print("  video srcs:", vids)
        iframes = await page.evaluate(
            "Array.from(document.querySelectorAll('iframe')).map(f=>f.src.slice(0,80))")
        print("  iframes:", iframes)
        aweme = [u for u in reqs if "aweme" in u]
        print(f"  aweme API 请求: {len(aweme)}")
        for u in aweme[-10:]:
            print("    ", u[:100])
        detail = [u for u in reqs if DETAIL_URL_MARK in u]
        print(f"  detail API 请求: {len(detail)}")

        await page.screenshot(path=str(out_dir / "page.png"))
        save(out_dir, "result.json",
             {"mode": "probe", "url": url, "perf": perf, "dom": dom,
              "video_srcs": vids, "iframes": iframes, "aweme_requests": aweme[-20:]})
        await close()
    return 0


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
async def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="抖音链接，或 --list 里的 preset 名（如 video/search）")
    ap.add_argument("--mode", choices=["backend", "plugin", "probe"], default="backend")
    ap.add_argument("--list", action="store_true", help="列出内置测试链接")
    ap.add_argument("--download", action="store_true",
                    help="backend 模式顺带 httpx 验证直链下载")
    ap.add_argument("--skip-download", action="store_true",
                    help="plugin 模式跳过下载验证（只验证 UI）")
    ap.add_argument("--keep-profile", action="store_true", help="保留临时 profile")
    ap.add_argument("--profile", help="复用持久化登录态目录（login.py 生成，如 spikes/login-profile）")
    ap.add_argument("--connect", action="store_true",
                    help="连接常驻浏览器（driver.py start），不冷启动")
    ap.add_argument("--cold", action="store_true",
                    help="强制冷启动（不自动连接常驻浏览器）")
    ap.add_argument("--out", help="自定义输出目录名（默认自动时间戳）")
    args = ap.parse_args()

    if args.list:
        for name, u in PRESETS.items():
            print(f"  {name:<8} {u}")
        return 0

    url = PRESETS.get(args.url, args.url) if args.url else None
    if not url:
        ap.print_help()
        print("\n错误: 需要 --url（或 preset 名，用 --list 查看）")
        return 2

    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = OUT_ROOT / (args.out or f"run_{stamp}_{args.mode}")
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"输出目录: {out_dir}")

    # profile 复用：--profile 指定持久化目录（永不删除）；plugin 无指定时用临时目录（默认删除）
    temp_profile = None
    if args.mode == "plugin" and not args.profile:
        temp_profile = pathlib.Path(tempfile.mkdtemp(prefix="dypwtmp_"))
    profile = pathlib.Path(args.profile) if args.profile else temp_profile
    # 连接模式：backend/probe 自动检测常驻浏览器；plugin 需加载扩展，始终冷启动
    connect = False
    if args.mode in ("backend", "probe"):
        if args.connect:
            connect = True
        elif not args.cold and not args.profile:
            connect = cdp_ready()
    try:
        if args.mode == "backend":
            return await run_backend(url, args.download, out_dir, profile, connect)
        if args.mode == "plugin":
            return await run_plugin(url, args.skip_download, profile, out_dir)
        return await run_probe(url, out_dir, profile, connect)
    finally:
        if temp_profile is not None and not args.keep_profile:
            shutil.rmtree(temp_profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
