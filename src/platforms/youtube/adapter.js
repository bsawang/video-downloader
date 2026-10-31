import { ytCardTitle, ytCurrentVideoId, ytPageTitle, ytRules } from "./rules.js";
import { sanitizeName, sortStreams } from "../../kernel/extract.js";

const YT_PLAYER = "https://www.youtube.com/youtubei/v1/player";
// ytcfg 取不到时兜底（公开网页端 key，多年未变）
const YT_FALLBACK_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
// 网页端自身只给 SABR（无逐档直链），逐档直链要走移动端 client。
// VISIONOS：yt-dlp 默认 jsl 客户端，给到 2160p 的 AV1 MP4（可配 AAC 合并），
// 且直链对 Range 请求正常；ANDROID_VR 虽带 progressive，但直链在浏览器里
// 普遍 403/Failed to fetch，已降为最后兜底。IOS 作为中间层兜 LOGIN_REQUIRED。
const YT_CLIENTS = [
  {
    clientName: "VISIONOS",
    clientVersion: "1.02",
    deviceMake: "Apple",
    deviceModel: "RealityDevice17,1",
    osName: "visionOS",
    osVersion: "26.5.23O471",
    hl: "en",
    gl: "US",
  },
  {
    clientName: "IOS",
    clientVersion: "20.10.4",
    deviceModel: "iPhone16,2",
    osName: "iPhone",
    osVersion: "18.3.2.22D82",
    hl: "en",
    gl: "US",
  },
  {
    clientName: "ANDROID_VR",
    clientVersion: "1.62.27",
    androidSdkVersion: 32,
    osName: "Android",
    osVersion: "12",
    deviceMake: "Oculus",
    deviceModel: "Quest 3",
    hl: "en",
    gl: "US",
  },
];

export function ytApiKey() {
  try {
    const cfg = globalThis.ytcfg;
    const key = cfg && typeof cfg.get === "function" ? cfg.get("INNERTUBE_API_KEY") : "";
    if (key) return key;
  } catch (e) {}
  return YT_FALLBACK_KEY;
}

// 不带 visitorData 的匿名 InnerTube 请求会被当成机器人：VISIONOS/ANDROID_VR 直接
// LOGIN_REQUIRED，IOS 虽然能出链但直链只给前 1 MiB（Range 超出即 403）。
// 页面自己的 visitorData 连同 X-Goog-Visitor-Id 一起带上才拿得到完整直链。
export function ytVisitorData() {
  try {
    const cfg = globalThis.ytcfg;
    if (!cfg || typeof cfg.get !== "function") return "";
    const vd = cfg.get("VISITOR_DATA");
    if (vd) return String(vd);
    const ctx = cfg.get("INNERTUBE_CONTEXT");
    const inner = ctx && ctx.client && ctx.client.visitorData;
    if (inner) return String(inner);
  } catch (e) {}
  return "";
}

export function ytPlayerBody(videoId, client = YT_CLIENTS[0], visitorData = "") {
  const context = { client };
  if (visitorData) context.visitorData = visitorData;
  return {
    context,
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };
}

