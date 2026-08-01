// 第五步验证：动态 redraw — MutationObserver 监听新卡片 + 数据到达自动补图标
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

  // redraw：扫描所有卡片，给"有数据且未渲染"的打图标（挂 videoImage，不动卡片根 position）
  const redraw = () => {
    let n = 0;
    for (const card of document.querySelectorAll('[id^="waterfall_item_"]')) {
      const id = card.id.replace('waterfall_item_', '');
      const data = window.__dlMap.get(id);
      if (!data || !data.url) continue;
      if (card.querySelector('[data-dl-icon]')) continue;
      const anchor = card.querySelector('.videoImage');
      if (!anchor) continue;
      const btn = document.createElement('button');
      btn.setAttribute('data-dl-icon', '1');
      btn.textContent = '⬇';
      btn.title = data.title + '  @' + data.author;
      btn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:99999;' +
        'background:rgba(47,107,255,.92);color:#fff;border:none;border-radius:8px;' +
        'padding:5px 10px;font-size:13px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.35);';
      btn.onclick = () => { btn.textContent = '✓'; setTimeout(() => btn.textContent = '⬇', 1200); };
      anchor.appendChild(btn);
      n++;
    }
    return n;
  };
  window.__redraw = redraw;

  // hook：数据到达 → redraw
  window.__dlMap = window.__dlMap || new Map();
  if (!window.__dlHook2) {
    window.__dlHook2 = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const resp = await orig(...args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;
        if (url && url.includes('general/search')) {
          const body = await resp.clone().text();
          const items = parseSearchBody(body);
          let changed = false;
          for (const ai of items) {
            const id = String(ai.aweme_id);
            if (!window.__dlMap.has(id)) changed = true;
            const brs = (ai.video || {}).bit_rate || [];
            window.__dlMap.set(id, {
              title: (ai.desc || '').slice(0, 40),
              author: (ai.author || {}).nickname || '',
              url: (brs[0]?.play_addr?.url_list?.[0] || ''),
            });
          }
          if (changed) redraw();
        }
      } catch (e) {}
      return resp;
    };
  }

  // MutationObserver：新卡片出现 → 防抖 redraw
  if (!window.__dlObs) {
    window.__dlObs = true;
    let t = null;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => redraw(), 300);
    }).observe(document.body, { childList: true, subtree: true });
  }

  const count = () => ({
    icons: document.querySelectorAll('[data-dl-icon]').length,
    cards: document.querySelectorAll('[id^="waterfall_item_"]').length,
    map: window.__dlMap.size,
  });
  const before = count();

  // 触发滚动加载更多（模拟用户往下翻）
  for (let i = 0; i < 8; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1800));
    window.scrollBy(0, -300);
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 3000));
  const after = count();

  return { before, after, delta: { cards: after.cards - before.cards, icons: after.icons - before.icons, map: after.map - before.map } };
})()
