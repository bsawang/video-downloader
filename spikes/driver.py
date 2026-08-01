"""常驻抖音浏览器 + CDP 连接管理（解决测试反复开闭浏览器）。

用法:
  .venv/Scripts/python spikes/driver.py start    # 启动常驻 Edge（后台，含登录态，窗口常驻）
  .venv/Scripts/python spikes/driver.py status   # 查看是否运行中
  .venv/Scripts/python spikes/driver.py stop     # 关闭常驻 Edge

配合 run.py / search.py：
  常驻浏览器运行时，测试/搜索命令自动通过 CDP 连接它执行（只关 tab，浏览器不关），
  改代码后重跑 = 刷新页面，秒级完成；无常驻时自动退回冷启动（兼容原流程）。

profile 复用：直接用 spikes/login-profile（登录态），所以常驻浏览器一开就有登录态。
注意：常驻期间不要再用 run.py --profile spikes/login-profile 冷启动（会锁冲突），
连接模式不需要 --profile。
"""
import argparse
import asyncio
import pathlib
import subprocess
import sys
import time
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROFILE = ROOT / "spikes" / "login-profile"
PORT = 9222

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_edge():
    for p in EDGE_CANDIDATES:
        if pathlib.Path(p).exists():
            return p
    # 退回用 Playwright 探测的路径
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            return p.chromium.launch(channel="msedge").executable_path or None
    except Exception:
        return None


def cdp_ready(port=PORT):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
        return True
    except Exception:
        return False


def start(port=PORT):
    if cdp_ready(port):
        print(f"常驻浏览器已在运行 (port {port})")
        return 0
    edge = find_edge()
    if not edge:
        print("找不到 msedge，无法启动")
        return 1
    PROFILE.mkdir(parents=True, exist_ok=True)
    cmd = [
        edge,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={str(PROFILE)}",
        "--no-first-run", "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
        "https://www.douyin.com/",
    ]
    print("启动常驻 Edge:", edge)
    subprocess.Popen(cmd, creationflags=subprocess.CREATE_NO_WINDOW,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        if cdp_ready(port):
            print(f"就绪! http://127.0.0.1:{port}/json/version")
            print("现在直接跑: .venv/Scripts/python spikes/search.py 舞蹈 --index 1")
            return 0
        time.sleep(1)
    print("启动超时（40s 未就绪）。可能 profile 被占用，先跑 driver.py stop")
    return 1


def status(port=PORT):
    if cdp_ready(port):
        print(f"运行中 (port {port})")
        return 0
    print("未运行")
    return 1


def stop(port=PORT):
    if not cdp_ready(port):
        print("未运行，无需关闭")
        return 0
    async def _stop():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            try:
                browser = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
                # connect_over_cdp 的 browser.close() 只断开连接，不关进程；
                # 必须发 CDP Browser.close 命令才能真正关掉浏览器。
                session = await browser.new_browser_cdp_session()
                await session.send("Browser.close")
                return True
            except Exception as e:
                print("CDP 关闭失败:", str(e)[:80])
                return False
    if asyncio.run(_stop()):
        for _ in range(20):
            if not cdp_ready(port):
                print("已关闭")
                return 0
            time.sleep(1)
        print("端口仍活跃，可能未被 CDP 关闭；可手动关窗口或 taskkill")
        return 1
    print("关闭失败（可能需手动关浏览器窗口）")
    return 1


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["start", "stop", "status"])
    ap.add_argument("--port", type=int, default=PORT)
    args = ap.parse_args()
    if args.cmd == "start":
        return start(args.port)
    if args.cmd == "status":
        return status(args.port)
    return stop(args.port)


if __name__ == "__main__":
    sys.exit(main())
