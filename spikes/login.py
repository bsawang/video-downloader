"""登录抖音，登录态持久化到 spikes/login-profile/（后续测试用 --profile 复用）。

用法:
  .venv/Scripts/python spikes/login.py

流程:
  打开 Edge 窗口（headed）→ 用户在窗口里扫码或输手机号登录
  → 检测到登录 cookie（sessionid 等）→ 自动保存并关闭窗口
  → 之后 .venv/Scripts/python spikes/run.py --url ... --profile spikes/login-profile 复用登录态

说明:
  - profile 目录保留登录态，不会删除；重跑本脚本若已登录会直接跳过。
  - 抖音对自动化有风控（get/user/risklevel），首次登录/长时间未用可能触发验证码，页面里正常过即可。
"""
import asyncio
import pathlib
import sys
import time

from playwright.async_api import async_playwright

if hasattr(sys.stdout, "reconfigure"):  # Windows 终端按 UTF-8 解读，强制 UTF-8 防乱码
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROFILE = ROOT / "spikes" / "login-profile"

# 抖音 web 登录后出现的核心 cookie
LOGIN_COOKIES = {"sessionid", "sid_tt", "uid_tt"}

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


async def logged_in_cookies(ctx):
    cookies = await ctx.cookies()
    return [c["name"] for c in cookies if c["name"] in LOGIN_COOKIES]


async def main():
    PROFILE.mkdir(parents=True, exist_ok=True)
    print(f"profile 目录: {PROFILE}")
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            channel="msedge",
            headless=False,
            viewport={"width": 1280, "height": 900},
            user_agent=UA,
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        already = await logged_in_cookies(ctx)
        if already:
            print("已检测到登录态（cookie:", already, "），无需重新登录。")
            await ctx.close()
            return 0

        print("请在打开的窗口里登录抖音（扫码或手机号）。检测到登录后自动保存关闭...")
        try:
            await page.goto("https://www.douyin.com/", wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            print("goto 警告:", type(e).__name__, str(e)[:120])

        deadline = time.time() + 300  # 最多等 5 分钟
        while time.time() < deadline:
            hits = await logged_in_cookies(ctx)
            if hits:
                print("登录成功! 已保存登录态（cookie:", hits, "）")
                print(f"后续测试: .venv/Scripts/python spikes/run.py --url <链接> --profile {PROFILE}")
                await page.wait_for_timeout(2500)  # 让用户看到成功提示
                await ctx.close()
                return 0
            await page.wait_for_timeout(2000)

        print("超时(5 分钟)未检测到登录。profile 已保留，直接重跑本脚本可继续登录。")
        await ctx.close()
        return 1


sys.exit(asyncio.run(main()))
