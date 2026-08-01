// 隔离世界脚本 v0.5.2。统一"视频上叠下载按钮"机制（迅雷式）。
//
// 匹配规律：不依赖单一页面 class/id，用**多锚点扫描**（aweme_id 作为 DOM 属性值）：
//   ① [data-aweme-id]      （首页/精选页 discover-video-card-item）
//   ② [id^="waterfall_item_"]（搜索/推荐列表页）
//   ③ [class*="video_"]     （详情页播放器容器）
// 任一命中 → 查 candidates Map（main 通用提取来的数据）→ 命中则叠下载按钮。
// 按钮 hover 才显示，点击弹清晰度 popover。挂载到卡片内部定位上下文（.videoImage 或自身非 static），
// 绝不改宿主元素 position（瀑布流卡片根是 absolute，改了破坏布局）。
(() => {
  console.log("[dy-dl] isolated v0.5.2");
  const MSG = "DY_EXT_MESSAGE";
  const candidates = new Map(); // aweme_id → {title, author, streams:[{label,url}]}
  const rendered = new WeakSet(); // 已渲染按钮的元素
  let fallbackUrl = null;
  let activePop = null;

  // ---- 收页面世界消息 ----
  window.addEventListener("message", (ev) => {
    if (!ev.data || ev.data.type !== MSG) return;
    const p = ev.data.payload;
    if (!p) return;
    if (p.kind === "video_candidates") {
      for (const c of p.candidates || []) candidates.set(String(c.aweme_id), c);
      renderAll();
    } else if (p.kind === "download_progress") {
      toast("下载中 " + (p.total ? Math.round((p.received / p.total) * 100) + "%" : "…"));
    } else if (p.kind === "download_status") {
      toast(p.ok ? "✓ 下载完成" : "✗ 下载失败：" + (p.error || ""));
    } else if (p.kind === "fallback_video" && p.url) {
      fallbackUrl = p.url;
      renderAll();
    }
  });

  // ---- 多锚点扫描：找出页面上所有"含视频 id"的元素 ----
  function scanCards() {
    const found = [];
    const seen = new Set();
    const add = (el, id) => {
      if (!id || seen.has(el)) return;
      seen.add(el);
      found.push({ el, id });
    };
    document.querySelectorAll("[data-aweme-id]").forEach((el) => add(el, el.getAttribute("data-aweme-id")));
    document.querySelectorAll('[id^="waterfall_item_"]').forEach((el) => add(el, el.id.replace("waterfall_item_", "")));
    document.querySelectorAll('[class*="video_"]').forEach((el) => {
      const m = String(el.className).match(/video_(\d+)/);
      if (m) add(el, m[1]);
    });
    return found;
  }

  function isDetailContainer(el) {
    return el.tagName === "XG-VIDEO-CONTAINER" || /video_\d+/.test(String(el.className)) || !!el.querySelector("video");
  }

  function mountButton(el, data) {
    // 挂载锚点：内部封面容器优先，否则元素自身（若已是定位上下文）
    const anchor =
      el.querySelector(".videoImage") ||
      (getComputedStyle(el).position !== "static" ? el : null);
    if (!anchor) return;

    const isDetail = isDetailContainer(el);
    const btn = document.createElement("button");
    btn.setAttribute("data-dl-icon", "1");
    btn.textContent = isDetail ? "⬇ 下载" : "⬇";
    btn.title = (data.title || "").slice(0, 30);
    btn.style.cssText = isDetail
      ? "position:absolute;right:16px;bottom:16px;z-index:99999;" +
        "background:rgba(47,107,255,.95);color:#fff;border:none;border-radius:10px;" +
        "padding:10px 18px;font-size:15px;font-weight:600;cursor:pointer;" +
        "box-shadow:0 3px 10px rgba(0,0,0,.4);"
      : "position:absolute;top:8px;right:8px;z-index:99999;" +
        "background:rgba(47,107,255,.92);color:#fff;border:none;border-radius:8px;" +
        "padding:5px 10px;font-size:13px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.35);";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPopover(btn, data);
    });
    anchor.appendChild(btn);

    // hover 显示
    btn.style.display = "none";
    const hoverEl = el;
    hoverEl.addEventListener("mouseenter", () => (btn.style.display = "block"));
    hoverEl.addEventListener("mouseleave", () => (btn.style.display = "none"));
  }

  // ---- 渲染：扫描所有卡片，命中候选则叠按钮 ----
  function renderAll() {
    for (const { el, id } of scanCards()) {
      if (rendered.has(el)) continue;
      let data = candidates.get(id);
      if (!data || !data.streams || !data.streams.length) {
        if (fallbackUrl && isDetailContainer(el)) {
          data = { aweme_id: id, title: "抖音视频", author: "当前播放", streams: [{ label: "当前清晰度", url: fallbackUrl }] };
        } else {
          continue;
        }
      }
      mountButton(el, data);
      rendered.add(el);
    }
  }

  // ============================================================
  // popover / 下载 / toast
  // ============================================================
  function openPopover(btn, data) {
    closePopover();
    const rect = btn.getBoundingClientRect();
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

    const t = document.createElement("div");
    t.textContent = (data.title || "").slice(0, 22);
    t.style.cssText =
      "font-weight:600;padding:6px 8px;border-bottom:1px solid #374151;margin-bottom:4px;" +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px;";
    pop.appendChild(t);

    for (const s of data.streams) {
      const row = document.createElement("button");
      row.textContent = "⬇ " + s.label;
      row.style.cssText =
        "display:block;width:100%;text-align:left;background:none;color:#f3f4f6;" +
        "border:none;padding:7px 8px;border-radius:6px;cursor:pointer;";
      row.addEventListener("mouseenter", () => (row.style.background = "#374151"));
      row.addEventListener("mouseleave", () => (row.style.background = "none"));
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        requestDownload(data, s);
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
  function closePopover() {
    if (activePop) {
      activePop.remove();
      activePop = null;
    }
    document.removeEventListener("click", onDocClick, true);
  }

  function sanitize(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, "_").trim();
  }
  function requestDownload(data, stream) {
    const filename = sanitize(data.author + "_" + data.title + "_" + stream.label) + ".mp4";
    window.postMessage(
      { type: MSG, payload: { kind: "download_request", url: stream.url, filename } },
      "*"
    );
    toast("开始下载 " + stream.label + " …");
  }

  let toastEl = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.style.cssText =
        "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "background:#111827;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;" +
        "box-shadow:0 4px 16px rgba(0,0,0,.4);";
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.remove(), 2500);
  }

  // ---- 动态：新卡片（滚动/异步）自动补按钮 ----
  let obsTimer = null;
  new MutationObserver(() => {
    clearTimeout(obsTimer);
    obsTimer = setTimeout(renderAll, 300);
  }).observe(document.body, { childList: true, subtree: true });

  setInterval(renderAll, 1500);
})();
