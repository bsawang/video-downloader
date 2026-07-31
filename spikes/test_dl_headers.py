"""测试抖音 CDN 直链是否需要 Referer：带/不带各下载一次。"""
import asyncio

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
        raise SystemExit("未捕获到 detail 响应，无法获取直链")
    item = captured["data"]["aweme_detail"]
    br = item["video"]["bit_rate"][0]
    return br["play_addr"]["url_list"][0]


def test(url, referer):
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    with httpx.Client(headers=headers, follow_redirects=True, timeout=20) as c:
        with c.stream("GET", url) as r:
            got = 0
            for chunk in r.iter_bytes(262144):
                got += len(chunk)
                if got >= 300000:
                    break
            return r.status_code, got


async def main():
    url = await get_fresh_url()
    print("url:", url[:100], "...")
    s1, g1 = test(url, "https://www.douyin.com/")
    print(f"带 Referer : HTTP {s1}, 下载 {g1} bytes")
    s2, g2 = test(url, None)
    print(f"无 Referer : HTTP {s2}, 下载 {g2} bytes")
    s3, g3 = test(url, "https://www.douyin.com")
    print(f"Referer 无斜杠: HTTP {s3}, 下载 {g3} bytes")


asyncio.run(main())
