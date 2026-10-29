"""用本地抖音 DOM 夹具验证 5 条锚点规则 + hook + hover + popover（不需要登录）。

真实搜索页/个人主页要登录态，无法在冒烟里稳定复现；夹具复刻 v0.5.3 扫描依赖的 DOM 结构，
断言规则集合与挂载行为，和 verify_tm.py（真页详情页）互补。

用法: .venv/Scripts/python spikes/verify_dom.py
"""
import json
import pathlib
import sys
from urllib.parse import quote

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "dist" / "douyin.user.js").read_text(encoding="utf-8")
BASE = "http://fixture.local"

PAGE = """<!doctype html><meta charset="utf-8"><title>fixture</title>
<style>body{margin:0} .card{width:180px;height:120px;margin:8px;background:#222;position:relative;display:inline-block}</style>
<div class="card" data-aweme-id="111"></div>
<div id="waterfall_item_222" class="card" style="position:static"><div class="videoImage" style="position:relative;height:100%"></div></div>
<div class="video_333 card"></div>
<div class="douyin-player-video-container card" style="width:320px;height:180px">
  <video src="https://v3-web.douyinvod.com/abc/video/tos/x/?__vid=444" preload="none" muted></video>
</div>
<div class="douyin-player-video-container card" style="width:320px;height:180px">
  <video src="https://v3-web.douyinvod.com/abc/video/tos/y/?__vid=666" preload="none" muted></video>
</div>
<img src="https://v3-web.douyinvod.com/fake/video/tos/perf.mp4" width="1" height="1">
<div class="card">
  <ul data-e2e="scroll-list"><li><a href="/video/555" style="position:relative;display:block;height:100%">note</a></li></ul>
</div>
<div class="card" data-aweme-id="888"></div>
<script id="RENDER_DATA" type="application/json">__SSR__</script>
<script>
  fetch("/api/feed").then(r => r.text());
  const x = new XMLHttpRequest();
  x.open("GET", "/api/xhr");
  x.send();
</script>
"""

GEARS = [("normal_1080_0", 1080), ("normal_720_0", 720), ("normal_540_0", 540)]


def aweme(vid):
    return {
        "aweme_id": str(vid),
        "desc": f"fixture-{vid}",
        "author": {"nickname": f"user{vid}"},
        "video": {
            "play_addr": {"url_list": [f"https://cdn.example/{vid}.mp4"]},
            "bit_rate": [
                {"gear_name": gear, "play_addr": {"url_list": [f"https://cdn.example/{vid}_{q}.mp4"]}}
                for gear, q in GEARS
            ],
        },
    }


def feed_body():
    return json.dumps(
        {"status_code": 0, "aweme_list": [aweme(v) for v in (111, 222, 333, 444, 555)]},
        ensure_ascii=False,
    )


def ssr_body():
    payload = {"app": {"videoDetail": {"aweme_detail": aweme(888)}}}
    return quote(json.dumps(payload), safe="")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx = browser.new_context(viewport={"width": 1000, "height": 700})
        ctx.add_init_script("globalThis.__DL_DEBUG = true;")
        ctx.add_init_script(SCRIPT)
        page = ctx.new_page()
        errs, logs = [], []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: logs.append(m.text))

        page.route(f"{BASE}/api/feed", lambda r: r.fulfill(body=feed_body(), content_type="application/json"))
        page.route(f"{BASE}/api/xhr", lambda r: r.fulfill(body=feed_body(), content_type="application/json"))
        html = PAGE.replace("__SSR__", ssr_body())
        page.route(f"{BASE}/user/self", lambda r: r.fulfill(body=html, content_type="text/html; charset=utf-8"))
        page.route(
            "https://v3-web.douyinvod.com/**",
            lambda r: r.fulfill(body=b"gif", content_type="image/gif"),
        )
        page.goto(f"{BASE}/user/self", wait_until="domcontentloaded")
        page.wait_for_timeout(3000)

        stats = page.evaluate("() => window.__dlStats || null")
        icons = page.locator("[data-dl-icon]").count()
        per_rule = page.evaluate(
            """() => ({
              dataAwemeId: document.querySelectorAll('[data-aweme-id] [data-dl-icon]').length,
              waterfall: document.querySelectorAll('[id^="waterfall_item_"] [data-dl-icon]').length,
              className: document.querySelectorAll('[class*="video_"] > [data-dl-icon]').length,
              mediaSrc: document.querySelectorAll('.douyin-player-video-container [data-dl-icon]').length,
              innerHref: document.querySelectorAll('ul[data-e2e="scroll-list"] li [data-dl-icon]').length,
              labels: [...document.querySelectorAll('[data-dl-icon]')].map(b => b.textContent),
              staticFallbackId: !![...document.querySelectorAll('[id^="waterfall_item_"]')].length,
              hiddenBeforeHover: [...document.querySelectorAll('[data-dl-icon]')].map(b => b.style.display),
              hrefPos: getComputedStyle(document.querySelector('a[href*="/video/"]')).position
            })"""
        )

        # hover：第三张卡片（waterfall，根是 static，应挂到内部链接上）显示按钮
        card = page.locator("#waterfall_item_222 li, #waterfall_item_222 a").first
        hidden_after_hover = None
        if page.locator("#waterfall_item_222 [data-dl-icon]").count():
            page.locator("#waterfall_item_222").hover(force=True)
            page.wait_for_timeout(100)
            hidden_after_hover = page.locator("#waterfall_item_222 [data-dl-icon]").first.evaluate(
                "el => el.style.display"
            )

        # popover：点第一张卡片按钮
        page.locator("[data-aweme-id] [data-dl-icon]").first.evaluate("el => el.style.display = 'block'")
        page.locator("[data-aweme-id] [data-dl-icon]").first.click(force=True)
        page.wait_for_timeout(300)
        pop = page.locator("[data-dl-pop]")
        qualities = pop.locator("button").all_inner_texts() if pop.count() else []
        # 点外部关闭
        page.mouse.click(5, 5)
        page.wait_for_timeout(200)
        pop_after_outside = page.locator("[data-dl-pop]").count()

        result = {
            "stats": stats,
            "icons": icons,
            "perRule": per_rule,
            "waterfallVisibleAfterHover": hidden_after_hover,
            "qualities": qualities,
            "popClosedByOutsideClick": pop_after_outside == 0,
            "debugSource": [l for l in logs if "source network" in l][:4],
            "debugFallback": [l for l in logs if "fallback 666" in l][:2],
            "pageerrors": errs,
        }
        print(json.dumps(result, ensure_ascii=False))

        rules_hit = ("dataAwemeId", "waterfall", "className", "mediaSrc", "innerHref")
        ok = (
            stats
            and stats["candidates"] == 6
            and stats["mounted"] == 7
            and stats["fallback"] == 1
            and stats["downloadable"] == 6
            and icons == 7
            and per_rule["dataAwemeId"] == 2
            and per_rule["waterfall"] == 1
            and per_rule["className"] == 1
            and per_rule["innerHref"] == 1
            and per_rule["mediaSrc"] == 2
            and hidden_after_hover == "block"
            and qualities == ["⬇ 1080p", "⬇ 720p", "⬇ 540p"]
            and pop_after_outside == 0
            and result["debugSource"]
            and result["debugFallback"]
            and any("api/xhr" in l for l in result["debugSource"])
            and not errs
        )
        ctx.close()
        browser.close()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
