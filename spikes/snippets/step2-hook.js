// 第二步验证：fetch hook 拦截搜索响应 → 解析 → 累积进全局 Map（按 aweme_id 去重）
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

  // 全局 Map：aweme_id → 下载所需摘要
  window.__dlMap = window.__dlMap || new Map();

  // 安装持久 hook（只装一次）
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
              label: (brs[0]?.play_addr ? 'ready' : 'no-url'),
              url: (brs[0]?.play_addr?.url_list?.[0] || ''),
            });
          }
        }
      } catch (e) {}
      return resp;
    };
  }

  const sizeBefore = window.__dlMap.size;
  // 触发两次不同关键词的搜索（模拟滚动/换词的异步新流）
  for (const kw of ['%E7%BE%8E%E9%A3%9F', '%E4%B9%A6%E6%B3%95']) {
    try {
      await fetch('/aweme/v1/web/general/search/stream/?aid=6383&keyword=' + kw +
        '&search_channel=aweme_general&sort_type=0', { credentials: 'include' });
    } catch (e) {}
    await new Promise(r => setTimeout(r, 2500));
  }
  const sizeAfter = window.__dlMap.size;
  return {
    hook_installed: window.__dlHook,
    map_before: sizeBefore,
    map_after: sizeAfter,
    sample: Array.from(window.__dlMap.entries()).slice(0, 4).map(([id, v]) => ({
      id, title: v.title, author: v.author, has_url: !!v.url,
    })),
  };
})()
