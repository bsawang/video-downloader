"""Playwright 探针：搞清抖音搜索弹窗的数据/媒体机制。

输出：
1. 直接视频页 performance 里有没有 douyinvod
2. 搜索页点开视频后：iframe 情况 / 网络请求 / performance 直链
"""
import asyncio
import json

from playwright.async_api import async_playwright

SEARCH_URL = "https://www.douyin.com/jingxuan/search/%E8%88%9E%E8%B9%88?type=general"
VIDEO_URL = "https://www.douyin.com/video/7666780213276190857"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def perf_video(page):
    return page.evaluate(
        "performance.getEntriesByType('resource').map(e=>e.name)"
        ".filter(u => u.includes('douyinvod')).slice(-5)"
    )


async def probe_video_page(p):
    browser = await p.chromium.launch(channel="msedge", headless=True)
    ctx = await browser.new_context(user_agent=UA, viewport={"width": 1280, "height": 800})
    page = await ctx.new_page()
    reqs = []
    page.on("request", lambda r: reqs.append(r.url))
    await page.goto(VIDEO_URL, wait_until="domcontentloaded", timeout=40000)
    await page.wait_for_timeout(6000)
    pv = await perf_video(page)
    print("== 直接视频页 ==")
    print("perf douyinvod:", len(pv))
    for u in pv:
        print("   ", u[:110])
    vids = page.evaluate("Array.from(document.querySelectorAll('video')).map(v=>(v.currentSrc||v.src||'').slice(0,80))")
    print("video srcs:", vids)
    detail = [u for u in reqs if "detail" in u]
    print("detail requests:", len(detail))
    await browser.close()


async def probe_search(p):
    browser = await p.chromium.launch(channel="msedge", headless=True)
    ctx = await browser.new_context(user_agent=UA, viewport={"width": 1280, "height": 800})
    page = await ctx.new_page()
    reqs = []
    page.on("request", lambda r: reqs.append(r.url))
    await page.goto(SEARCH_URL, wait_until="domcontentloaded", timeout=40000)
    await page.wait_for_timeout(4000)

    # 打印页面上的视频缩略图链接，点击第一个
    links = await page.evaluate("""
        Array.from(document.querySelectorAll('a[href*="modal_id"]')).map(a=>a.href).slice(0,5)
    """)
    print("== 搜索页 ===")
    print("modal 链接数:", len(links), links[:2] if links else "无")

    if not links:
        # 换个方式：找视频卡片元素点击
        await page.wait_for_timeout(2000)
        links = await page.evaluate("""
            Array.from(document.querySelectorAll('a[href]')).map(a=>a.href)
            .filter(h => h && h.includes('douyin.com/video')).slice(0,5)
        """)
        print("video 链接数:", len(links), links[:2] if links else "无")

    if links:
        try:
            async with page.expect_navigation(timeout=6000):
                await page.goto(links[0], wait_until="domcontentloaded", timeout=40000)
        except Exception:
            pass
        await page.wait_for_timeout(5000)

    pv = await perf_video(page)
    print("perf douyinvod after open:", len(pv))
    for u in pv:
        print("   ", u[:110])
    iframes = await page.evaluate("Array.from(document.querySelectorAll('iframe')).map(f=>f.src.slice(0,80))")
    print("iframes:", iframes)
    detail = [u for u in reqs if "detail" in u or "aweme/v1/web" in u]
    print("aweme api requests:", len(detail))
    for u in detail[:6]:
        print("   ", u[:100])
    await browser.close()


async def main():
    async with async_playwright() as p:
        await probe_video_page(p)
        print()
        await probe_search(p)


asyncio.run(main())
