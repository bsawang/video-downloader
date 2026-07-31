"""调查下载内容：抓 detail → 下载最高清晰度 → ffprobe 检查是否有音轨/分辨率。"""
import asyncio
import subprocess

import httpx
from playwright.async_api import async_playwright

VIDEO_URL = "https://www.douyin.com/video/7666780213276190857"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
FFPROBE = "H:/ComfyUI_Windows_portable/python_standalone/Scripts/ffprobe.exe"


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


def download(url):
    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=60) as c:
        with c.stream("GET", url) as r:
            return r.read()


def probe(path):
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries",
         "stream=index,codec_type,codec_name,width,height,sample_rate",
         "-of", "default=noprint_wrappers=1", path],
        capture_output=True, text=True, timeout=60,
    ).stdout
    return out


async def main():
    item = await get_detail()
    video = item["video"]
    print("desc:", (item.get("desc") or "")[:40])
    print("has_watermark:", video.get("has_watermark"))
    print("has_audio field:", "bit_rate_audio" in video, "| audio field:", "audio" in video)
    print("--- bit_rate 列表 ---")
    for i, br in enumerate(video.get("bit_rate") or []):
        pa = (br.get("play_addr") or {}).get("url_list") or [""]
        print(f"[{i}] gear={br.get('gear_name')} quality_type={br.get('quality_type')} url={pa[0][:60]}")
    print("--- 下载 bit_rate[0] 并 ffprobe ---")
    url0 = (video["bit_rate"][0]["play_addr"]["url_list"])[0]
    data = download(url0)
    path = "spikes/tmp_download.mp4"
    with open(path, "wb") as f:
        f.write(data)
    print(f"下载 {len(data)} bytes")
    print(probe(path))


asyncio.run(main())
