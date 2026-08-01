// 第一步验证：JS 流式帧解析能否从 general/search/stream 响应提取条目（含直链）
(async () => {
  // JS 版 parse_search_body：逐行 JSON.parse，提取 data[].aweme_info
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

  // 发起一次真实搜索请求，拿完整 body
  const r = await fetch(
    '/aweme/v1/web/general/search/stream/?aid=6383&keyword=%E7%BE%8E%E9%A3%9F&search_channel=aweme_general&sort_type=0',
    { credentials: 'include' });
  const body = await r.text();
  const items = parseSearchBody(body);

  return {
    body_len: body.length,
    items_count: items.length,
    sample: items.slice(0, 4).map(ai => ({
      id: String(ai.aweme_id),
      title: (ai.desc || '').slice(0, 22),
      author: (ai.author || {}).nickname,
      bitrate: ((ai.video || {}).bit_rate || []).length,
      first_url: (((ai.video || {}).bit_rate || [])[0]?.play_addr?.url_list?.[0] || '').slice(0, 55),
    })),
  };
})()
