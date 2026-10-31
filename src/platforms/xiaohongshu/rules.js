// 小红书（www.xiaohongshu.com）的全部平台常量集中在此文件。kernel 不得引用本文件的任何字符串。
// 笔记详情数据来自页面内联的 __INITIAL_STATE__（详情页直开与卡片弹层都是它），
// 卡片页只有笔记 id 与 xsec_token，档位要按需再取（见 adapter）。
import { sortStreams } from "../../kernel/extract.js";

const NOTE_PATH = /^\/(?:explore|discovery\/item)\/([0-9A-Za-z]{24})/;

export function xhsNoteIdFromPath(pathname) {
  const m = String(pathname || "").match(NOTE_PATH);
  return m ? m[1] : null;
}

export function xhsTokenFromLocation(loc = globalThis.location) {
  const m = String((loc && loc.search) || "").match(/[?&]xsec_token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function xhsNoteUrl(id, token) {
  const base = "/explore/" + encodeURIComponent(id);
  return token ? base + "?xsec_token=" + encodeURIComponent(token) : base;
}

export function xhsDetailMap() {
  const s = globalThis.__INITIAL_STATE__;
  return (s && s.note && s.note.noteDetailMap) || null;
}

// 详情弹层打开后站点会把该笔记写进 noteDetailMap；直开详情页时同样有
export function xhsStateNote(id) {
  const map = xhsDetailMap();
  if (!map || !id) return null;
  const entry = map[id];
  return (entry && entry.note) || null;
}

export function xhsIsVideoNote(note) {
  return !!(note && note.type === "video" && note.video);
}

// 同分辨率下优先 EF4（H.264，兼容性最好），EF5 通常是更高压缩率的另一编码
const CODEC_RANK = { EF4: 0, EF5: 1 };

function xhsCodecRank(codec) {
  return Object.prototype.hasOwnProperty.call(CODEC_RANK, codec) ? CODEC_RANK[codec] : 2;
}

// 竖屏视频按短边命名（720×1280 记 720p），同分辨率合并成一条，避免菜单里出现重复档位。
export function xhsBuildStreams(video) {
  const stream = video && video.media && video.media.stream;
  if (!stream || typeof stream !== "object") return [];
  const keys = Object.keys(stream).sort((a, b) => xhsCodecRank(a) - xhsCodecRank(b));
  const picked = new Map();
  for (const key of keys) {
    const list = stream[key];
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      // 官方签名链有时给 http；在 https 页面上 fetch 会被混合内容拦截，同主机同签名换成 https 可用
      const url = String((s && (s.masterUrl || s.url)) || "").replace(/^http:\/\//i, "https://");
      const w = Number(s && s.width) || 0;
      const h = Number(s && s.height) || 0;
      const side = w && h ? Math.min(w, h) : w || h;
      if (!url || !side) continue;
      const label = side + "p";
      const avg = Number(s && s.avgBitrate) || 0;
      const prev = picked.get(label);
      if (
        prev &&
        !(
          xhsCodecRank(key) < xhsCodecRank(prev.codec) ||
          (xhsCodecRank(key) === xhsCodecRank(prev.codec) && avg > prev.avg)
        )
      ) {
        continue;
      }
      picked.set(label, { label, url, codec: key, avg });
    }
  }
  return sortStreams([...picked.values()].map(({ label, url }) => ({ label, url })));
}

// noteId 只在卡片页由规则传入（详情弹层里 note.noteId 不一定就绪）
export function xhsNoteToItem(note, fallbackId) {
  if (!xhsIsVideoNote(note)) return null;
  const streams = xhsBuildStreams(note.video);
  if (!streams.length) return null;
  return {
    videoId: String(note.noteId || fallbackId || ""),
    title: String(note.title || note.desc || "").slice(0, 80),
    author: (note.user && note.user.nickname) || "",
    streams,
  };
}

// 卡片里可见的链接都带 xsec_token；没有令牌时详情页会返回「页面不见了」
export function xhsCardToken(el) {
  if (!el || !el.querySelector) return "";
  const a = el.querySelector('a[href*="xsec_token="]') || el.querySelector("a.cover");
  if (!a) return "";
  const m = String(a.getAttribute("href") || "").match(/[?&]xsec_token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function xhsCardTitle(el) {
  if (!el || !el.querySelector) return "";
  const node = el.querySelector(".title");
  return node ? String(node.textContent || "").trim() : "";
}

export function xhsCardAuthor(el) {
  if (!el || !el.querySelector) return "";
  const node = el.querySelector(".author-wrapper .name") || el.querySelector(".author .name");
  return node ? String(node.textContent || "").trim() : "";
}

const STATE_MARK = "window.__INITIAL_STATE__=";

// 页面 HTML 里的状态是 JS 字面量，不是严格 JSON：值位置上会有裸 undefined/NaN，
// 登录态还会夹带 new Map([])（如 tailMap）。先按严格 JSON 解，失败再宽松化重试。
function xhsFixStateLiterals(raw) {
  return raw
    .replace(/:(undefined|NaN|-?Infinity)(?=\s*[,}\]])/g, ":null")
    .replace(/new Map\((\[[\s\S]*?\])\)/g, (m, arr) => {
      try {
        return JSON.stringify(Object.fromEntries(JSON.parse(arr)));
      } catch (e) {
        return "{}";
      }
    })
    .replace(/new Set\((\[[\s\S]*?\])\)/g, (m, arr) => {
      try {
        JSON.parse(arr);
        return arr;
      } catch (e) {
        return "[]";
      }
    });
}

export function xhsStateFromHtml(html) {
  const text = String(html || "");
  const i = text.indexOf(STATE_MARK);
  if (i < 0) return null;
  const start = i + STATE_MARK.length;
  const end = text.indexOf("</script>", start);
  if (end < 0) return null;
  const raw = text.slice(start, end).trim().replace(/;$/, "");
  try {
    return JSON.parse(raw);
  } catch (e) {}
  try {
    return JSON.parse(xhsFixStateLiterals(raw));
  } catch (e) {
    return null;
  }
}

export const xhsRules = {
  id: "xiaohongshu",
  matches: ["*://www.xiaohongshu.com/*"],
  ssrSelector: null,
  perfPattern: null,
  qualityMap: {},
  isVideo: (o) => !!(o && o.type === "video" && o.video && o.video.media),
  anchors: [
    {
      selector: "#noteContainer",
      // 图文笔记没有播放器可下，等 noteDetailMap 就绪后只认 video 类型
      idFrom: () => {
        const loc = globalThis.location;
        const id = xhsNoteIdFromPath(loc && loc.pathname);
        if (!id) return null;
        return xhsIsVideoNote(xhsStateNote(id)) ? id : null;
      },
      kind: "detail",
      pageScope: /^\/(?:explore|discovery\/item)\/[0-9A-Za-z]{24}/,
      mount: [".player-container", ".media-container", "self"],
      // 播放器控件都在底部，右上角留空；按钮放播放器右上角
      pos: { top: 12, right: 12 },
    },
    // 卡片页：只有笔记 id 与 xsec_token，档位在 hover/点击时按需取（见 adapter.loadItem）
    {
      selector: ".note-item",
      // .play-icon 是站内给视频笔记打的角标，图文笔记不注入
      idFrom: (el) =>
        el && el.querySelector && el.querySelector(".play-icon") ? el.getAttribute("data-note-id") : null,
      kind: "card",
      mount: ["self"],
    },
  ],
  fallback: { title: "小红书视频", author: "当前播放", label: "当前清晰度" },
};
