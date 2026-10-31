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

export const biliRules = {
  id: "bilibili",
  matches: ["*://www.bilibili.com/video/*"],
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
    },
  ],
  fallback: { title: "B站视频", author: "当前播放", label: "当前清晰度" },
};
