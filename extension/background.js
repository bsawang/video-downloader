// 后台 Service Worker：用 chrome.downloads 下载（不受 CORS 限制），
// 并转发下载进度/状态给发起下载的 content script。
const owners = new Map(); // downloadId -> tabId

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "DY_DOWNLOAD") {
    const { url, filename } = msg;
    const referer = msg.referer || "https://www.douyin.com/";
    const tabId = sender.tab ? sender.tab.id : null;
    chrome.downloads
      .download({
        url,
        filename,
        headers: [{ name: "Referer", value: referer }],
        conflictAction: "uniquify",
      })
      .then((id) => {
        if (tabId != null) owners.set(id, tabId);
        sendResponse({ ok: true });
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) });
      });
    return true; // 异步 sendResponse
  }
});

chrome.downloads.onChanged.addListener((delta) => {
  const tabId = owners.get(delta.id);
  if (tabId == null) return;
  const send = (payload) => {
    chrome.tabs.sendMessage(tabId, { type: "DY_DOWNLOAD_STATUS", payload }).catch(() => {});
  };

  if (delta.state) {
    if (delta.state.current === "complete") {
      send({ kind: "done" });
      owners.delete(delta.id);
      return;
    }
    if (delta.state.current === "interrupted") {
      send({ kind: "error", error: (delta.error && delta.error.current) || "下载中断" });
      owners.delete(delta.id);
      return;
    }
  }
  if (delta.bytesReceived) {
    const received = delta.bytesReceived.current;
    const total =
      delta.totalBytes && delta.totalBytes.current ? delta.totalBytes.current : 0;
    send({ kind: "progress", received, total });
  }
});
