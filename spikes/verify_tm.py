"""用 Playwright 注入 dist/douyin.user.js，冒烟验证按钮与四指标。

用法:
  .venv/Scripts/python spikes/verify_tm.py [url] [--profile spikes/login-profile] [--headed]

不带 --profile 时用匿名临时上下文（容易被风控拦到验证码页）。
带 --profile 时复用登录态；确保没有其它浏览器占用该 profile。
"""
import argparse
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "dist" / "douyin.user.js").read_text(encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url", nargs="?", default="https://www.douyin.com/video/7666780213276190857")
    ap.add_argument("--profile", default=None)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--wait", type=int, default=9000)
    ap.add_argument("--download", action="store_true", help="点最低清晰度并等待真实下载")
    args = ap.parse_args()

    with sync_playwright() as p:
        launch_args = ["--disable-blink-features=AutomationControlled"]
        if args.profile:
            ctx = p.chromium.launch_persistent_context(
                str(ROOT / args.profile),
                channel="msedge",
                headless=not args.headed,
                args=launch_args,
            )
            browser = None
            ctx.add_init_script(SCRIPT)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
        else:
            browser = p.chromium.launch(channel="msedge", headless=not args.headed, args=launch_args)
            ctx = browser.new_context()
            ctx.add_init_script(SCRIPT)
            page = ctx.new_page()

        logs = []
        page.on("console", lambda m: logs.append(f"[console:{m.type}] {m.text}"[:200]))
        page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"[:200]))

        page.goto(args.url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(args.wait)

        stats = page.evaluate("() => window.__dlStats || null")
        icons = page.locator("[data-dl-icon]").count()
        videos = page.locator("video").count()

        pop_title, qualities, filename, dl_bytes = None, [], None, 0
        toast_after_download, toast_gone = None, None
        if icons:
            first = page.locator("[data-dl-icon]").first
            first.evaluate("el => el.style.display = 'block'")
            first.click(force=True)
            page.wait_for_timeout(400)
            pop = page.locator("[data-dl-pop]")
            if pop.count():
                pop_title = pop.locator("div").first.inner_text()
                rows = pop.locator("button")
                qualities = rows.all_inner_texts()
                if args.download and rows.count():
                    target = rows.nth(rows.count() - 1)
                    with page.expect_download(timeout=180000) as dl:
                        target.click()
                    filename = dl.value.suggested_filename
                    pth = dl.value.path()
                    dl_bytes = pathlib.Path(pth).stat().st_size if pth else 0
                    page.wait_for_timeout(200)
                    tb = page.locator("[data-dl-toast]")
                    toast_after_download = tb.first.inner_text() if tb.count() else None
                    page.wait_for_timeout(2800)
                    toast_gone = page.locator("[data-dl-toast]").count() == 0

        print(
            json.dumps(
                {
                    "url": args.url,
                    "final_url": page.url,
                    "title": page.title(),
                    "stats": stats,
                    "icons": icons,
                    "videos": videos,
                    "pop_title": pop_title,
                    "qualities": qualities,
                    "download_filename": filename,
                    "download_bytes": dl_bytes,
                    "toast": toast_after_download,
                    "toast_auto_dismissed": toast_gone,
                    "logs": logs[-10:],
                },
                ensure_ascii=False,
            )
        )
        out = ROOT / "spikes" / "out" / "verify_tm.png"
        page.screenshot(path=str(out))
        ctx.close()
        if browser:
            browser.close()
    return 0 if stats and icons > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
