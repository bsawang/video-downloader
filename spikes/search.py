"""抖音关键词搜索 → 列出结果 → 下载（登录态复用 login-profile）。

用法:
  .venv/Scripts/python spikes/search.py 舞蹈              # 列出搜索结果
  .venv/Scripts/python spikes/search.py 舞蹈 --index 1,3  # 下载第 1、3 条（最高清晰度）
  .venv/Scripts/python spikes/search.py 舞蹈 --all        # 下载全部结果
  .venv/Scripts/python spikes/search.py 舞蹈 --max 20     # 最多展示/下载前 20 条

前提: 先跑 spikes/login.py 完成一次登录，登录态持久化在 spikes/login-profile/。

原理:
  打开 Edge（headed，复用登录态）→ 在搜索框输入关键词回车 → 监听 general/search/stream
  响应（流式帧格式: hex长度\\nJSON\\n...，帧内 JSONL）→ 提取 data[].aweme_info
  → 展示标题/作者/清晰度 → 用 httpx 直链下载（Referer + UA，已验证 HTTP 200）。

注意: 搜索接口返回的是流式帧 + 嵌套 aweme_info，不要用 resp.json()（会解析失败）。
"""
import argparse
import asyncio
import pathlib
import re
import sys

import httpx
from playwright.async_api import async_playwright

if hasattr(sys.stdout, "reconfigure"):  # Windows 终端 UTF-8，防中文乱码
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROFILE = ROOT / "spikes" / "login-profile"
OUT_DIR = ROOT / "downloads"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
STEALTH = "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"

SEARCH_URL_MARK = "/general/search/stream"


# ---------------------------------------------------------------------------
# 解析：搜索响应是流式帧，帧内是 JSONL
# ---------------------------------------------------------------------------
def parse_search_body(body):
    """从流式帧响应体提取视频条目列表（data[].aweme_info）。"""
    items, seen = [], set()
    for ln in body.split("\n"):
        ln = ln.strip()
        if not ln.startswith("{"):
            continue
        try:
            import json
            j = json.loads(ln)
        except Exception:
            continue
        if not isinstance(j, dict):
            continue
        d = j.get("data")
        if not isinstance(d, list):
            continue
        for it in d:
            ai = it.get("aweme_info") if isinstance(it, dict) else None
            if not isinstance(ai, dict) or not ai.get("aweme_id"):
                continue
            iid = str(ai["aweme_id"])
            if iid not in seen:
                seen.add(iid)
                items.append(ai)
    return items


def pick_streams(video):
    """从 video.bit_rate 提取可下载直链。

    只保留标准清晰度档（1080p/720p/540p...）；过滤自适应/付费/HDR 特殊流
    （adapt_lowest_4_1、pay_bvc1_hdr_r1_adapt_lowest_4_1 等，指向分段流/特殊编码，
    不适合直接下载）。按清晰度从高到低排序，下载时取 streams[0]。
    """
    brs = video.get("bit_rate") or []
    streams, seen = [], set()
    for br in brs:
        pa = br.get("play_addr") or {}
        urls = pa.get("url_list") or []
        if not urls:
            continue
        gear = str(br.get("gear_name") or "")
        m = re.search(r"(\d{3,4})", gear)
        if m:
            label = m.group(1) + "p"
        else:
            low = gear.lower()
            if "adapt" in low or "pay_" in low or "hdr" in low:
                continue  # 特殊流（自适应/付费/HDR），跳过
            label = gear or "默认"
        if label in seen:
            continue
        seen.add(label)
        streams.append({"label": label, "url": urls[0]})

    def num(lb):
        m = re.search(r"(\d{3,4})", lb)
        return int(m.group(1)) if m else 0

    streams.sort(key=lambda s: num(s["label"]), reverse=True)
    if not streams:
        urls = (video.get("play_addr") or {}).get("url_list") or []
        if urls:
            streams.append({"label": "默认", "url": urls[0]})
    return streams


def summarize(item):
    """从 aweme 条目提取可展示/下载信息。"""
    video = item.get("video") or {}
    author = item.get("author") or {}
    return {
        "aweme_id": str(item["aweme_id"]),
        "title": item.get("desc") or "",
        "author": author.get("nickname") or "",
        "streams": pick_streams(video),
    }


def sanitize(name):
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip() or "video"


# ---------------------------------------------------------------------------
# 下载
# ---------------------------------------------------------------------------
def download(url, dest):
    with httpx.Client(headers={"User-Agent": UA, "Referer": "https://www.douyin.com/"},
                      follow_redirects=True, timeout=60) as c:
        with c.stream("GET", url) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=262144):
                    f.write(chunk)
    return dest


