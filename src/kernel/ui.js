let activePop = null;
let toastEl = null;
let hoverStyle = null;

// hover 揭示走 CSS 而不是 mouseenter 监听：按钮挂载时指针可能已经停在卡片上，
// 浏览器不会再补发 mouseenter，监听方案会出现「不动鼠标就一直不显示」。
export function ensureHoverStyle() {
  if (hoverStyle && hoverStyle.isConnected) return;
  const root = document.head || document.documentElement;
  if (!root) return;
  hoverStyle = document.createElement("style");
  hoverStyle.textContent = "[data-dl-hover]:hover>[data-dl-icon]{display:block!important}";
  root.appendChild(hoverStyle);
}

export function createButton(item, { isDetail, onPick, onOpen, iconRight }) {
  const btn = document.createElement("button");
  btn.setAttribute("data-dl-icon", "1");
  btn.textContent = isDetail ? "⬇ 下载" : "⬇";
  btn.title = (item.title || "").slice(0, 30);
  // text-indent:0：站点有 [title^=「] 之类的规则，会把带 title 的按钮按标题排缩进
  btn.style.cssText = isDetail
    ? "position:absolute;right:16px;bottom:16px;z-index:99999;text-indent:0;" +
      "background:rgba(47,107,255,.95);color:#fff;border:none;border-radius:10px;" +
      "padding:10px 18px;font-size:15px;font-weight:600;cursor:pointer;" +
      "box-shadow:0 3px 10px rgba(0,0,0,.4);"
    : "position:absolute;top:8px;right:8px;z-index:99999;text-indent:0;" +
      "background:rgba(47,107,255,.92);color:#fff;border:none;border-radius:8px;" +
      "padding:5px 10px;font-size:13px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.35);";
  btn.style.display = "none";
  // 卡片右上角常被站点自己的 hover 控件（如「稍后再看」）占用，按规则让位
  if (!isDetail && iconRight != null) btn.style.right = iconRight + "px";
  // onOpen：占位条目（卡片页只知 bvid）在弹层前现取档位，可能等接口
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    let cur = item;
    if (onOpen) {
      try {
        cur = await onOpen();
      } catch (err) {
        return;
      }
    }
    if (!cur || !cur.streams || !cur.streams.length || !btn.isConnected) return;
    openPopover(btn, cur, (stream) => onPick(stream, cur));
  });
  return btn;
}

export function openPopover(anchorEl, item, onPick) {
  closePopover();
  const rect = anchorEl.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.setAttribute("data-dl-pop", "1");
  pop.style.cssText =
    "position:fixed;z-index:999999;background:#1f2937;color:#f3f4f6;" +
    "border-radius:10px;padding:6px;box-shadow:0 6px 20px rgba(0,0,0,.5);" +
    "font-size:13px;min-width:150px;font-family:system-ui,sans-serif;";
  const popW = 165;
  let left = rect.right - popW;
  if (left < 8) left = 8;
  let top = rect.bottom + 6;
  if (top + 140 > window.innerHeight) top = rect.top - 6 - 140;
  pop.style.left = left + "px";
  pop.style.top = top + "px";

  const title = document.createElement("div");
  title.textContent = (item.title || "").slice(0, 22);
  title.style.cssText =
    "font-weight:600;padding:6px 8px;border-bottom:1px solid #374151;margin-bottom:4px;" +
    "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px;";
  pop.appendChild(title);

  for (const stream of item.streams) {
    const row = document.createElement("button");
    row.textContent = "⬇ " + stream.label;
    row.style.cssText =
      "display:block;width:100%;text-align:left;background:none;color:#f3f4f6;" +
      "border:none;padding:7px 8px;border-radius:6px;cursor:pointer;";
    row.addEventListener("mouseenter", () => (row.style.background = "#374151"));
    row.addEventListener("mouseleave", () => (row.style.background = "none"));
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick(stream);
      closePopover();
    });
    pop.appendChild(row);
  }

  document.documentElement.appendChild(pop);
  activePop = pop;
  setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
  window.addEventListener("scroll", closePopover, { capture: true, once: true });
}

function onDocClick(e) {
  if (e.target.closest("[data-dl-pop]") || e.target.closest("[data-dl-icon]")) return;
  closePopover();
}

export function closePopover() {
  if (activePop) {
    activePop.remove();
    activePop = null;
  }
  document.removeEventListener("click", onDocClick, true);
}

export function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.setAttribute("data-dl-toast", "1");
    toastEl.style.cssText =
      "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "background:#111827;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.4);";
  }
  if (!toastEl.isConnected) document.documentElement.appendChild(toastEl);
  toastEl.textContent = msg;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.remove(), 2500);
}
