import { parseLooseJSON } from "../../kernel/extract.js";

// 详情弹层右侧「作者作品」列表的卡片没有 id 属性，内部 a 也没有 href（SPA onClick 跳转），
// 卡片数据只存在于 React fiber 的 memoizedProps.awemeInfo（camelCase，与接口原始 JSON 不同构）。
export function readAwemeInfo(el) {
  const host = el.querySelector("a") || el;
  const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return null;
  let fiber = host[key];
  for (let i = 0; fiber && i < 15; i++, fiber = fiber.return) {
    const info = fiber.memoizedProps && fiber.memoizedProps.awemeInfo;
    if (info && info.awemeId) return info;
  }
  return null;
}

export function readFiberAwemeId(el) {
  const info = readAwemeInfo(el);
  return info ? String(info.awemeId) : null;
}

// 抖音的全部平台差异集中在此文件。kernel 不得引用本文件的任何字符串。
export const sources = [
  {
    id: "network",
    priority: 0,
    reachableInPage: true,
    match: () => true,
    extract: parseLooseJSON,
  },
];

export const rules = {
  id: "douyin",
  matches: ["*://*.douyin.com/*"],
  cdnPattern: /douyinvod\.com/,
  perfPattern: /douyinvod\.com\/.*\/video\//,
  ssrSelector: "script#RENDER_DATA",
  qualityMap: {},
  isVideo: (o) => !!(o && o.aweme_id && o.video && o.video.bit_rate && o.video.bit_rate.length),
  anchors: [
    {
      selector: "[data-aweme-id]",
      idFrom: { type: "attr", name: "data-aweme-id" },
      kind: "card",
      mount: [".videoImage", "self"],
    },
    {
      selector: '[id^="waterfall_item_"]',
      idFrom: { type: "idPrefix", prefix: "waterfall_item_" },
      kind: "card",
      mount: [".videoImage", "self"],
    },
    {
      selector: '[class*="video_"]',
      idFrom: { type: "className", pattern: /video_(\d+)/ },
      kind: "detail",
      // 弹层的滑动容器恒为整屏宽；右侧面板展开后收窄的是播放器，按钮必须挂在播放器盒子里才跟着动
      mount: [".videoImage", ".douyin-player-video-container", ".basePlayerContainer", "self"],
    },
    {
      selector: "video",
      idFrom: { type: "mediaSrc", pattern: /__vid=(\d+)/ },
      kind: "detail",
      resolve: (el) =>
        el.closest(".douyin-player-video-container") || el.closest(".basePlayerContainer") || el.parentElement,
      mount: [".videoImage", "self"],
    },
    {
      selector: 'ul[data-e2e="scroll-list"] > li',
      pageScope: /^\/user\//,
      idFrom: { type: "innerHref", selector: 'a[href*="/video/"]', pattern: /\/video\/(\d+)/ },
      kind: "card",
      mount: [".videoImage", "self", 'a[href*="/video/"]'],
    },
    {
      selector: '[data-e2e="author-card-list"] li',
      idFrom: readFiberAwemeId,
      kind: "card",
      mount: ["self"],
    },
  ],
  fallback: { title: "抖音视频", author: "当前播放", label: "当前清晰度" },
};
