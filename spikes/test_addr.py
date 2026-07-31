"""对比 play_addr vs download_addr：URL 形态、httpx 状态、ACAO 响应头。"""
import asyncio

import httpx
from playwright.async_api import async_playwright

VIDEO_URL = "https://www.douyin.com/video/7666780213276190857"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


async def get_detail():
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
    return captured["data"]["aweme_detail"]


def probe(url, label):
    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=20) as c:
        r = c.get(url)
    print(f"[{label}] status={r.status_code} len={len(r.content)}")
    acao = r.headers.get("access-control-allow-origin")
    cd = r.headers.get("content-disposition")
    ct = r.headers.get("content-type")
    print(f"    ACAO={acao} | Content-Disposition={cd} | Content-Type={ct}")
    print(f"    url={url[:90]}")


async def main():
    item = await get_detail()
    video = item["video"]
    pa = video.get("play_addr", {}).get("url_list", [""])[0]
    da = video.get("download_addr", {}).get("url_list", [""])[0]
    da_logo = video.get("download_suffix_logo_addr", {}).get("url_list", [""])[0]
    print("has_watermark:", video.get("has_watermark"))
    print("== play_addr (无水印播放源) ==")
    probe(pa, "play_addr")
    if da:
        print("== download_addr ==")
        probe(da, "download_addr")
    if da_logo:
        print("== download_suffix_logo_addr (带水印?) ==")
        probe(da_logo, "download_logo")
    # 第一路 bit_rate 的 play_addr 是否和顶层 play_addr 相同
    br0 = video["bit_rate"][0]["play_addr"]["url_list"][0]
    print("== bit_rate[0].play_addr == 顶层 play_addr ?", br0 == pa)


asyncio.run(main())