# ---------------------------------------------------------------------------
# 搜索主流程
# ---------------------------------------------------------------------------
def cdp_ready(port=9222):
    """常驻浏览器（driver.py start）的 CDP 端口是否就绪。"""
    import urllib.request
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1.5)
        return True
    except Exception:
        return False


async def open_search_page(p, connect=False):
    """返回 (ctx, page, close_fn)。connect 连常驻浏览器（新 tab，用完只关 tab），
    否则冷启动 login-profile 持久上下文。"""
    if connect:
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        ctx = browser.contexts[0]
        page = await ctx.new_page()
        await ctx.add_init_script(STEALTH)

        async def _close():
            await page.close()  # 只关 tab，常驻浏览器保持

        return ctx, page, _close
    ctx = await p.chromium.launch_persistent_context(
        user_data_dir=str(PROFILE), channel="msedge", headless=False,
        viewport={"width": 1280, "height": 900}, user_agent=UA,
        args=["--disable-blink-features=AutomationControlled", "--start-maximized"],
    )
    await ctx.add_init_script(STEALTH)
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    return ctx, page, ctx.close


async def search_and_list(keyword, max_items, connect=False):
    async with async_playwright() as p:
        ctx, page, close = await open_search_page(p, connect)

        body_holder = {}

        async def on_response(resp):
            if SEARCH_URL_MARK in resp.url:
                try:
                    body_holder["body"] = await resp.text()
                except Exception:
                    pass

        page.on("response", on_response)
        try:
            await page.goto("https://www.douyin.com/", wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            print("首页加载警告:", type(e).__name__, str(e)[:100])
        await page.wait_for_timeout(5000)

        box = await page.query_selector('input[data-e2e*="search"]')
        if not box:
            print("未找到搜索框"); await close(); return []
        await box.click(); await page.wait_for_timeout(500)
        await box.fill(keyword); await page.wait_for_timeout(500)
        await page.keyboard.press("Enter")
        # 等待搜索响应出现并累积（可能多帧，多等一会儿）
        for _ in range(20):
            if body_holder.get("body"):
                break
            await page.wait_for_timeout(1000)
        await page.wait_for_timeout(5000)
        await close()

    items = parse_search_body(body_holder.get("body", "")) if body_holder else []
    return [summarize(i) for i in items[:max_items]]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("keyword", help="搜索关键词")
    ap.add_argument("--index", help="下载指定编号（如 1,3,5）")
    ap.add_argument("--all", action="store_true", help="下载全部结果")
    ap.add_argument("--max", type=int, default=10, help="最多展示/下载前 N 条（默认 10）")
    ap.add_argument("--connect", action="store_true",
                    help="连接常驻浏览器（driver.py start），不冷启动")
    ap.add_argument("--cold", action="store_true",
                    help="强制冷启动（不自动连接常驻浏览器）")
    args = ap.parse_args()

    connect = True if args.connect else (False if args.cold else cdp_ready())
    mode = "（连接常驻浏览器）" if connect else ""
    print(f"== 搜索「{args.keyword}」{mode}")
    items = asyncio.run(search_and_list(args.keyword, args.max, connect))

    if not items:
        print("未获取到搜索结果（检查是否已登录：先跑 spikes/login.py）")
        return 1

    print(f"\n== 共 {len(items)} 条结果 ==")
    for i, it in enumerate(items, 1):
        q = "、".join(s["label"] for s in it["streams"])
        print(f"  {i}. [{it['aweme_id']}] {it['title'][:36]}")
        print(f"     @{it['author']} | {q}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    def pick(idx_str):
        try:
            return {int(x) for x in idx_str.replace("，", ",").split(",")}
        except ValueError:
            return set()

    wanted = set(range(1, len(items) + 1)) if args.all else pick(args.index or "")
    if not wanted:
        print("\n（未指定下载，用 --index 1,3 或 --all 下载）")
        return 0

    ok = fail = 0
    for i, it in enumerate(items, 1):
        if i not in wanted:
            continue
        if not it["streams"]:
            print(f"  [{i}] 无直链，跳过"); fail += 1; continue
        url = it["streams"][0]["url"]
        label = it["streams"][0]["label"]
        fname = sanitize(f"{it['author']}_{it['title']}_{label}") + ".mp4"
        dest = OUT_DIR / fname
        try:
            download(url, dest)
            size = dest.stat().st_size
            print(f"  [{i}] 下载完成: {fname} ({size/1024/1024:.1f} MB)")
            ok += 1
        except Exception as e:
            print(f"  [{i}] 下载失败: {str(e)[:100]}")
            fail += 1

    print(f"\n== 完成: 成功 {ok}，失败 {fail} ==")
    print(f"保存目录: {OUT_DIR}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
