import { xhsBuildStreams, xhsCardAuthor, xhsCardTitle, xhsCardToken, xhsDetailMap, xhsIsVideoNote, xhsNoteIdFromPath, xhsNoteToItem, xhsNoteUrl, xhsRules, xhsStateFromHtml, xhsStateNote, xhsTokenFromLocation } from "./rules.js";
import { sanitizeName, sortStreams } from "../../kernel/extract.js";

// 卡片的 xsec_token 每次渲染都带在链接里，取档位时必须带上；详情页令牌从地址栏取
const xhsTokens = new Map();

function xhsRememberToken(id, token) {
  if (id && token) xhsTokens.set(String(id), token);
}

function xhsTokenFor(id) {
  const own = xhsTokens.get(id);
  if (own) return own;
  const loc = globalThis.location;
  return xhsNoteIdFromPath(loc && loc.pathname) === id ? xhsTokenFromLocation(loc) : "";
}

// 页面状态里的 stream 可能只剩播放器当前选中的那一档（弹层里实测 2160p 笔记只列 720p），
// 笔记页 HTML 才是完整档位。补全过的条目标上这个字段，之后不再重复请求。
const XHS_FULL = "__xhsFull";

function xhsMergeStreams(...lists) {
  const picked = new Map();
  for (const list of lists) {
    for (const s of list || []) {
      if (s && s.label && s.url && !picked.has(s.label)) picked.set(s.label, s);
    }
  }
  return sortStreams([...picked.values()]);
}

export async function xhsFetchNote(id, token) {
  const resp = await fetch(xhsNoteUrl(id, token), { credentials: "include" });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const state = xhsStateFromHtml(await resp.text());
  const map = state && state.note && state.note.noteDetailMap;
  const note = map && map[id] && map[id].note;
  if (!note) throw new Error("获取视频信息失败");
  if (!xhsIsVideoNote(note)) throw new Error("该笔记不是视频");
  return note;
}

// 详情页直接读页面状态；卡片只有 id 与令牌，按笔记页面 HTML 里的同一份状态取档位。
// 页面状态与 HTML 的档位取并集：页面状态里的链优先，HTML 补齐它缺的档位。
// 同一 id 的并发查询合并成一个 Promise；成功后写 store，失败后允许重试。
const xhsPending = new Map();

export async function xhsLoadNote(id, store) {
  const key = String(id || "");
  if (!key) throw new Error("缺少笔记 id");
  const cached = store && store.get(key);
  if (cached && cached[XHS_FULL]) return cached;
  if (xhsPending.has(key)) return xhsPending.get(key);
  const task = (async () => {
    const live = xhsStateNote(key);
    const liveNote = xhsIsVideoNote(live) ? live : null;
    const cachedStreams = (cached && cached.streams) || [];
    let fetched = null;
    try {
      fetched = await xhsFetchNote(key, xhsTokenFor(key));
    } catch (e) {
      // HTML 取不到（令牌过期/未登录）时页面状态里的档位照常用；两边都没有才算失败
      if (!liveNote && !cachedStreams.length) throw e;
    }
    const base = (liveNote && xhsNoteToItem(liveNote, key)) || (fetched && xhsNoteToItem(fetched, key)) || cached;
    if (!base) throw new Error("该笔记暂无可下载清晰度");
    const streams = xhsMergeStreams(
      liveNote ? xhsBuildStreams(liveNote.video) : [],
      cachedStreams,
      fetched ? xhsBuildStreams(fetched.video) : []
    );
    if (!streams.length) throw new Error("该笔记暂无可下载清晰度");
    const item = { ...base, videoId: String(base.videoId || key), streams, [XHS_FULL]: true };
    if (store) store.upsert(item);
    return item;
  })();
  xhsPending.set(key, task);
  try {
    return await task;
  } finally {
    xhsPending.delete(key);
  }
}

// 占位条目：按钮先挂上，档位等 hover/点击时再取。
// 卡片没有 xsec_token 且页面状态里也没有该笔记时取不到档位，直接不挂按钮。
export function xhsStub(videoId, el, rule) {
  const id = String(videoId || "");
  if (!id) return null;
  const isDetail = !!(rule && rule.kind === "detail");
  const note = xhsStateNote(id);
  const token = isDetail ? xhsTokenFromLocation() : xhsCardToken(el);
  if (token) xhsRememberToken(id, token);
  if (!isDetail && !token && !xhsIsVideoNote(note)) return null;
  return {
    videoId: id,
    title: isDetail ? String((note && (note.title || note.desc)) || "").slice(0, 80) : xhsCardTitle(el),
    author: isDetail ? (note && note.user && note.user.nickname) || "" : xhsCardAuthor(el),
    streams: [],
  };
}

export function xhsPrefetch(videoId, store) {
  const cached = store && store.get(videoId);
  if (cached && cached[XHS_FULL]) return;
  xhsLoadNote(videoId, store).catch(() => {});
}

// 详情弹层/直开详情页：noteDetailMap 就绪后补全档位并写进 store。
// 页面状态只有播放器当前档时也走 loadItem，用笔记页 HTML 补齐（补过的不再请求）
export async function xhsRefresh(store) {
  const map = xhsDetailMap();
  if (!map) return;
  const loc = globalThis.location;
  const currentId = xhsNoteIdFromPath(loc && loc.pathname);
  if (currentId) xhsRememberToken(currentId, xhsTokenFromLocation(loc));
  for (const key of Object.keys(map)) {
    const note = map[key] && map[key].note;
    if (!xhsIsVideoNote(note)) continue;
    const id = String(note.noteId || key);
    if (!id || id === "undefined") continue;
    const cached = store.get(id);
    if (cached && cached[XHS_FULL]) continue;
    try {
      await xhsLoadNote(id, store);
    } catch (e) {}
  }
}

export function xhsFilename(item, stream) {
  const name = sanitizeName([item.author, item.title, stream.label].filter(Boolean).join("_")).replace(/\s+/g, " ");
  return name.slice(0, 120) + ".mp4";
}

// CDN 直链带 csig 签名，可能过期：点下载时按同 id 重新取一次；
// 页面状态里没有这一档（弹层只列当前档）就去笔记页 HTML 取，取不到再退回菜单里的旧链
export async function xhsResolveDownload(item, stream) {
  const live = xhsStateNote(item.videoId);
  let fresh = xhsIsVideoNote(live) ? xhsBuildStreams(live.video) : [];
  let hit = fresh.find((s) => s.label === stream.label);
  if (!hit) {
    try {
      const note = await xhsFetchNote(item.videoId, xhsTokenFor(item.videoId));
      fresh = xhsBuildStreams(note.video);
      hit = fresh.find((s) => s.label === stream.label);
    } catch (e) {}
  }
  const url = (hit && hit.url) || stream.url;
  if (!url) throw new Error("该清晰度不可用");
  return { url, credentials: "omit", filename: xhsFilename(item, stream) };
}

export function xhsParse(raw) {
  return xhsIsVideoNote(raw) ? xhsNoteToItem(raw, raw.noteId) : null;
}

export function xhsNormalizeStreams(raw) {
  return xhsBuildStreams(raw && raw.video ? raw.video : raw);
}

export const xiaohongshuAdapter = {
  ...xhsRules,
  sources: [],
  domSources: [],
  parse: xhsParse,
  normalizeStreams: xhsNormalizeStreams,
  resolveDownload: xhsResolveDownload,
  filename: xhsFilename,
  refresh: xhsRefresh,
  stub: xhsStub,
  loadItem: xhsLoadNote,
  prefetch: xhsPrefetch,
};
