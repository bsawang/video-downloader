import { createStore } from "./store.js";
import { installNetworkHooks, scanSSR, scanPerformance, scanDomSources, debug } from "./hook.js";
import { scan, pickAnchor } from "./mount.js";
import { createButton, toast, ensureHoverStyle } from "./ui.js";
import { createDownloader } from "./download.js";

export function start(adapter) {
  const store = createStore();
  const renderedIds = new WeakMap();
  let fallbackUrl = null;
  let lastPerfUrl = null;
  let renderTimer = null;
  let mountedCount = 0;
  let fallbackCount = 0;

  const nativeFetch = installNetworkHooks(adapter, store);
  const download = createDownloader({ nativeFetch, toast });

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAll, 300);
  }

  function renderAll() {
    const found = scan(adapter.anchors);
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
      }
      let item = store.get(videoId);
      if (!item || !item.streams.length) {
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
        onPick: (stream) => {
          toast("开始下载 " + stream.label + " …");
          // 同步进 download：picker 需要用户点击的激活态，异步解析只能包成 Promise 传进去
          const plan = Promise.resolve().then(() => adapter.resolveDownload(item, stream));
          const name = adapter.filename ? adapter.filename(item, stream) : undefined;
          download(plan, { streamToDisk: !!adapter.streamToDisk, suggestedName: name });
        },
      });
      anchor.appendChild(btn);
      anchor.setAttribute("data-dl-hover", "1");
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
