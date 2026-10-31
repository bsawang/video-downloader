import { biliRules, readBiliPage } from "./rules.js";
import { sanitizeName, sortStreams } from "../../kernel/extract.js";

const BILI_PLAYURL = "https://api.bilibili.com/x/player/playurl";

export function biliPlayurlUrl(meta, qn) {
  return (
    BILI_PLAYURL +
    "?bvid=" + encodeURIComponent(meta.bvid) +
    "&cid=" + encodeURIComponent(meta.cid) +
    "&fnver=0&fourk=1&fnval=1&qn=" + qn
  );
}

// fnval=1 只要单文件 durl：DASH 视频/音频分离，脚本里没法合并；
// accept_quality/accept_description 是当前账号在该视频上真能拿到的档位。
export function buildBiliStreams(data) {
  const qs = (data && data.accept_quality) || [];
  const descs = (data && data.accept_description) || [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < qs.length; i++) {
    const qn = Number(qs[i]);
    const label = descs[i] || qn + "P";
    if (!Number.isFinite(qn) || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, qn });
  }
  return sortStreams(out);
}

export function biliParsePlayurl(data, meta) {
  if (!data || !meta) return null;
  const streams = buildBiliStreams(data);
  if (!streams.length) return null;
  return {
    videoId: String(meta.cid),
    title: meta.title || "",
    author: meta.author || "",
    bvid: meta.bvid,
    cid: String(meta.cid),
    page: meta.page || 1,
    pageCount: meta.pageCount || 1,
    part: meta.part || "",
    streams,
  };
}

export function biliFilename(item, stream) {
  const parts = [item.author, item.title];
  if (item.pageCount > 1 && item.part) parts.push("P" + item.page + " " + item.part);
  parts.push(stream.label);
  const name = sanitizeName(parts.filter(Boolean).join("_")).replace(/\s+/g, " ");
  return name.slice(0, 120) + ".mp4";
}

export function biliParse(raw) {
  if (!raw || !raw.cid) return null;
  return biliParsePlayurl(raw, raw);
}

export function biliNormalizeStreams(raw) {
  return buildBiliStreams(raw);
}

// 直链两小时过期，点下载时才现取；取回来就是单文件 URL。
export async function biliResolveDownload(item, stream) {
  const resp = await fetch(biliPlayurlUrl(item, stream.qn), { credentials: "include" });
  const json = await resp.json();
  const durl = (json.data && json.data.durl) || [];
  if (!durl.length) throw new Error("该清晰度不可用");
  if (durl.length > 1) throw new Error("分段视频暂不支持（共 " + durl.length + " 段）");
  return { url: durl[0].url, credentials: "omit", filename: biliFilename(item, stream) };
}

let biliFetching = false;
let biliLastCid = "";
let biliLastAt = 0;

// 清晰度列表不在 DOM 也不在 __playinfo__（那是首屏 SSR 且切 P 后不更新），只能自己问接口。
// 每个 cid 成功取一次；失败 5s 内不重试，避免 2s 定时器打爆接口。
export async function biliRefresh(store) {
  const meta = readBiliPage();
  if (!meta) return;
  const existing = store.get(meta.cid);
  if (existing) {
    biliLastCid = meta.cid;
    return;
  }
  if (biliFetching) return;
  const now = Date.now();
  if (meta.cid === biliLastCid && now - biliLastAt < 5000) return;
  biliFetching = true;
  biliLastCid = meta.cid;
  biliLastAt = now;
  try {
    const resp = await fetch(biliPlayurlUrl(meta, 127), { credentials: "include" });
    const json = await resp.json();
    const item = biliParsePlayurl(json.data, meta);
    if (item) store.upsert(item);
  } finally {
    biliFetching = false;
  }
}

export const bilibiliAdapter = {
  ...biliRules,
  sources: [],
  domSources: [],
  parse: biliParse,
  normalizeStreams: biliNormalizeStreams,
  resolveDownload: biliResolveDownload,
  filename: biliFilename,
  refresh: biliRefresh,
  // 长视频有 3GB+ 的单文件，blob 会整份驻留内存；落盘走 File System Access。
  streamToDisk: true,
};
