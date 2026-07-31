"""验证 background webRequest 是否能观察到 douyinvod 视频请求。"""
import asyncio
import pathlib

from playwright.async_api import async_playwright

EXT = str(pathlib.Path(__file__).resolve().parents[1] / "extension")
VIDEO_URL = "https://www.douyin.com/video/7666780213276190857"


async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir="spikes/.pwtmp2",
            channel="msedge",
            headless=False,
            viewport={"width": 1280, "height": 800},
            args=[
                f"--disable-extensions-except={EXT}",
                f"--load-extension={EXT}", "--disable-quic",
            ],
        )
        # 监听所有 extension page / service worker 的 console
        async def on_bg_console(msg):
            t = msg.text
            if "[dy-dl:bg]" in t:
                print("BG:", t[:120])

        for worker in ctx.service_workers:
            worker.on("console", on_bg_console)
            print("found SW:", worker.url)

        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        page.on("console", lambda m: print("PG:", m.text[:110]))
        try:
            await page.goto(VIDEO_URL, wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            print("goto:", e)
        await page.wait_for_timeout(9000)

        # 检查按钮根节点
        try:
            has = await page.evaluate("!!document.querySelector('#dy-downloader-root')")
            print("按钮根节点:", has)
        except Exception as e:
            print("检查按钮:", e)

        await ctx.close()


asyncio.run(main())
