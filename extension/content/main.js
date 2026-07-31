// 页面世界脚本（world: MAIN）。hook 页面的 fetch/XHR，拦截 detail API 响应；
// 并负责在页面上下文下载视频直链（继承 Referer + Cookie）。
(() => {
  const MSG = "DY_EXT_MESSAGE";
  const DETAIL_PATTERN = "aweme/v1/web/aweme/detail";
  const origFetch = window.fetch;

  function notify(payload) {
    window.postMessage({ type: MSG, payload }, "*");
  }

  // ---- hook fetch ----
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url =
        typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      if (url.includes(DETAIL_PATTERN)) {
        resp
          .clone()
          .json()
          .then((data) => {
            if (data && data.aweme_detail) notify({ kind: "video_data", data });
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
        if (this.__dyUrl && this.__dyUrl.includes(DETAIL_PATTERN)) {
          const data = JSON.parse(this.responseText);
          if (data && data.aweme_detail) notify({ kind: "video_data", data });
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
      const resp = await origFetch(url, { credentials: "include" });
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
})();
