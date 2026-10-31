// YouTube（www.youtube.com）的全部平台常量集中在此文件。kernel 不得引用本文件的任何字符串。
// 播放页内联的 ytInitialPlayerResponse 已只下发 SABR，逐档直链要自己问 InnerTube（见 adapter）。
const YT_ID = /[?&]v=([A-Za-z0-9_-]{11})/;

export function ytVideoIdFromUrl(href) {
  const m = String(href || "").match(YT_ID);
  return m ? m[1] : null;
}

export function ytCurrentVideoId(loc = globalThis.location) {
  return ytVideoIdFromUrl((loc && loc.search) || "");
}

// 新版首页/相关推荐用 yt-lockup-view-model，搜索结果仍有 ytd-video-renderer，
// 频道、播放列表等卡片内部没有 /watch?v= 链接，自然取不到 id。
export function ytCardVideoId(el) {
  if (!el || typeof el.querySelectorAll !== "function") return null;
  for (const a of el.querySelectorAll('a[href*="/watch?v="]')) {
    const id = ytVideoIdFromUrl(a.getAttribute("href"));
    if (id) return id;
  }
  return null;
}

export function ytCardTitle(el) {
  if (!el || !el.querySelector) return "";
  for (const sel of ["#video-title", "yt-formatted-string#video-title", "h3", ".ytLockupMetadataViewModelTitle"]) {
    const node = el.querySelector(sel);
    const text = node && String(node.textContent || "").trim();
    if (text) return text;
  }
  const img = el.querySelector("img[alt]");
  return (img && String(img.getAttribute("alt") || "").trim()) || "";
}

export function ytPageTitle() {
  return String((globalThis.document && globalThis.document.title) || "").replace(/\s*-\s*YouTube\s*$/, "");
}

export const ytRules = {
  id: "youtube",
  matches: ["*://www.youtube.com/*", "*://youtube.com/*"],
  cdnPattern: /googlevideo\.com/,
  ssrSelector: null,
  perfPattern: null,
  qualityMap: {},
  isVideo: (o) => !!(o && o.videoId),
  anchors: [
    {
      selector: "#movie_player",
      idFrom: () => ytCurrentVideoId(),
      kind: "detail",
      pageScope: /^\/watch/,
      mount: ["self"],
      // 右上角是播放器信息条（悬浮时才出，且在左上），12px 内缩不压底部控制条
      pos: { top: 12, right: 12 },
    },
    {
      selector: "yt-lockup-view-model",
      idFrom: ytCardVideoId,
      kind: "card",
      mount: ["yt-thumbnail-view-model", "self"],
    },
    { selector: "ytd-video-renderer", idFrom: ytCardVideoId, kind: "card", mount: ["#thumbnail", "self"] },
    { selector: "ytd-compact-video-renderer", idFrom: ytCardVideoId, kind: "card", mount: ["#thumbnail", "self"] },
  ],
  fallback: { title: "YouTube 视频", author: "当前播放", label: "当前清晰度" },
};
