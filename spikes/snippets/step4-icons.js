// 第四步验证：在匹配到数据的卡片上渲染下载图标（redraw 按钮）
(() => {
  const cards = document.querySelectorAll('[id^="waterfall_item_"]');
  let rendered = 0;
  for (const card of cards) {
    const id = card.id.replace('waterfall_item_', '');
    const data = window.__dlMap.get(id);
    if (!data || !data.url) continue;
    if (card.querySelector('[data-dl-icon]')) continue;  // 已渲染过

    card.style.position = card.style.position || 'relative';
    const btn = document.createElement('button');
    btn.setAttribute('data-dl-icon', '1');
    btn.textContent = '⬇';
    btn.title = data.title + '  @' + data.author;
    btn.style.cssText = 'position:absolute;top:10px;right:10px;z-index:99999;' +
      'background:rgba(47,107,255,.9);color:#fff;border:none;border-radius:8px;' +
      'padding:6px 12px;font-size:14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);';
    btn.onclick = () => { btn.textContent = '✓'; setTimeout(() => btn.textContent = '⬇', 1200); };
    card.appendChild(btn);
    rendered++;
  }
  return {
    rendered_icons: rendered,
    total_cards: cards.length,
    map_size: window.__dlMap.size,
    icon_elements: document.querySelectorAll('[data-dl-icon]').length,
  };
})()
