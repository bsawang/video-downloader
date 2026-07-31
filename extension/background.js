// 后台 Service Worker：观察所有抖音视频 CDN 请求，把正在播放的视频直链推给内容脚本。
// 兜底方案——即使元数据/接口（RENDER_DATA、fetch/XHR hook）都抓不到，
// webRequest 也能看到实际播放的视频 URL（worker/iframe/登录态都适用）。
chrome.webRequest.onCompleted.addListener(
  (details) => {
    try {
      const url = details.url;
      if (!url.includes("douyinvod.com") || !url.includes("/video/")) return;
      if (details.tabId >= 0) {
        chrome.tabs
          .sendMessage(details.tabId, { type: "DY_VIDEO_URL", url })
          .catch(() => {});
      }
    } catch (e) {}
  },
  { urls: ["*://*.douyinvod.com/*"] },
  []
);
