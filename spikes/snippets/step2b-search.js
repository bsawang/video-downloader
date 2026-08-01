// 第二步b：装 hook（存 Map）+ 页面内触发真实搜索 → 数据被捕获 + 页面跳转结果页
(async () => {
  const parseSearchBody = (body) => {
    const items = [];
    const seen = new Set();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('{')) continue;
      let j;
      try { j = JSON.parse(line); } catch (e) { continue; }
      if (!j || typeof j !== 'object') continue;
      const d = j.data;
      if (!Array.isArray(d)) continue;
      for (const it of d) {
        const ai = it && it.aweme_info;
        if (!ai || !ai.aweme_id) continue;
        const id = String(ai.aweme_id);
        if (!seen.has(id)) { seen.add(id); items.push(ai); }
      }
    }
    return items;
  };

  window.__dlMap = window.__dlMap || new Map();
  if (!window.__dlHook) {
    window.__dlHook = true;
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const resp = await origFetch(...args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;
        if (url && url.includes('general/search')) {
          const clone = resp.clone();
          const body = await clone.text();
          const items = parseSearchBody(body);
          for (const ai of items) {
            const brs = (ai.video || {}).bit_rate || [];
            window.__dlMap.set(String(ai.aweme_id), {
              title: (ai.desc || '').slice(0, 40),
              author: (ai.author || {}).nickname || '',
              url: (brs[0]?.play_addr?.url_list?.[0] || ''),
            });
          }
        }
      } catch (e) {}
      return resp;
    };
  }

  // 页面内触发真实搜索（点击搜索框 → setter 设值 → input/keydown/keyup 回车）
  const box = document.querySelector('input[data-e2e*="search"]');
  if (!box) return { error: 'no search box', map: window.__dlMap.size };
  box.click();
  await new Promise(r => setTimeout(r, 500));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(box, '美食');
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  box.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

  await new Promise(r => setTimeout(r, 8000));
  return {
    map_size: window.__dlMap.size,
    url: location.href.slice(0, 70),
    title: document.title.slice(0, 30),
    waterfall: document.querySelectorAll('[class*="waterfall"]').length,
    card_with_link: Array.from(document.querySelectorAll('[class*="waterfall"]')).filter(c => c.querySelector('[href*="/video/"]')).length,
  };
})()
