// 第六步调查：搜索结果响应完整性 vs 页面卡片构成
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

  // ① 手动发搜索请求，看完整响应
  const r = await fetch('/aweme/v1/web/general/search/stream/?aid=6383&keyword=%E7%BE%8E%E9%A3%9F&search_channel=aweme_general&sort_type=0',
    { credentials: 'include' });
  const body = await r.text();
  const items = parseSearchBody(body);
  const withVideo = items.filter(ai => ((ai.video || {}).bit_rate || []).length > 0);
  const withCover = items.filter(ai => (ai.video || {}).cover);

  // ② 页面卡片构成
  const cards = Array.from(document.querySelectorAll('[id^="waterfall_item_"]'));
  const hasVideoImage = cards.filter(c => c.querySelector('.videoImage')).length;
  const isText = cards.filter(c => (c.innerText || '').includes('图文')).length;
  const inMap = cards.filter(c => window.__dlMap.has(c.id.replace('waterfall_item_', ''))).length;

  return {
    search_response: {
      body_len: body.length,
      items: items.length,
      with_video_bitrate: withVideo.length,
      with_cover: withCover.length,
    },
    page_cards: {
      total: cards.length,
      has_video_image: hasVideoImage,
      text_notes: isText,
      matched_in_map: inMap,
      map_size: window.__dlMap.size,
    },
  };
})()
