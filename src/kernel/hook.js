import { collect } from "./extract.js";

export function debug(...args) {
  if (globalThis.__DL_DEBUG) console.log("[dl]", ...args);
}

function feed(url, text, adapter, store) {
  const matched = adapter.sources.filter((s) => s.match(url));
  for (const s of matched) {
    const items = collect(text, s, adapter);
    debug("source", s.id, "items", items.length, url.slice(0, 80));
    for (const item of items) store.upsert(item);
  }
}

export function installNetworkHooks(adapter, store) {
  const nativeFetch = window.fetch;

  window.fetch = async function (...args) {
    const resp = await nativeFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      if (adapter.sources.some((s) => s.match(url))) {
        feed(url, await resp.clone().text(), adapter, store);
      }
    } catch (e) {}
    return resp;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__dlUrl = String(url);
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        const text = this.responseText;
        if (text) feed(this.__dlUrl || "", text, adapter, store);
      } catch (e) {}
    });
    return origSend.apply(this, args);
  };

  return nativeFetch;
}

export function scanSSR(adapter, store) {
  if (!adapter.ssrSelector) return;
  const el = document.querySelector(adapter.ssrSelector);
  if (!el) return;
  let data = null;
  try {
    data = JSON.parse(el.textContent);
  } catch (e) {
    try {
      data = JSON.parse(decodeURIComponent(el.textContent));
    } catch (e2) {
      return;
    }
  }
  feed("", JSON.stringify(data), adapter, store);
}

export function scanPerformance(adapter) {
  if (!adapter.perfPattern) return null;
  const urls = performance
    .getEntriesByType("resource")
    .map((e) => e.name)
    .filter((u) => adapter.perfPattern.test(u));
  return urls.length ? urls[urls.length - 1] : null;
}

function sameStreams(a, b) {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.label === b[i].label && s.url === b[i].url);
}

// DOM 数据源：站点把接口数据归一化进组件树后，网络响应里已无原始字段，
// 只能从组件 props 取。每轮只在与仓库不同的情况下写入，避免空转触发重渲染。
export function scanDomSources(adapter, store) {
  for (const src of adapter.domSources || []) {
    let items = [];
    try {
      items = src.scan(globalThis.document) || [];
    } catch (e) {
      continue;
    }
    let changed = 0;
    for (const item of items) {
      const prev = store.get(item.videoId);
      if (prev && sameStreams(prev.streams, item.streams)) continue;
      store.upsert(item);
      changed++;
    }
    debug("domSource", src.id, "items", items.length, "changed", changed);
  }
}
