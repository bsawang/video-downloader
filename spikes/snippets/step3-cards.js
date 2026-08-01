// 第三步验证：卡片 ↔ Map 双向对齐（MutationObserver 监听 + 从卡片提取 aweme_id）
(() => {
  const scanCards = () => {
    const cards = document.querySelectorAll('.waterfall-videoCardContainer');
    const out = [];
    for (const card of cards) {
      const linkEl = card.querySelector('[href*="/video/"]');
      if (!linkEl) continue;
      const m = (linkEl.getAttribute('href') || '').match(/\/video\/(\d+)/);
      if (!m) continue;
      const id = m[1];
      const data = window.__dlMap.get(id);
      out.push({ id, has_data: !!data, title: data ? data.title.slice(0, 20) : null });
    }
    return out;
  };

  const found = scanCards();
  const matched = found.filter(x => x.has_data);

  // 安装 MutationObserver（模拟插件监听新卡片 → redraw）
  if (!window.__cardObs) {
    window.__cardObs = true;
    window.__cardObsCount = 0;
    new MutationObserver(() => {
      window.__cardObsCount++;
    }).observe(document.body, { childList: true, subtree: true });
  }

  return {
    cards_found: found.length,
    cards_matched: matched.length,
    match_rate: found.length ? (matched.length / found.length * 100).toFixed(0) + '%' : 'n/a',
    sample: found.slice(0, 8).map(x => ({ id: x.id, matched: x.has_data })),
    observer_active: window.__cardObs,
  };
})()
