"""spikes/probe_profile.py — 探测「我的作品」页数据流（一次性诊断脚本）。

连接常驻浏览器（driver.py start --extension 已加载插件），注入 init-script 探针
（跨 reload 存活），导航到个人主页作品 tab，统计：
  · 页面 world 能否截到含 aweme_id + video.bit_rate 的响应（插件 main 同款逻辑）
  · 插件 main 是否发出 video_candidates 消息、消息里有什么
  · 隔离世界是否渲染了下载按钮（data-dl-icon）
  · 卡片锚点统计（record_card / a[href*=video] 等）
"""
import asyncio
import json
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

URL = "https://www.douyin.com/user/self?from_tab_name=main&showTab=record"

# init-script 探针：在 document_start 注入，跨导航存活
INIT_PROBE = r"""
(() => {
  if (window.__probeInstalled) return;
  window.__probeInstalled = true;
  window.__probe = {
    pageWorldResponses: 0,     // 页面 world fetch 见到的含 video.bit_rate 的响应数
    pageWorldWithAweme: 0,
    pageWorldSample: [],
    extMessages: [],           // 插件 postMessage 消息摘要
    extCandidates: [],         // video_candidates 里的 aweme_id
    installs: 0,
  };

  // 1) 页面 world fetch 探针（main.v05.js 是 document_start 注入，会先 hook；
  //    我们记录它 hook 前后各自的可见性）
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const r = await origFetch(...args);
    try {
      const body = await r.clone().text();
      const hasAweme = /aweme_id/.test(body) && /bit_rate/.test(body);
      if (hasAweme) {
        window.__probe.pageWorldResponses++;
        const first = body.indexOf('aweme_id');
        const snip = body.slice(Math.max(0, first - 60), first + 60);
        window.__probe.pageWorldSample.push({url: String(args[0]).slice(0, 130), snip});
      }
    } catch (e) {}
    return r;
  };

  // 2) 插件消息探针（main/isolated 都用 postMessage 同源通信）
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.type === 'DY_EXT_MESSAGE' && d.payload) {
      const p = d.payload;
      if (p.kind === 'video_candidates') {
        window.__probe.extCandidates.push(...(p.candidates || []).map(c => c.aweme_id));
      }
      if (window.__probe.extMessages.length < 30) {
        window.__probe.extMessages.push({kind: p.kind, n: (p.candidates || []).length});
      }
    }
  });
})();
"""


async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        ctx = browser.contexts[0]
        page = await ctx.new_page()
        await ctx.add_init_script(INIT_PROBE)
        try:
            await page.goto(URL, wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            print("goto 警告:", type(e).__name__, str(e)[:120])
        await page.wait_for_timeout(8000)

        probe = await page.evaluate("window.__probe")

        # 卡片 id vs 候选 id 覆盖率
        coverage = await page.evaluate("""(() => {
          const cand = new Set(window.__probe.extCandidates || []);
          const ids = Array.from(document.querySelectorAll('a[href*="/video/"]'))
            .map(a => (a.getAttribute('href').match(/\\/video\\/(\\d+)/) || [])[1])
            .filter(Boolean);
          return {
            cardLinks: ids.length,
            uniqueCards: new Set(ids).size,
            matched: ids.filter(id => cand.has(id)).length,
            unmatched: [...new Set(ids.filter(id => !cand.has(id)))].slice(0, 8),
          };
        })()""")

        # 隔离世界不可直接访问，但可通过 main 世界转发：检查按钮数量即可
        buttons = await page.evaluate("document.querySelectorAll('[data-dl-icon]').length")
        anchors = await page.evaluate("""(() => ({
          recordCard: document.querySelectorAll('li.record_card, li.w3Hhjm5i').length,
          videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
          dataAwemeId: document.querySelectorAll('[data-aweme-id]').length,
          waterfall: document.querySelectorAll('[id^="waterfall_item_"]').length,
        }))()""")

        print("== 页面 world 探针 ==")
        print("  含 bit_rate 的响应数:", probe["pageWorldResponses"])
        print("  样本(前3):")
        for s in probe["pageWorldSample"][:3]:
            print("    url:", s["url"][:100])
            print("    snip:", s["snip"][:100])
        print("== 插件消息 ==")
        print("  extMessages:", probe["extMessages"][:10])
        print("  候选 id 数:", len(set(probe["extCandidates"])))
        print("  候选 id 前10:", probe["extCandidates"][:10])
        print("== 卡片覆盖 ==")
        print("  卡片链接:", coverage["cardLinks"], "| 去重:", coverage["uniqueCards"])
        print("  有候选:", coverage["matched"], "| 无候选:", coverage["unmatched"])
        print("== DOM ==")
        print("  下载按钮:", buttons)
        print("  锚点统计:", anchors)
        await page.close()


if __name__ == "__main__":
    asyncio.run(main())
