import { createStore } from "./store.js";
import { installNetworkHooks, scanSSR, scanPerformance, scanDomSources, debug } from "./hook.js";
import { scan, pickAnchor } from "./mount.js";
import { createButton, toast, ensureHoverStyle } from "./ui.js";
import { createDownloader } from "./download.js";

export function start(adapter) {
  const store = createStore();
  const renderedIds = new WeakMap();
  const anchorsHooked = new WeakSet();
  let fallbackUrl = null;
  let lastPerfUrl = null;
  let renderTimer = null;
  let renderQueued = false;
  let mountedCount = 0;
  let fallbackCount = 0;
  let overlayLayer = null;
  let overlayRaf = null;
  // 卡片按钮浮层：站点把卡片包在 transform 层叠上下文里时（如 YouTube Shorts 货架），
  // 卡片内的按钮永远压不过外面的 hover 预览层，只能挂到页面级浮层上
  const overlayItems = new Map(); // btn -> 挂载元素

  const nativeFetch = installNetworkHooks(adapter, store);
  const download = createDownloader({ nativeFetch, toast });

  // 纯防抖会被页面连续重绘（弹层里播放器分几步插入、进度条持续更新）不断推迟，
  // 按钮要等重绘停下来才出现；改成节流：首次变更后固定间隔渲染一次，期间的变更排下一轮
  function scheduleRender() {
    if (renderTimer) {
      renderQueued = true;
      return;
    }
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderAll();
      if (renderQueued) {
        renderQueued = false;
        scheduleRender();
      }
    }, 200);
  }

  function ensureOverlayLayer() {
    if (overlayLayer && overlayLayer.isConnected) return overlayLayer;
    overlayLayer = document.createElement("div");
    overlayLayer.setAttribute("data-dl-layer", "1");
    overlayLayer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:100000;";
    document.documentElement.appendChild(overlayLayer);
    return overlayLayer;
  }

  function placeOverlay(btn, target) {
    const r = target.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    btn.style.display = visible ? "block" : "none";
    if (!visible) return;
    btn.style.top = Math.round(r.top + 8) + "px";
    btn.style.left = Math.round(r.right - btn.offsetWidth - 8) + "px";
  }

  function syncOverlay() {
    overlayRaf = null;
    for (const [btn, target] of overlayItems) {
      if (!btn.isConnected || !target.isConnected) continue;
      placeOverlay(btn, target);
    }
  }

  function scheduleOverlay() {
    if (overlayRaf) return;
    overlayRaf = requestAnimationFrame(syncOverlay);
  }

  window.addEventListener("scroll", scheduleOverlay, { capture: true, passive: true });
  window.addEventListener("resize", scheduleOverlay, { passive: true });

  function renderAll() {
    const found = scan(adapter.anchors);
    for (const [btn, target] of overlayItems) {
      if (!btn.isConnected || !target.isConnected) {
        btn.remove();
        overlayItems.delete(btn);
      }
    }
    ensureHoverStyle();
    let mounted = 0;
    let fallback = 0;
    for (const { el, videoId, rule } of found) {
      const prev = renderedIds.get(el);
      // 页面重渲染会清掉外来的按钮节点（作者作品列表随播放切换重绘），
      // 只按 id 记账会一直跳过，必须确认按钮仍在文档里才认为已挂载
      if (prev && prev.videoId === videoId && prev.btn.isConnected) {
        mounted++;
        continue;
      }
      // 列表虚拟滚动会复用节点：id 变了先摘掉旧按钮，避免按钮指向旧视频
      if (prev && prev.videoId !== videoId) {
        el.querySelectorAll("[data-dl-icon]").forEach((b) => b.remove());
        if (prev.btn.isConnected) prev.btn.remove();
        overlayItems.delete(prev.btn);
      }
      let item = store.get(videoId);
      // 卡片页只知 bvid：先挂占位条目，档位等 hover 预取或点击时解析
      let stub = false;
      if (!item && adapter.stub) {
        item = adapter.stub(videoId, el, rule) || null;
        stub = !!item;
      }
      if (!item || (!item.streams.length && !stub)) {
        if (!fallbackUrl || rule.kind !== "detail") continue;
        item = {
          videoId,
          title: adapter.fallback.title,
          author: adapter.fallback.author,
          streams: [{ label: adapter.fallback.label, url: fallbackUrl }],
          fallback: true,
        };
        debug("fallback", videoId, fallbackUrl.slice(0, 80));
      }
      const anchor = pickAnchor(el, rule.mount);
      if (!anchor) continue;
      const btn = createButton(item, {
        isDetail: rule.kind === "detail",
        iconRight: rule.iconRight,
        pos: rule.pos,
        alwaysShow: rule.alwaysShow,
        fixed: rule.overlay,
        onOpen:
          stub && adapter.loadItem
            ? async () => {
                toast("正在获取清晰度…");
                try {
                  return await adapter.loadItem(videoId, store);
                } catch (err) {
                  toast("✗ " + (err && err.message ? err.message : err));
                  throw err;
                }
              }
            : null,
        onPick: (stream, activeItem) => {
          toast("开始下载 " + stream.label + " …");
          // 同步进 download：picker 需要用户点击的激活态，异步解析只能包成 Promise 传进去
          const plan = Promise.resolve().then(() => adapter.resolveDownload(activeItem, stream));
          const name = adapter.filename ? adapter.filename(activeItem, stream) : undefined;
          download(plan, { streamToDisk: !!adapter.streamToDisk, suggestedName: name });
        },
      });
      if (rule.overlay) {
        ensureOverlayLayer().appendChild(btn);
        overlayItems.set(btn, anchor);
        placeOverlay(btn, anchor);
      } else {
        anchor.appendChild(btn);
        anchor.setAttribute("data-dl-hover", "1");
      }
      // hover 预取：等用户点开时档位大概率已到位；节点复用后 videoId 会变，所以每次读当前映射
      if (adapter.prefetch && !anchorsHooked.has(anchor)) {
        anchorsHooked.add(anchor);
        anchor.addEventListener(
          "mouseenter",
          () => {
            const cur = renderedIds.get(el);
            if (cur && cur.btn && cur.btn.isConnected) adapter.prefetch(cur.videoId, store);
          },
          { passive: true }
        );
      }
      renderedIds.set(el, { videoId, btn });
      if (item.fallback) fallbackCount++;
      mounted++;
    }
    mountedCount = mounted;
    window.__dlStats = {
      candidates: store.size,
      anchors: found.length,
      mounted,
      fallback: fallbackCount,
      downloadable: store.entries().filter((i) => i.streams.length).length,
    };
    scheduleOverlay();
    return mounted;
  }

  window.__dlRender = renderAll;
  store.onChange(scheduleRender);

  function observeDom() {
    const target = document.body || document.documentElement;
    if (!target) {
      document.addEventListener("DOMContentLoaded", observeDom, { once: true });
      return;
    }
    new MutationObserver(scheduleRender).observe(target, { childList: true, subtree: true });
  }
  observeDom();

  // 平台数据需要现取（清晰度列表不在 DOM/网络响应里）时由 adapter 自己拉，kernel 只负责定时触发
  function refreshSources() {
    if (!adapter.refresh) return;
    Promise.resolve()
      .then(() => adapter.refresh(store))
      .catch(() => {});
  }

  setInterval(renderAll, 1500);
  setInterval(() => {
    scanSSR(adapter, store);
    scanDomSources(adapter, store);
    const url = scanPerformance(adapter);
    if (url && url !== lastPerfUrl) {
      lastPerfUrl = url;
      fallbackUrl = url;
      renderAll();
    }
    refreshSources();
  }, 2000);
  setTimeout(() => scanSSR(adapter, store), 500);
  setTimeout(refreshSources, 500);
  scheduleRender();

  return {
    store,
    render: renderAll,
    get stats() {
      return { ...window.__dlStats, mounted: mountedCount };
    },
  };
}
