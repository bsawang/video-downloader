// 第七步：会话式探测首页匹配规律——滚动触发 feed → 拿 aweme_id → 反搜 DOM 找稳定锚点
(async () => {
  // ① 装 hook 记录 feed 响应
  window.__feedBodies = window.__feedBodies || [];
  if (!window.__feedHook) {
    window.__feedHook = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const resp = await orig(...args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;
        if (url && (url.includes('/feed/') || url.includes('aweme/v1/web/feed') || url.includes('general/feed'))) {
          window.__feedBodies.push({ url: url.slice(0, 70), body: await resp.clone().text() });
        }
      } catch (e) {}
      return resp;
    };
  }

  // ② 滚动首页触发新 feed（异步数据流）
  const scrollY = window.scrollY;
  for (let i = 0; i < 6; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 2000));
    window.scrollBy(0, -200);
    await new Promise(r => setTimeout(r, 500));
  }

  // ③ 解析 feed 响应 → aweme_id 列表
  const ids = [];
  for (const fb of window.__feedBodies) {
    for (const line of fb.body.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        const j = JSON.parse(t);
        const d = j.data || j.aweme_list || [];
        if (Array.isArray(d)) for (const it of d) if (it.aweme_id) ids.push(String(it.aweme_id));
      } catch (e) {}
    }
  }
  const uniqueIds = [...new Set(ids)].slice(0, 6);

  // ④ 用 aweme_id 反搜整个 DOM：找它藏在哪个属性/位置
  const results = {};
  for (const id of uniqueIds) {
    const found = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      for (const a of el.attributes) {
        if (a.value && a.value.includes(id)) {
          found.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 30), attr: a.name, val: a.value.slice(0, 45) });
        }
      }
      if (found.length >= 3) break;
    }
    results[id] = found;
  }

  return {
    feed_bodies: window.__feedBodies.length,
    ids: uniqueIds,
    results,
    card_hrefs: Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(h => h.includes('video') || h.includes('modal')).slice(0, 5),
  };
})()