// googlevideo 直链有时是 http，https 页面上会被混合内容拦截
function ytHttps(url) {
  return String(url || "").replace(/^http:\/\//, "https://");
}

// 容器优先：MP4 才能和 AAC 音轨无损合并成一条。同档位里
// MP4+avc1 > MP4+av01 > MP4 其它 > WebM+vp9 > WebM+av01 > 其它
function ytCodecRank(mime) {
  const s = String(mime || "").toLowerCase();
  const codec = /avc1/.test(s) ? 0 : /av01/.test(s) ? 1 : 2;
  return (/^video\/mp4/.test(s) ? 0 : 3) + codec;
}

function ytBetter(a, b) {
  const d = ytCodecRank(a.mimeType) - ytCodecRank(b.mimeType);
  if (d !== 0) return d < 0;
  return (Number(a.bitrate) || 0) > (Number(b.bitrate) || 0);
}

function ytIsVideo(f) {
  return /^video\//.test(String((f && f.mimeType) || ""));
}

function ytIsAudio(f) {
  return /^audio\//.test(String((f && f.mimeType) || ""));
}

// 音轨只取 AAC/m4a 里码率最高的一条；合并档复用这条，拆分画面档也靠它补齐
function ytBestAac(adaptive) {
  const audios = (adaptive || []).filter(
    (f) => f && f.url && ytIsAudio(f) && /audio\/mp4/i.test(f.mimeType)
  );
  return audios.length
    ? audios.reduce(
        (a, b) => ((Number(b.bitrate) || 0) > (Number(a.bitrate) || 0) ? b : a),
        audios[0]
      )
    : null;
}

export function ytBuildStreams(data) {
  const sd = (data && data.streamingData) || {};
  const formats = Array.isArray(sd.formats) ? sd.formats : [];
  const adaptive = Array.isArray(sd.adaptiveFormats) ? sd.adaptiveFormats : [];
  const out = [];
  const seen = new Set();

  // 单文件（带音轨）：直接按 qualityLabel 入列
  for (const f of formats) {
    if (!f || !f.url || !ytIsVideo(f)) continue;
    const label = String(f.qualityLabel || "");
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, url: ytHttps(f.url), itag: Number(f.itag), size: Number(f.contentLength) || 0 });
  }

  const bestAudio = ytBestAac(adaptive);
  const audioKbps = bestAudio ? Math.round((Number(bestAudio.bitrate) || 0) / 1000) : 0;

  // 自适应画面：同 label 取编码/码率最优的一条
  const groups = new Map();
  for (const f of adaptive) {
    if (!f || !f.url || !ytIsVideo(f)) continue;
    const label = String(f.qualityLabel || "");
    if (!label) continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(f);
  }
  for (const [quality, list] of groups) {
    // 单文件档已覆盖同分辨率（自带音轨），不再重复列一条画面
    if (seen.has(quality)) continue;
    const best = list.reduce((a, b) => (ytBetter(b, a) ? b : a), list[0]);
    // MP4 画面 + AAC 音轨 → 一条合并档；WebM/VP9 或无 AAC 时仍列拆分画面
    if (bestAudio && /^video\/mp4/i.test(String(best.mimeType || ""))) {
      out.push({
        label: quality,
        url: ytHttps(best.url),
        itag: Number(best.itag),
        kind: "mux",
        size: Number(best.contentLength) || 0,
        audioItag: Number(bestAudio.itag),
        audioSize: Number(bestAudio.contentLength) || 0,
        audioUrl: ytHttps(bestAudio.url),
      });
      continue;
    }
    out.push({
      label: quality + " 画面（无音轨）",
      url: ytHttps(best.url),
      itag: Number(best.itag),
      kind: "video",
      size: Number(best.contentLength) || 0,
    });
  }

  // 独立音频只在存在无法合并的画面档时列出；能合并的档自带音轨，不再重复
  if (bestAudio && out.some((s) => s.kind === "video")) {
    out.push({
      label: "音频 " + (audioKbps ? audioKbps + "kbps" : ""),
      url: ytHttps(bestAudio.url),
      itag: Number(bestAudio.itag),
      kind: "audio",
      size: Number(bestAudio.contentLength) || 0,
    });
  }

  return sortStreams(out);
}

function ytStatusText(status) {
  const reason = (status && status.reason) || "";
  // 匿名 InnerTube 被风控时同样报 LOGIN_REQUIRED，但用户登录了也没用，得先在页面里过一次
  if (/not a bot/i.test(reason)) return "YouTube 要求人机验证，请先在浏览器打开该视频后再试";
  if (status && status.status === "LOGIN_REQUIRED") return "该视频需要登录或年龄验证";
  return reason || "该视频不可下载";
}

export function ytParsePlayer(data, videoId) {
  if (!data) return null;
  const status = data.playabilityStatus || {};
  if (status.status && status.status !== "OK") return null;
  const streams = ytBuildStreams(data);
  if (!streams.length) return null;
  const details = data.videoDetails || {};
  return {
    videoId: String(details.videoId || videoId || ""),
    title: details.title || "",
    author: details.author || "",
    streams,
  };
}

const YT_PLAYER_TIMEOUT = 15000;
const YT_PROBE_TIMEOUT = 8000;

