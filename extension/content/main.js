// 页面世界脚本（world: MAIN）。hook 页面的 fetch/XHR，拦截含视频数据的 API 响应，
// 提取候选视频列表发给隔离世界；并负责在页面上下文下载视频（fetch→blob→<a download>）。
(() => {
  console.log("[dy-dl] main v0.3.3-debug");
  const MSG = "DY_EXT_MESSAGE";
  const origFetch = window.fetch;
  const DEBUG = true;
  const log = (...a) => DEBUG && console.log("[dy-dl:main]", ...a);
  const modalId = new URLSearchParams(location.search).get("modal_id");

  function notify(payload) {
    window.postMessage({ type: MSG, payload }, "*");
  }

  // 放宽：任何含 aweme 的 API 响应都尝试解析（detail/search/feed 都覆盖）
  function isApiUrl(url) {
    return url.includes("aweme");
  }

  // 调试：定位 modal_id 数据藏在哪个响应里
  function checkForModalId(url, text) {
    if (modalId && text && text.includes(modalId)) {
      log(">>> modal_id FOUND in:", url.slice(0, 150));
    }
  }

  // 从任意 JSON 里提取"含 video 数据"的条目（detail / 搜索 / 推荐流都覆盖）
  // depth 限深，防止深层/循环结构导致栈溢出
  function extractCandidates(data, depth = 0) {
    if (depth > 30) return [];
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
        else if (v && typeof v === "object") list.push(...extractCandidates(v, depth + 1));
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
        log("resp:", url.slice(0, 120));
        resp
          .clone()
          .json()
          .then((data) => {
            const list = extractCandidates(data);
            if (list.length) {
              log("candidates:", list.length, "ids:", list.map((c) => c.aweme_id).slice(0, 6).join(","));
              notify({ kind: "video_candidates", candidates: list });
            } else {
              log("no candidates in:", url.slice(0, 90));
            }
          })
          .catch((e) => log("json fail:", url.slice(0, 90), e));
      } else if (modalId && !url.includes("douyinvod") && !url.includes("byteimg")) {
        resp
          .clone()
          .text()
          .then((txt) => checkForModalId(url, txt))
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
          log("xhr resp:", this.__dyUrl.slice(0, 120));
          const data = JSON.parse(this.responseText);
          const list = extractCandidates(data);
          if (list.length) notify({ kind: "video_candidates", candidates: list });
        } else if (this.__dyUrl && modalId && !this.__dyUrl.includes("douyinvod")) {
          checkForModalId(this.__dyUrl, this.responseText);
        }
      } catch (e) {}
    });
    return origSend.apply(this, args);
  };

  // ---- 监听隔离世界的下载请求 ----
  window.addEventListener("message", (ev) => {
    if (
      ev.data &&
      ev.data.type === MSG &&
      ev.data.payload &&
      ev.data.payload.kind === "download_request"
    ) {
      downloadVideo(ev.data.payload);
    }
  });

  async function downloadVideo(req) {
    const { url, filename } = req;
    try {
      // 关键：credentials 必须用 omit！
      // 抖音 CDN 返回 Access-Control-Allow-Origin: *，与 include 不兼容会触发 CORS 拦截。
      const resp = await origFetch(url, { credentials: "omit" });
      if (!resp.ok) {
        notify({ kind: "download_status", ok: false, error: "HTTP " + resp.status });
        return;
      }
      const total = parseInt(resp.headers.get("content-length") || "0", 10) || 0;
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total) notify({ kind: "download_progress", received, total });
      }
      const blob = new Blob(chunks, {
        type: resp.headers.get("content-type") || "video/mp4",
      });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      notify({ kind: "download_status", ok: true });
    } catch (e) {
      notify({ kind: "download_status", ok: false, error: String(e) });
    }
  }

  // ---- 调试：弹窗视频数据源排查 ----
  if (modalId) {
    setTimeout(() => {
      try {
        const html = document.documentElement.outerHTML;
        if (html.includes(modalId)) log(">>> modal_id FOUND in DOM html");
        for (const key of ["__INITIAL_STATE__", "_ROUTER_DATA", "__PRELOADED_STATE__", "SIGI_STATE"]) {
          try {
            const v = window[key];
            if (v && JSON.stringify(v).includes(modalId)) log(">>> modal_id FOUND in window." + key);
          } catch (e) {}
        }
        const v = document.querySelector("video");
        if (v && v.currentSrc) log("video.currentSrc:", v.currentSrc.slice(0, 130));
      } catch (e) {}
    }, 6000);
  }
})();
