"""Spike：验证 Playwright + 本地 Edge 能否加载抖音视频页并拦截 detail API 响应。"""
import asyncio
import json

from playwright.async_api import async_playwright

VIDEO_URL = "https://www.douyin.com/video/7666780213276190857"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


async def main():
    async with async_playwright() as p:
        print("launching msedge headless...")
        browser = await p.chromium.launch(channel="msedge", headless=True)
        ctx = await browser.new_context(user_agent=UA, viewport={"width": 1280, "height": 800})
        page = await ctx.new_page()

        captures = []

        async def on_response(resp):
            url = resp.url
            if "aweme" in url and ("detail" in url or "item" in url):
                try:
                    data = await resp.json()
                    captures.append({"url": url, "data": data})
                except Exception:
                    pass

        page.on("response", on_response)
        try:
            await page.goto(VIDEO_URL, wait_until="networkidle", timeout=40000)
        except Exception as e:
            print("goto:", type(e).__name__, e)
        await page.wait_for_timeout(5000)

        print("captured aweme responses:", len(captures))
        for c in captures:
            d = c["data"]
            print("  URL:", c["url"][:110])
            print("  keys:", list(d.keys())[:10])
            if "aweme_detail" in d:
                item = d["aweme_detail"]
                print("  desc:", (item.get("desc") or "")[:40])
                author = item.get("author") or {}
                print("  author:", author.get("nickname"))
                video = item.get("video") or {}
                print("  video keys:", list(video.keys())[:15])
                bit_rate = video.get("bit_rate") or []
                print("  bit_rate count:", len(bit_rate))
                for br in bit_rate[:4]:
                    pa = br.get("play_addr") or {}
                    urls = pa.get("url_list") or []
                    print("    gear:", br.get("gear_name"), "| url0:", (urls[0] if urls else "")[:80])
        # 取第一路直链，测试 httpx + Referer 能否下载
        if captures:
            item = captures[0]["data"]["aweme_detail"]
            video = item.get("video") or {}
            brs = video.get("bit_rate") or []
            if brs:
                url = ((brs[0].get("play_addr") or {}).get("url_list") or [""])[0]
                import httpx
                print("\ntest download of:", url[:90], "...")
                with httpx.Client(headers={
                    "User-Agent": UA,
                    "Referer": "https://www.douyin.com/",
                }, follow_redirects=True, timeout=20) as client:
                    with client.stream("GET", url) as resp:
                        print("download HTTP:", resp.status_code)
                        total = int(resp.headers.get("content-length") or 0)
                        got = 0
                        for chunk in resp.iter_bytes(chunk_size=262144):
                            got += len(chunk)
                            if got >= 500000:
                                break
                        print(f"downloaded {got} bytes / total {total}")

        await browser.close()


asyncio.run(main())
