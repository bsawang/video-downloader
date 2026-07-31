"""在真实浏览器里测试哪种下载方式能绕过 SERVER_FORBIDDEN。

策略1：页面里 <a download> 点击（走页面上下文，referer=cross-origin）
策略2：httpx 复刻下载管理器头（Sec-Fetch-*）看是否 403
"""
import asyncio
import json
import os

import httpx
from playwright.async_api import async_playwright

VIDEO_URL = "https://www.douyin.com/video/7666780213276190857"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


async def get_fresh_url():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        ctx = await browser.new_context(user_agent=UA)
        page = await ctx.new_page()
        captured = {}

        async def on_response(resp):
            if "aweme/v1/web/aweme/detail" in resp.url:
                try:
                    data = await resp.json()
                    if data.get("aweme_detail"):
                        captured["data"] = data
                except Exception:
                    pass

        page.on("response", on_response)
        try:
            await page.goto(VIDEO_URL, wait_until="networkidle", timeout=40000)
        except Exception:
            pass
        for _ in range(20):
            if "data" in captured:
                break
            await page.wait_for_timeout(500)
        await browser.close()
    if "data" not in captured:
        raise SystemExit("未捕获 detail")
    item = captured["data"]["aweme_detail"]
    return item["video"]["bit_rate"][0]["play_addr"]["url_list"][0]


def httpx_status(url, headers):
    with httpx.Client(headers=headers, follow_redirects=True, timeout=20) as c:
        r = c.get(url)
        return r.status_code, len(r.content)


async def strategy_anchor_download(url):
    """页面世界 <a download> 点击"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        ctx = await browser.new_context(accept_downloads=True, user_agent=UA)
        page = await ctx.new_page()
        await page.goto("https://www.douyin.com/", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        try:
            async with page.expect_download(timeout=8000) as dl_info:
                await page.evaluate(
                    f"""
                    const a = document.createElement('a');
                    a.href = {json.dumps(url)};
                    a.download = 'test.mp4';
                    document.body.appendChild(a); a.click();
                    """
                )
            dl = await dl_info.value
            path = await dl.path()
            print("策略1 <a download>: 成功 ->", dl.suggested_filename,
                  os.path.getsize(path), "bytes")
        except Exception as e:
            print("策略1 <a download>: 失败 ->", type(e).__name__, str(e)[:120])
        await browser.close()


async def main():
    url = await get_fresh_url()
    print("url:", url[:80], "...")

    # 策略2：复刻下载管理器头
    ua_dm = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36")
    variants = {
        "纯UA": {"User-Agent": ua_dm},
        "UA+SecFetch(navigate/cross-site)": {
            "User-Agent": ua_dm,
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "cross-site",
            "Upgrade-Insecure-Requests": "1",
        },
        "UA+SecFetch(navigate/same-site)+Referer": {
            "User-Agent": ua_dm,
            "Referer": "https://www.douyin.com/",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-site",
            "Upgrade-Insecure-Requests": "1",
        },
    }
    for name, h in variants.items():
        s, n = httpx_status(url, h)
        print(f"策略2 [{name}]: HTTP {s}, {n} bytes")

    await strategy_anchor_download(url)


asyncio.run(main())
