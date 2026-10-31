// B 站详情页的全部平台常量集中在此文件。kernel 不得引用本文件的任何字符串。
// 当前分 P 只在 __INITIAL_STATE__ 里，__playinfo__ 是首屏 SSR 数据，切 P 后不更新。
export function readBiliPage(loc = globalThis.location) {
  const s = globalThis.__INITIAL_STATE__;
  if (!s || !s.videoData) return null;
  const vd = s.videoData;
  const pages = Array.isArray(vd.pages) ? vd.pages : [];
  let p = Number(s.p);
  if (!Number.isFinite(p) || p < 1) {
    const m = loc && loc.search ? String(loc.search).match(/[?&]p=(\d+)/) : null;
    p = m ? Number(m[1]) : 1;
  }
  const page = pages[p - 1] || pages[0] || null;
  const bvid = String(s.bvid || vd.bvid || "");
  const cid = String(s.cid || (page && page.cid) || "");
  if (!bvid || !cid) return null;
  return {
    bvid,
    cid,
    page: p,
    title: vd.title || "",
    author: (vd.owner && vd.owner.name) || "",
    part: (page && page.part) || "",
    pageCount: pages.length || 1,
  };
}

// 首页/搜索/排行/推荐位的卡片只暴露 bvid（cid 要现查），统一从卡片里的视频链接取。
const CARD_BV = /\/video\/(BV[0-9A-Za-z]{10})/;

// 广告卡片的 href 是 cm.bilibili.com 的跳转埋点，真实目标在 data-target-url 上
export function biliCardBvid(el) {
  if (!el || !el.querySelector) return null;
  for (const node of el.querySelectorAll("a[href], a[data-target-url]")) {
    for (const attr of ["href", "data-target-url"]) {
      const m = String(node.getAttribute(attr) || "").match(CARD_BV);
      if (m) return m[1];
    }
  }
  return null;
}

// 卡片标题只是占位（按钮 tooltip / 菜单标题），真实标题以 view 接口为准
export function biliCardTitle(el) {
  if (!el || !el.querySelector) return "";
  for (const sel of [".bili-video-card__info--tit", ".video-card__info-title", ".title"]) {
    const node = el.querySelector(sel);
    const text = node && String(node.textContent || "").trim();
    if (text) return text;
  }
  return "";
}

export const biliRules = {
  id: "bilibili",
  matches: ["*://www.bilibili.com/*", "*://search.bilibili.com/*"],
  cdnPattern: /bilivideo\.com|mountaintoys\.cn/,
  ssrSelector: null,
  perfPattern: null,
  qualityMap: {},
  isVideo: (o) => !!(o && o.bvid && o.cid),
  anchors: [
    {
      selector: "#bilibili-player",
      // videoId 只在打开播放页后才拿得到（cid 随分P切换变化），所以用函数式 idFrom
      idFrom: () => {
        const page = readBiliPage();
        return page ? page.cid : null;
      },
      kind: "detail",
      pageScope: /^\/video\//,
      mount: [".bpx-player-video-area", ".bpx-player-container", "self"],
      // 右上角是站内「反馈」按钮（.bpx-player-top-issue，12px 内缩 36×24），按钮让到它左侧并垂直居中
      pos: { top: 12, right: 56 },
    },
    // 卡片类：视频Id 用 bvid，cid 与档位在点开时经接口现取（见 adapter.loadItem）
    // iconRight：卡片右上角是站内「稍后再看」，按钮左移让位
    { selector: ".bili-video-card", idFrom: biliCardBvid, kind: "card", iconRight: 44, mount: ["self"] },
    {
      selector: ".video-card",
      idFrom: biliCardBvid,
      kind: "card",
      iconRight: 44,
      mount: [".video-card__content", "self"],
    },
    { selector: ".rank-item", idFrom: biliCardBvid, kind: "card", iconRight: 44, mount: [".img", "self"] },
    // 详情页右侧「相关推荐」：结构与首页卡片不同，挂在缩略图上
    {
      selector: ".video-page-card-small",
      idFrom: biliCardBvid,
      kind: "card",
      iconRight: 44,
      mount: [".pic", "self"],
    },
  ],
  fallback: { title: "B站视频", author: "当前播放", label: "当前清晰度" },
};

