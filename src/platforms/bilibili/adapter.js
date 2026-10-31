import { biliRules, readBiliPage, biliCardBvid, biliCardTitle } from "./rules.js";
import { sanitizeName, sortStreams } from "../../kernel/extract.js";

const BILI_PLAYURL = "https://api.bilibili.com/x/player/playurl";
const BILI_VIEW = "https://api.bilibili.com/x/web-interface/view";
// fnval=1 单文件 MP4；fnval=4048 取 DASH（音视频分离），只用于单文件拿不到的高档位
const BILI_DASH_FNVAL = 4048;

export function biliPlayurlUrl(meta, qn, fnval = 1) {
  return (
    BILI_PLAYURL +
    "?bvid=" + encodeURIComponent(meta.bvid) +
    "&cid=" + encodeURIComponent(meta.cid) +
    "&fnver=0&fourk=1&fnval=" + fnval + "&qn=" + qn
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

// 同一 qn 下可能同时有 AVC/HEVC/AV1。优先 AVC（codecid 7），播放器与后续封装最稳。
function dashUrl(entry) {
  return (
    entry.baseUrl ||
    entry.base_url ||
    (entry.backupUrl && entry.backupUrl[0]) ||
    (entry.backup_url && entry.backup_url[0]) ||
    ""
  );
}

function pickDashVideo(list) {
  const avc = list.filter((v) => Number(v.codecid) === 7);
  return (avc.length ? avc : list).reduce(
    (best, v) => (Number(v.bandwidth) || 0) > (Number(best.bandwidth) || 0) ? v : best
  );
}

// 标准 AAC 音轨（30216/30232/30280）优先，取码率最高的一条
function pickDashAudio(list) {
  const standard = list.filter((a) => [30216, 30232, 30280].includes(Number(a.id)));
  const pool = standard.length ? standard : list;
  return pool.reduce(
    (best, a) => (Number(a.bandwidth) || 0) > (Number(best.bandwidth) || 0) ? a : best,
    pool[0]
  );
}

// 单文件接口拿不到、只能走 DASH 的档位（现代视频通常是 1080P 及以上）。
// 每档拆成「画面（无音轨）」与「音频」两条，各下一份；合并留到后续后处理。
export function buildBiliDashStreams(durlData, dashData) {
  const dash = dashData && dashData.dash;
  if (!dash || !Array.isArray(dash.video) || !dash.video.length) return [];
  if (!Array.isArray(dash.audio) || !dash.audio.length) return [];
  const durlStreams = buildBiliStreams(durlData);
  const durlMax = durlStreams.length ? Math.max(...durlStreams.map((s) => s.qn)) : -1;
  const qs = (dashData.accept_quality) || [];
  const descs = (dashData.accept_description) || [];
  const descOf = (qn) => {
    const i = qs.indexOf(qn);
    return (i >= 0 && descs[i]) || qn + "P";
  };
  const groups = new Map();
  for (const video of dash.video) {
    const qn = Number(video.id);
    if (!Number.isFinite(qn) || qn <= durlMax) continue;
    if (!groups.has(qn)) groups.set(qn, []);
    groups.get(qn).push(video);
  }
  const out = [];
  for (const [qn, list] of groups) {
    const desc = descOf(qn);
    out.push({ label: desc + " 画面（无音轨）", qn, kind: "video" });
    out.push({ label: desc + " 音频", qn, kind: "audio" });
  }
  return sortStreams(out);
}

export function biliParsePlayurl(data, meta, dashData) {
  if (!meta) return null;
  const streams = buildBiliStreams(data);
  const extra = dashData ? buildBiliDashStreams(data, dashData) : [];
  if (!streams.length && !extra.length) return null;
  return {
    videoId: String(meta.videoId || meta.cid),
    title: meta.title || "",
    author: meta.author || "",
    bvid: meta.bvid,
    cid: String(meta.cid),
    page: meta.page || 1,
    pageCount: meta.pageCount || 1,
    part: meta.part || "",
    streams: sortStreams([...streams, ...extra]),
  };
}

export function biliFilename(item, stream) {
  const parts = [item.author, item.title];
  if (item.pageCount > 1 && item.part) parts.push("P" + item.page + " " + item.part);
  parts.push(stream.label);
  const name = sanitizeName(parts.filter(Boolean).join("_")).replace(/\s+/g, " ");
  const ext = stream.kind === "audio" ? ".m4a" : ".mp4";
  return name.slice(0, 120) + ext;
}

export function biliParse(raw) {
  if (!raw || !raw.cid) return null;
  return biliParsePlayurl(raw, raw);
}

export function biliNormalizeStreams(raw) {
  return buildBiliStreams(raw);
}

// 直链两小时过期，点下载时才现取；单文件走 durl，分离流走 DASH 的 baseUrl。
export async function biliResolveDownload(item, stream) {
  if (stream.kind === "video" || stream.kind === "audio") {
    const resp = await fetch(biliPlayurlUrl(item, stream.qn, BILI_DASH_FNVAL), {
      credentials: "include",
    });
    const json = await resp.json();
    const dash = (json.data && json.data.dash) || {};
    let url = "";
    if (stream.kind === "video") {
      const same = (dash.video || []).filter((v) => Number(v.id) === Number(stream.qn));
      if (same.length) url = dashUrl(pickDashVideo(same));
    } else {
      const audio = dash.audio || [];
      if (audio.length) url = dashUrl(pickDashAudio(audio));
    }
    if (!url) throw new Error("该清晰度不可用");
    return { url, credentials: "omit", filename: biliFilename(item, stream) };
  }
  const resp = await fetch(biliPlayurlUrl(item, stream.qn), { credentials: "include" });
  const json = await resp.json();
  const durl = (json.data && json.data.durl) || [];
  if (!durl.length) throw new Error("该清晰度不可用");
  if (durl.length > 1) throw new Error("分段视频暂不支持（共 " + durl.length + " 段）");
  return { url: durl[0].url, credentials: "omit", filename: biliFilename(item, stream) };
}

// 卡片页只有 bvid，cid 与档位都得现查：view 给 cid/标题/作者，playurl 给档位。
// 同一 bvid 的并发查询合并成一个 Promise；成功后 store 缓存，失败后允许重试。
const cardPending = new Map();

export async function biliLoadCard(bvid, store) {
  const id = String(bvid || "");
  if (!id) throw new Error("缺少视频 id");
  const cached = store && store.get(id);
  if (cached && cached.streams && cached.streams.length) return cached;
  if (cardPending.has(id)) return cardPending.get(id);
  const task = (async () => {
    const resp = await fetch(BILI_VIEW + "?bvid=" + encodeURIComponent(id), {
      credentials: "include",
    });
    const json = await resp.json();
    if (!json || json.code !== 0 || !json.data) {
      throw new Error((json && json.message) || "获取视频信息失败");
    }
    const data = json.data;
    const first = Array.isArray(data.pages) ? data.pages[0] : null;
    if (!first || !first.cid) throw new Error("该视频暂无可下载分P");
    // 卡片默认只下第 1P
    const meta = {
      videoId: id,
      bvid: id,
      cid: String(first.cid),
      page: 1,
      pageCount: data.pages.length || 1,
      part: "",
      title: data.title || "",
      author: (data.owner && data.owner.name) || "",
    };
    const [durlJson, dashJson] = await Promise.all([
      fetch(biliPlayurlUrl(meta, 127), { credentials: "include" })
        .then((r) => r.json())
        .catch(() => null),
      fetch(biliPlayurlUrl(meta, 127, BILI_DASH_FNVAL), { credentials: "include" })
        .then((r) => r.json())
        .catch(() => null),
    ]);
    const item = biliParsePlayurl(durlJson && durlJson.data, meta, dashJson && dashJson.data);
    if (!item) throw new Error("该视频暂无可用清晰度");
    if (store) store.upsert(item);
    return item;
  })();
  cardPending.set(id, task);
  try {
    return await task;
  } finally {
    cardPending.delete(id);
  }
}

// 占位条目：按钮先挂上，cid/档位等点开（或 hover 预取）时再补
export function biliStub(videoId, el) {
  return {
    videoId: String(videoId),
    bvid: String(videoId),
    title: biliCardTitle(el),
    author: "",
    streams: [],
  };
}

// hover 预取：只处理卡片（bvid），详情页的 cid 数字 id 不动
export function biliPrefetch(videoId, store) {
  if (!/^BV/.test(String(videoId || ""))) return;
  const cached = store && store.get(videoId);
  if (cached && cached.streams && cached.streams.length) return;
  biliLoadCard(videoId, store).catch(() => {});
}

let biliFetching = false;
let biliLastCid = "";
let biliLastAt = 0;

// 清晰度列表不在 DOM 也不在 __playinfo__（那是首屏 SSR 且切 P 后不更新），只能自己问接口。
// 每个 cid 成功取一次；失败 5s 内不重试，避免 2s 定时器打爆接口。
export async function biliRefresh(store) {
  const loc = globalThis.location;
  // 卡片页没有当前分P，别拿首页的 __INITIAL_STATE__ 误当播放页
  if (loc && loc.pathname && !/^\/video\//.test(loc.pathname)) return;
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
    // 单文件拿低档，DASH 拿只有分离流的高档（1080P 及以上）；任一失败都不影响另一路
    const [durlJson, dashJson] = await Promise.all([
      fetch(biliPlayurlUrl(meta, 127), { credentials: "include" })
        .then((r) => r.json())
        .catch(() => null),
      fetch(biliPlayurlUrl(meta, 127, BILI_DASH_FNVAL), { credentials: "include" })
        .then((r) => r.json())
        .catch(() => null),
    ]);
    const item = biliParsePlayurl(
      durlJson && durlJson.data,
      meta,
      dashJson && dashJson.data
    );
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
  stub: biliStub,
  loadItem: biliLoadCard,
  prefetch: biliPrefetch,
  // 长视频有 3GB+ 的单文件，blob 会整份驻留内存；落盘走 File System Access。
  streamToDisk: true,
};
