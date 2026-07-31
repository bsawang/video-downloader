// 页面世界脚本（world: MAIN）。hook 页面的 fetch/XHR，拦截含视频数据的 API 响应，
// 提取候选视频列表发给隔离世界。下载由 background.js 用 chrome.downloads 完成。
(() => {
  const MSG = "DY_EXT_MESSAGE";
  const origFetch = window.fetch;

  function notify(payload) {
    window.postMessage({ type: MSG, payload }, "*");
  }

  // 只关心抖音 web API 响应（媒体 URL 不含 aweme/v1/web/）
  function isApiUrl(url) {
    return url.includes("aweme/v1/web/");
  }

  // 从任意 JSON 里提取"含 video 数据"的条目（detail / 搜索 / 推荐流都覆盖）
  function extractCandidates(data) {
    const list = [];
    const push = (it) => {
      if (it && typeof it === "object" && it.aweme_id && it.video) list.push(it);
    };
    if (Array.isArray(data)) {
      data.forEach(push);
      return list;
    }
    if (data && typeof data === "object") {
      if (data.aweme_detail) push(data.aweme_detail);
      for (const key of ["aweme_list", "item_list", "data"]) {
        const v = data[key];
        if (Array.isArray(v)) v.forEach(push);
        else if (v && typeof v === "object") list.push(...extractCandidates(v));
      }
    }
    return list;
  }

  // ---- hook fetch ----
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url =
        typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      if (isApiUrl(url)) {
        resp
          .clone()
          .json()
          .then((data) => {
            const list = extractCandidates(data);
            if (list.length) notify({ kind: "video_candidates", candidates: list });
          })
          .catch(() => {});
      }
    } catch (e) {}
    return resp;
  };

  // ---- hook XHR ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__dyUrl = String(url);
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        if (this.__dyUrl && isApiUrl(this.__dyUrl)) {
          const data = JSON.parse(this.responseText);
          const list = extractCandidates(data);
          if (list.length) notify({ kind: "video_candidates", candidates: list });
        }
      } catch (e) {}
    });
    return origSend.apply(this, args);
  };
})();