// 代理链路下请求可能一直挂着不返回，探测/取档都必须带超时
async function ytFetchTimeout(url, opts, ms) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    return await fetch(url, ctrl ? { ...opts, signal: ctrl.signal } : opts);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ytPlayerOnce(videoId, client) {
  const visitorData = ytVisitorData();
  const headers = { "Content-Type": "application/json" };
  if (visitorData) headers["X-Goog-Visitor-Id"] = visitorData;
  const resp = await ytFetchTimeout(
    YT_PLAYER + "?key=" + encodeURIComponent(ytApiKey()) + "&prettyPrint=false",
    {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(ytPlayerBody(videoId, client, visitorData)),
    },
    YT_PLAYER_TIMEOUT
  );
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const json = await resp.json();
  const status = (json && json.playabilityStatus) || {};
  if (status.status && status.status !== "OK") throw new Error(ytStatusText(status));
  const data = (json && json.streamingData) || {};
  if (!(data.formats || []).length && !(data.adaptiveFormats || []).length) {
    throw new Error("该视频没有可下载的清晰度");
  }
  return json;
}

export async function ytFetchPlayer(videoId) {
  let lastErr = null;
  for (const client of YT_CLIENTS) {
    try {
      return await ytPlayerOnce(videoId, client);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("该视频不可下载");
}

// 同一 id 的并发查询合并成一个 Promise；成功后 store 缓存，失败后允许重试
const ytPending = new Map();

export async function ytLoadVideo(videoId, store) {
  const id = String(videoId || "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error("缺少视频 id");
  const cached = store && store.get(id);
  if (cached && cached.streams && cached.streams.length) return cached;
  if (ytPending.has(id)) return ytPending.get(id);
  const task = (async () => {
    const data = await ytFetchPlayer(id);
    const item = ytParsePlayer(data, id);
    if (!item) throw new Error("该视频暂无可下载清晰度");
    if (store) store.upsert(item);
    return item;
  })();
  ytPending.set(id, task);
  try {
    return await task;
  } finally {
    ytPending.delete(id);
  }
}

export function ytStub(videoId, el, rule) {
  const id = String(videoId || "");
  if (!id) return null;
  const isDetail = !!(rule && rule.kind === "detail");
  return {
    videoId: id,
    title: isDetail ? ytPageTitle() : ytCardTitle(el),
    author: "",
    streams: [],
  };
}

let ytFetching = false;
let ytLastId = "";
let ytLastAt = 0;

// 播放页档位不在 DOM 里，InnerTube 每 2s 轮询时补一次；失败 5s 内不重试同一 id
export async function ytRefresh(store) {
  const id = ytCurrentVideoId();
  if (!id) return;
  const cached = store.get(id);
  if (cached && cached.streams && cached.streams.length) return;
  if (ytFetching) return;
  const now = Date.now();
  if (id === ytLastId && now - ytLastAt < 5000) return;
  ytFetching = true;
  ytLastId = id;
  ytLastAt = now;
  try {
    await ytLoadVideo(id, store);
  } catch (e) {
  } finally {
    ytFetching = false;
  }
}

export function ytFilename(item, stream) {
  const name = sanitizeName([item.author, item.title, stream.label].filter(Boolean).join("_")).replace(/\s+/g, " ");
  const ext = stream.kind === "audio" ? ".m4a" : ".mp4";
  return name.slice(0, 120) + ext;
}

// googlevideo 每次下发的边缘节点不同，个别节点在部分网络下连不上（Failed to fetch）。
// 直链自带 mn=节点列表，用同一个 rrN 前缀换节点再探一次；最多两个，别把探测变成风暴。
function ytHostCandidates(url) {
  const u = new URL(url);
  const prefix = (u.host.match(/^(rr\d+---)/) || ["rr1---"])[0];
  const out = [url];
  for (const node of (u.searchParams.get("mn") || "").split(",")) {
    if (!node) continue;
    const cand = url.replace(u.host, prefix + node + ".googlevideo.com");
    if (out.includes(cand)) continue;
    out.push(cand);
    break;
  }
  return out;
}

// 从 1 MiB 处取 2 字节：风控状态下的 IOS 直链只给前 1 MiB，这个偏移直接 403，
// 正好能把预览链筛掉；正常链 206 且只回来 2 字节，不会把整份视频拉进内存。
const YT_PROBE_OFFSET = 1048576;
const YT_PROBE_RANGE = "bytes=" + YT_PROBE_OFFSET + "-" + (YT_PROBE_OFFSET + 1);

// 返回能取到数据的节点；返回 null 由调用方换下一个 client。
// 403 是签名本身被拒，换节点也没用，直接放弃这条链。
async function ytPickReachable(url) {
  for (const cand of ytHostCandidates(url)) {
    try {
      const resp = await ytFetchTimeout(
        cand,
        { credentials: "omit", cache: "no-store", headers: { Range: YT_PROBE_RANGE } },
        YT_PROBE_TIMEOUT
      );
      // 416 = 文件比探测偏移还小，签名本身是好的
      const ok = resp.status === 206 || resp.status === 200 || resp.status === 416;
      try {
        await resp.body.cancel();
      } catch (e) {}
      if (ok) return cand;
      if (resp.status === 403) return null;
    } catch (e) {}
  }
  return null;
}

// googlevideo 对部分签名只认带上界的 Range：不带 Range 或 bytes=0- 都会 403。
// 播放响应里就有 contentLength，直接要 bytes=0-<size-1>，拿到的就是完整文件。
function ytRange(size) {
  const n = Number(size) || 0;
  return n > 0 ? "bytes=0-" + (n - 1) : "bytes=0-";
}

function ytPlan(item, stream, videoUrl, audioUrl, videoSize, audioSize) {
  const req = (size) => ({ credentials: "omit", cache: "no-store", headers: { Range: ytRange(size) } });
  if (stream.kind === "mux") {
    return {
      merge: "fmp4",
      parts: [
        { url: videoUrl, ...req(videoSize) },
        { url: audioUrl, ...req(audioSize) },
      ],
      filename: ytFilename(item, stream),
    };
  }
  return {
    url: videoUrl,
    ...req(videoSize),
    filename: ytFilename(item, stream),
  };
}

// 画面/音轨都探得通才算可用，返回 null 让上层换下一个 client
async function ytProbePlan(item, stream, videoUrl, audioUrl, videoSize, audioSize) {
  if (!videoUrl) return null;
  if (stream.kind === "mux" && !audioUrl) return null;
  const videoOk = await ytPickReachable(videoUrl);
  if (!videoOk) return null;
  const audioOk = audioUrl ? await ytPickReachable(audioUrl) : "";
  if (audioUrl && !audioOk) return null;
  return ytPlan(item, stream, videoOk, audioOk, videoSize, audioSize);
}

// 直链带 expire/签名字段，点下载时按同 id 重取；label 优先、itag 次之。
// 每个 client 只取一份响应：连着重取十几次会被 googlevideo 判成滥用，
// 之后连好签名一起 403 —— 换 client 已经是三次独立机会，剩下的交给用户再点一次。
export async function ytResolveDownload(item, stream) {
  for (const client of YT_CLIENTS) {
    let data = null;
    try {
      data = await ytPlayerOnce(item.videoId, client);
    } catch (e) {
      continue;
    }
    const fresh = ytBuildStreams(data);
    const hit =
      fresh.find((s) => s.label === stream.label) ||
      (stream.itag ? fresh.find((s) => s.itag === stream.itag) : null);
    if (!hit) continue;
    let audioUrl = "";
    let audioSize = 0;
    if (stream.kind === "mux") {
      const bestAudio = ytBestAac((data.streamingData || {}).adaptiveFormats);
      audioUrl = (bestAudio ? ytHttps(bestAudio.url) : "") || stream.audioUrl || "";
      audioSize = (bestAudio ? Number(bestAudio.contentLength) : 0) || stream.audioSize || 0;
      if (!audioUrl) continue;
    }
    const plan = await ytProbePlan(item, stream, hit.url, audioUrl, hit.size, audioSize);
    if (plan) return plan;
  }
  // 新链全被拒时，菜单里的旧链也还有约 2 小时有效期，同样探一次
  const plan = await ytProbePlan(
    item,
    stream,
    stream.url,
    stream.audioUrl || "",
    stream.size,
    stream.audioSize
  );
  if (plan) return plan;
  throw new Error("YouTube 直链被拒绝，请刷新页面后重试");
}

export function ytParse(raw) {
  if (!raw) return null;
  return ytParsePlayer(raw, raw.videoDetails && raw.videoDetails.videoId);
}

export function ytNormalizeStreams(raw) {
  return ytBuildStreams(raw);
}

export const youtubeAdapter = {
  ...ytRules,
  sources: [],
  domSources: [],
  parse: ytParse,
  normalizeStreams: ytNormalizeStreams,
  resolveDownload: ytResolveDownload,
  filename: ytFilename,
  refresh: ytRefresh,
  stub: ytStub,
  loadItem: ytLoadVideo,
  // 4K 单档可达数百 MB，blob 整份驻留内存不可用；落盘走 File System Access
  streamToDisk: true,
};
