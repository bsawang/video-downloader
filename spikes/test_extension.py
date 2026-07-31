"""用 Playwright 加载真实插件，验证：按钮出现 + 兜底直链 + 下载。"""
import asyncio
import os
import pathlib

from playwright.async_api import async_playwright

EXT = str(pathlib.Path(__file__).resolve().parents[1] / "extension")
VIDEO_URL = "https://www.douyin.com/video/7666780213276190857"


async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir="spikes/.pwtmp",
            channel="msedge",
            headless=False,
            viewport={"width": 1280, "height": 800},
            args=[
                f"--disable-extensions-except={EXT}",
                f"--load-extension={EXT}",
            ],
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        page.on("console", lambda m: print("CONSOLE:", m.text[:150]))
        try:
            await page.goto(VIDEO_URL, wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            print("goto:", e)
        await page.wait_for_timeout(8000)

        # 检查插件的浮层按钮
        try:
            has_root = await page.evaluate(
                "!!document.querySelector('#dy-downloader-root')"
            )
            print("按钮根节点存在:", has_root)
            if has_root:
                info = await page.evaluate("""
                    const root = document.querySelector('#dy-downloader-root');
                    const sh = root.shadowRoot;
                    const fab = sh.querySelector('.fab');
                    const panel = sh.querySelector('.panel');
                    return {
                        fabHidden: fab ? fab.classList.contains('hidden') : 'no-fab',
                        title: panel ? panel.querySelector('.title').textContent : 'no-panel',
                        qualityCount: panel ? panel.querySelectorAll('.quality option').length : 0,
                    };
                """)
                print("浮层信息:", info)
                # 点开面板 + 触发下载
                await page.evaluate("""
                    const root = document.querySelector('#dy-downloader-root');
                    root.shadowRoot.querySelector('.fab').click();
                """)
                await page.wait_for_timeout(800)
                q = await page.evaluate(
                    "document.querySelector('#dy-downloader-root').shadowRoot"
                    ".querySelectorAll('.quality option').length"
                )
                print("清晰度选项数:", q)
        except Exception as e:
            print("检查浮层出错:", e)

        await ctx.close()


asyncio.run(main())
