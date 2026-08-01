// 第四步修复：撤销对卡片根 position 的修改，图标挂到内部 videoImage（已有定位上下文）
(() => {
  const cards = document.querySelectorAll('[id^="waterfall_item_"]');
  // ① 撤销之前的破坏：移除图标 + 清空卡片根内联 position
  let restored = 0;
  for (const card of cards) {
    const icon = card.querySelector('[data-dl-icon]');
    if (icon) icon.remove();
    if (card.style.position) { card.style.position = ''; restored++; }
  }

  // ② 重新渲染：图标 absolute 挂到 videoImage（本来就是 relative，不改任何布局）
  let rendered = 0;
  for (const card of cards) {
    const id = card.id.replace('waterfall_item_', '');
    const data = window.__dlMap.get(id);
    if (!data || !data.url) continue;
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
    rendered++;
  }

  // ③ 确认布局是否恢复：检查卡片根位置恢复
  return {
    restored_pos: restored,
    rendered: rendered,
    first_card_pos: cards[0] ? getComputedStyle(cards[0]).position : 'n/a',
    anchor_pos: cards[0] ? getComputedStyle(cards[0].querySelector('.videoImage')).position : 'n/a',
    icons_in_anchor: cards[0] ? cards[0].querySelectorAll('.videoImage [data-dl-icon]').length : 0,
  };
})()
