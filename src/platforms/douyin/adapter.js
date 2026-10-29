import { rules, sources, readAwemeInfo } from "./rules.js";
import { normalizeQuality, sortStreams, sanitizeName } from "../../kernel/extract.js";

function normalizeStreams(raw) {
  const video = raw && raw.video;
  const out = [];
  const seen = new Set();
  for (const br of (video && video.bit_rate) || []) {
    const pa = br.play_addr || {};
    const urls = pa.url_list || [];
    if (!urls.length) continue;
    const label = normalizeQuality(br.gear_name, rules.qualityMap);
    if (!label) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, url: urls[0] });
  }
  if (!out.length) {
    const pa = (video && video.play_addr) || {};
    const ul = pa.url_list || [];
    if (ul.length) out.push({ label: "默认", url: ul[0] });
  }
  return sortStreams(out);
}

function parse(raw) {
  if (!raw || !raw.aweme_id) return null;
  const streams = normalizeStreams(raw);
  if (!streams.length) return null;
  return {
    videoId: String(raw.aweme_id),
    title: raw.desc || "",
    author: (raw.author && raw.author.nickname) || "",
    streams,
  };
}

function resolveDownload(item, stream) {
  return {
    url: stream.url,
    credentials: "omit",
    filename: sanitizeName(item.author + "_" + item.title + "_" + stream.label) + ".mp4",
  };
}

// fiber 的 awemeInfo 是页面归一化后的 camelCase 结构，这里折回接口原始形状，
// 让 DOM 数据源与网络数据源共用同一套 parse / 清晰度规则。
export function fiberToRaw(ai) {
  const video = ai.video || {};
  const srcs = (list) => (list || []).map((p) => (p && p.src) || "").filter(Boolean);
  return {
    aweme_id: ai.awemeId,
    desc: ai.itemTitle || ai.desc || "",
    author: { nickname: (ai.authorInfo && ai.authorInfo.nickname) || "" },
    video: {
      bit_rate: (video.bitRateList || []).map((g) => ({
        gear_name: g.gearName,
        play_addr: { url_list: srcs(g.playAddr) },
      })),
      play_addr: { url_list: srcs(video.playAddr) },
    },
  };
}

const domSources = [
  {
    id: "douyin-fiber",
    scan(root) {
      const out = [];
      for (const el of root.querySelectorAll('[data-e2e="author-card-list"] li')) {
        const ai = readAwemeInfo(el);
        if (!ai) continue;
        const item = parse(fiberToRaw(ai));
        if (item) out.push(item);
      }
      return out;
    },
  },
];

export const douyinAdapter = {
  ...rules,
  sources,
  domSources,
  parse,
  normalizeStreams,
  resolveDownload,
};
