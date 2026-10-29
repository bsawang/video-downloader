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
      if (renderedIds.get(el) === videoId) {
        mounted++;
        continue;
      }
      // 列表虚拟滚动会复用节点：id 变了先摘掉旧按钮，避免按钮指向旧视频
      if (renderedIds.has(el)) {
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
          download(adapter.resolveDownload(item, stream));
        },
      });
      anchor.appendChild(btn);
      anchor.setAttribute("data-dl-hover", "1");
      renderedIds.set(el, videoId);
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
  }, 2000);
  setTimeout(() => scanSSR(adapter, store), 500);
  scheduleRender();

  return {
    store,
    render: renderAll,
    get stats() {
      return { ...window.__dlStats, mounted: mountedCount };
    },
  };
}
