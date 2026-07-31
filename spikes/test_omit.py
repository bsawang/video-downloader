"""验证：页面 fetch(url, {credentials:'omit'}) 能否绕过 CORS 读取视频数据。"""
import asyncio

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
    return captured["data"]["aweme_detail"]["video"]["bit_rate"][0]["play_addr"]["url_list"][0]


async def main():
    url = await get_fresh_url()
    print("url:", url[:80], "...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        ctx = await browser.new_context(user_agent=UA)
        page = await ctx.new_page()
        await page.goto("https://www.douyin.com/", wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)

        # 测试 fetch with credentials omit
        result = await page.evaluate(
            f"""
            (async () => {{
              try {{
                const resp = await fetch({url!r}, {{ credentials: "omit" }});
                if (!resp.ok) return {{ ok: false, status: resp.status }};
                const reader = resp.body.getReader();
                let got = 0;
                for (;;) {{
                  const {{ done, value }} = await reader.read();
                  if (done) break;
                  got += value.length;
                  if (got >= 300000) break;
                }}
                return {{ ok: true, status: resp.status, bytes: got, ctype: resp.headers.get('content-type') }};
              }} catch (e) {{
                return {{ ok: false, error: String(e) }};
              }}
            }})()
            """
        )
        print("fetch omit 结果:", result)

        # 测试 blob → <a download>
        dl_result = await page.evaluate(
            f"""
            (async () => {{
              try {{
                const resp = await fetch({url!r}, {{ credentials: "omit" }});
                const blob = await resp.blob();
                const blobUrl = URL.createObjectURL(blob);
                return {{ ok: true, blobSize: blob.size, blobUrlPrefix: blobUrl.slice(0,20) }};
              }} catch (e) {{
                return {{ ok: false, error: String(e) }};
              }}
            }})()
            """
        )
        print("blob 结果:", dl_result)
        await browser.close()


asyncio.run(main())
