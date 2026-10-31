import { test } from "node:test";
import assert from "node:assert/strict";
import {
  xhsBuildStreams,
  xhsCardAuthor,
  xhsCardTitle,
  xhsCardToken,
  xhsIsVideoNote,
  xhsNoteIdFromPath,
  xhsNoteToItem,
  xhsRules,
  xhsStateFromHtml,
} from "../src/platforms/xiaohongshu/rules.js";
import {
  xhsFilename,
  xhsLoadNote,
  xhsParse,
  xhsPrefetch,
  xhsRefresh,
  xhsResolveDownload,
  xhsNormalizeStreams,
  xhsStub,
  xiaohongshuAdapter,
} from "../src/platforms/xiaohongshu/adapter.js";
import { createStore } from "../src/kernel/store.js";

const NOTE_ID = "6ac31b54000000001b031669";

function withState(state) {
  const prev = globalThis.__INITIAL_STATE__;
  globalThis.__INITIAL_STATE__ = state;
  return () => {
    if (prev === undefined) delete globalThis.__INITIAL_STATE__;
    else globalThis.__INITIAL_STATE__ = prev;
  };
}

function fakeCard({ id = NOTE_ID, token = "", play = true, title = "", author = "" } = {}) {
  const link = token
    ? { getAttribute: (name) => (name === "href" ? `/explore/${id}?xsec_token=${token}&xsec_source=` : null) }
    : null;
  return {
    getAttribute: (name) => (name === "data-note-id" ? id : null),
    querySelector(sel) {
      if (sel === 'a[href*="xsec_token="]' || sel === "a.cover") return link;
      if (sel === ".title") return title ? { textContent: ` ${title} ` } : null;
      if (sel === ".author-wrapper .name" || sel === ".author .name") return author ? { textContent: author } : null;
      if (sel === ".play-icon") return play ? {} : null;
      return null;
    },
  };
}

// 一次笔记按 EF4/EF5 两个编码各有多档；EF4 同档码率更高
const note = {
  noteId: NOTE_ID,
  type: "video",
  title: "女子钓到一条大鱼",
  desc: "描述",
  user: { nickname: "合肥晚报" },
  video: {
    media: {
      stream: {
        EF4: [
          { width: 720, height: 1280, avgBitrate: 2154833, masterUrl: "https://cdn/720-avc.mp4" },
          { width: 1080, height: 1920, avgBitrate: 3434302, masterUrl: "https://cdn/1080-avc.mp4" },
        ],
        EF5: [
          { width: 720, height: 1280, avgBitrate: 1011347, masterUrl: "https://cdn/720-hevc.mp4" },
          { width: 1080, height: 1920, avgBitrate: 1472183, masterUrl: "https://cdn/1080-hevc.mp4" },
        ],
        EF6: [],
        EF7: [],
      },
    },
  },
};

test("xhsNoteIdFromPath 只认笔记详情路径，发现页返回 null", () => {
  assert.equal(xhsNoteIdFromPath(`/explore/${NOTE_ID}`), NOTE_ID);
  assert.equal(xhsNoteIdFromPath(`/discovery/item/${NOTE_ID}`), NOTE_ID);
  assert.equal(xhsNoteIdFromPath(`/red_video/${NOTE_ID}`), NOTE_ID);
  assert.equal(xhsNoteIdFromPath("/explore"), null);
  assert.equal(xhsNoteIdFromPath("/red_video"), null);
  assert.equal(xhsNoteIdFromPath(`/search_result?keyword=${NOTE_ID}`), null);
});

test("xhsBuildStreams 竖屏按短边命名，同档优先 EF4，按清晰度降序", () => {
  assert.deepEqual(xhsBuildStreams(note.video), [
    { label: "1080p", url: "https://cdn/1080-avc.mp4" },
    { label: "720p", url: "https://cdn/720-avc.mp4" },
  ]);
});

test("xhsBuildStreams 把 http 直链升成 https（混合内容会拦掉 http 的 fetch）", () => {
  const streams = xhsBuildStreams({
    media: {
      stream: {
        EF4: [{ width: 720, height: 1280, avgBitrate: 900, masterUrl: "http://sns-video-v4.xhscdn.com/a.mp4?s=1" }],
      },
    },
  });
  assert.deepEqual(streams, [{ label: "720p", url: "https://sns-video-v4.xhscdn.com/a.mp4?s=1" }]);
});

test("xhsBuildStreams 编码覆盖不同档时各自补上（EF4 只有 720 也保留 EF5 的高档）", () => {
  const streams = xhsBuildStreams({
    media: {
      stream: {
        EF4: [{ width: 1280, height: 720, avgBitrate: 1846, masterUrl: "https://cdn/720.mp4" }],
        EF5: [
          { width: 1280, height: 720, avgBitrate: 732, masterUrl: "https://cdn/720b.mp4" },
          { width: 1920, height: 1080, avgBitrate: 965, masterUrl: "https://cdn/1080.mp4" },
          { width: 2560, height: 1440, avgBitrate: 1422, masterUrl: "https://cdn/1440.mp4" },
          { width: 3840, height: 2160, avgBitrate: 3443, masterUrl: "https://cdn/2160.mp4" },
        ],
      },
    },
  });
  assert.deepEqual(
    streams.map((s) => s.label),
    ["2160p", "1440p", "1080p", "720p"]
  );
  assert.equal(streams[3].url, "https://cdn/720.mp4");
});

test("xhsBuildStreams 跳过无直链/无尺寸的条目，未知编码按码率取最高", () => {
  const streams = xhsBuildStreams({
    media: {
      stream: {
        EF4: [
          { width: 720, height: 1280, avgBitrate: 900, masterUrl: "https://cdn/a.mp4" },
          { width: 720, height: 1280, avgBitrate: 1800, masterUrl: "https://cdn/b.mp4" },
          { width: 720, height: 1280, avgBitrate: 9999 },
          { width: 0, height: 0, masterUrl: "https://cdn/c.mp4" },
        ],
      },
    },
  });
  assert.deepEqual(streams, [{ label: "720p", url: "https://cdn/b.mp4" }]);
  assert.deepEqual(xhsBuildStreams(null), []);
  assert.deepEqual(xhsBuildStreams({ media: {} }), []);
});

test("xhsIsVideoNote / xhsNoteToItem 只认视频笔记", () => {
  assert.equal(xhsIsVideoNote(note), true);
  assert.equal(xhsIsVideoNote({ type: "normal", video: {} }), false);
  const item = xhsNoteToItem(note);
  assert.equal(item.videoId, NOTE_ID);
  assert.equal(item.title, "女子钓到一条大鱼");
  assert.equal(item.author, "合肥晚报");
  assert.deepEqual(
    item.streams.map((s) => s.label),
    ["1080p", "720p"]
  );
  assert.equal(xhsNoteToItem({ type: "normal", noteId: "x" }), null);
});

test("xhsStateFromHtml 解析内联状态（含未加引号的 undefined）", () => {
  const html =
    '<html><script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"undefined":undefined,"' +
    NOTE_ID +
    '":{"note":{"type":"video"}}}},"x":NaN}</script></html>';
  const state = xhsStateFromHtml(html);
  assert.equal(state.note.noteDetailMap[NOTE_ID].note.type, "video");
  assert.equal(state.note.noteDetailMap.undefined, null);
  assert.equal(state.x, null);
  assert.equal(xhsStateFromHtml("<html></html>"), null);
  assert.equal(xhsStateFromHtml('<script>window.__INITIAL_STATE__={"a":1}'), null);
});

test("xhsStateFromHtml 兼容 new Map/Set 字面量（登录态笔记页的 tailMap）", () => {
  const html =
    '<html><script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"' +
    NOTE_ID +
    '":{"note":{"type":"video","video":{"media":{"stream":{"EF4":[{"width":720,"height":1280,' +
    '"masterUrl":"http://sns-video-v6.xhscdn.com/a.mp4?sign=1"}]}}}}}}},"tailMap":new Map([]),' +
    '"tags":new Set(["a","b"])}</script></html>';
  const state = xhsStateFromHtml(html);
  assert.equal(state.note.noteDetailMap[NOTE_ID].note.type, "video");
  assert.deepEqual(state.tailMap, {});
  assert.deepEqual(state.tags, ["a", "b"]);
});

test("xhsCardToken/xhsCardTitle/xhsCardAuthor 从卡片 DOM 取占位信息", () => {
  const card = fakeCard({ token: "ABtok=", title: "卡片标题", author: "卡片作者" });
  assert.equal(xhsCardToken(card), "ABtok=");
  assert.equal(xhsCardTitle(card), "卡片标题");
  assert.equal(xhsCardAuthor(card), "卡片作者");
  assert.equal(xhsCardToken(fakeCard()), "");
  assert.equal(xhsCardToken(null), "");
});

test("xhsRules 覆盖 www 全站：一条详情 + 一条卡片规则，详情按钮在播放器右上", () => {
  assert.deepEqual(xhsRules.matches, ["*://www.xiaohongshu.com/*"]);
  assert.deepEqual(
    xhsRules.anchors.map((a) => a.kind),
    ["detail", "card"]
  );
  const detail = xhsRules.anchors.find((a) => a.kind === "detail");
  assert.equal(detail.selector, "#noteContainer");
  assert.deepEqual(detail.pos, { top: 12, right: 12 });
  assert.equal(detail.pageScope.test(`/explore/${NOTE_ID}`), true);
  assert.equal(detail.pageScope.test(`/discovery/item/${NOTE_ID}`), true);
  assert.equal(detail.pageScope.test(`/red_video/${NOTE_ID}`), true);
  assert.equal(detail.pageScope.test("/explore"), false);
  assert.equal(detail.pageScope.test("/red_video"), false);
  const card = xhsRules.anchors.find((a) => a.kind === "card");
  assert.equal(card.selector, ".note-item");
  assert.equal(card.idFrom(fakeCard({ play: false })), null);
  assert.equal(card.idFrom(fakeCard()), NOTE_ID);
});

test("xhsRules 详情锚点：弹层不写页面状态时按播放器节点认视频笔记", () => {
  const detail = xhsRules.anchors.find((a) => a.kind === "detail");
  const restore = withState(undefined);
  const prevLoc = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { pathname: `/explore/${NOTE_ID}`, search: "" },
  });
  try {
    const player = { querySelector: (sel) => (sel.includes("player-container") ? {} : null) };
    assert.equal(detail.idFrom(player), NOTE_ID);
    const videoOnly = { querySelector: (sel) => (sel.includes("video") ? {} : null) };
    assert.equal(detail.idFrom(videoOnly), NOTE_ID);
    const imageNote = { querySelector: (sel) => (sel.includes("swiper") ? {} : null) };
    assert.equal(detail.idFrom(imageNote), null);
    assert.equal(detail.idFrom(null), null);
  } finally {
    if (prevLoc) Object.defineProperty(globalThis, "location", prevLoc);
    else delete globalThis.location;
    restore();
  }

  const restore2 = withState({ note: { noteDetailMap: { [NOTE_ID]: { note } } } });
  const prevLoc2 = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { pathname: `/explore/${NOTE_ID}`, search: "" },
  });
  try {
    assert.equal(detail.idFrom(null), NOTE_ID);
  } finally {
    if (prevLoc2) Object.defineProperty(globalThis, "location", prevLoc2);
    else delete globalThis.location;
    restore2();
  }
});

test("xhsStub 卡片带标题/作者与令牌；无令牌且状态里没有笔记时不挂按钮", () => {
  const restore = withState(undefined);
  try {
    const stub = xhsStub(NOTE_ID, fakeCard({ token: "tok", title: "占位标题", author: "占位作者" }), {
      kind: "card",
    });
    assert.equal(stub.videoId, NOTE_ID);
    assert.equal(stub.title, "占位标题");
    assert.equal(stub.author, "占位作者");
    assert.deepEqual(stub.streams, []);
    assert.equal(xhsStub(NOTE_ID, fakeCard({ token: "" }), { kind: "card" }), null);
  } finally {
    restore();
  }
});

test("xhsStub 详情用页面状态补标题，不带 DOM 依赖", () => {
  const restore = withState({ note: { noteDetailMap: { [NOTE_ID]: { note } } } });
  try {
    const stub = xhsStub(NOTE_ID, null, { kind: "detail" });
    assert.equal(stub.title, "女子钓到一条大鱼");
    assert.equal(stub.author, "合肥晚报");
    assert.deepEqual(stub.streams, []);
  } finally {
    restore();
  }
});

function mockNoteHtml(target) {
  return {
    ok: true,
    text: async () =>
      "<html><script>window.__INITIAL_STATE__=" +
      JSON.stringify({ note: { noteDetailMap: { [target.noteId]: { note: target } } } }) +
      "</script></html>",
  };
}

test("xhsLoadNote 按卡片令牌取笔记页状态并写入 store，第二次命中缓存", async () => {
  const restore = withState(undefined);
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return mockNoteHtml(note);
  };
  try {
    const card = fakeCard({ token: "ABtok=" });
    xhsStub(NOTE_ID, card, { kind: "card" });
    const store = createStore();
    const item = await xhsLoadNote(NOTE_ID, store);
    assert.equal(calls.length, 1);
    assert.match(calls[0], new RegExp(`/explore/${NOTE_ID}\\?xsec_token=ABtok%3D`));
    assert.equal(item.videoId, NOTE_ID);
    assert.equal(store.get(NOTE_ID).streams.length, 2);
    await xhsLoadNote(NOTE_ID, store);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});

test("xhsLoadNote 并发同一笔记只发一次请求", async () => {
  const restore = withState(undefined);
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return mockNoteHtml(note);
  };
  try {
    const store = createStore();
    await Promise.all([xhsLoadNote(NOTE_ID, store), xhsLoadNote(NOTE_ID, store)]);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});

test("xhsLoadNote 失败可重试；页面状态可用时 HTML 取不到也返回页面档位", async () => {
  const restore = withState(undefined);
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 404, text: async () => "" };
  };
  try {
    const store = createStore();
    await assert.rejects(() => xhsLoadNote("aaaaaaaaaaaaaaaaaaaaaaaa", store), /HTTP 404/);
    await assert.rejects(() => xhsLoadNote("aaaaaaaaaaaaaaaaaaaaaaaa", store), /HTTP 404/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }

  const restore2 = withState({ note: { noteDetailMap: { [NOTE_ID]: { note } } } });
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    const store = createStore();
    const item = await xhsLoadNote(NOTE_ID, store);
    assert.equal(item.streams.length, 2);
  } finally {
    globalThis.fetch = realFetch2;
    restore2();
  }
});

test("xhsLoadNote 用笔记页 HTML 补齐页面状态缺的档位（弹层里只列了当前档）", async () => {
  const partial = {
    ...note,
    video: {
      media: {
        stream: {
          EF4: [{ width: 720, height: 1280, avgBitrate: 3434770, masterUrl: "https://cdn/live-720.mp4" }],
        },
      },
    },
  };
  const full = {
    ...note,
    video: {
      media: {
        stream: {
          EF4: [{ width: 720, height: 1280, avgBitrate: 3434770, masterUrl: "https://cdn/html-720.mp4" }],
          EF5: [
            { width: 1080, height: 1920, avgBitrate: 2023682, masterUrl: "https://cdn/html-1080.mp4" },
            { width: 1440, height: 2560, avgBitrate: 3544871, masterUrl: "https://cdn/html-1440.mp4" },
            { width: 2160, height: 3840, avgBitrate: 6590211, masterUrl: "https://cdn/html-2160.mp4" },
          ],
        },
      },
    },
  };
  const restore = withState({ note: { noteDetailMap: { [NOTE_ID]: { note: partial } } } });
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return mockNoteHtml(full);
  };
  try {
    const store = createStore();
    const item = await xhsLoadNote(NOTE_ID, store);
    assert.equal(calls, 1);
    assert.deepEqual(
      item.streams.map((s) => s.label),
      ["2160p", "1440p", "1080p", "720p"]
    );
    assert.equal(item.streams[3].url, "https://cdn/live-720.mp4");
    assert.equal(store.get(NOTE_ID).__xhsFull, true);
    await xhsLoadNote(NOTE_ID, store);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});

test("xhsRefresh 把 noteDetailMap 里的视频笔记写进 store，补全过的 id 不再请求", async () => {
  const restore = withState({
    note: {
      noteDetailMap: {
        [NOTE_ID]: { note },
        img: { note: { noteId: "img", type: "normal", imageList: [] } },
        "": { note: null },
      },
    },
  });
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return mockNoteHtml(note);
  };
  try {
    const store = createStore();
    let writes = 0;
    store.onChange(() => writes++);
    await xhsRefresh(store);
    await xhsRefresh(store);
    assert.equal(calls, 1);
    assert.equal(writes, 1);
    assert.equal(store.get(NOTE_ID).streams.length, 2);
    assert.equal(store.size, 1);
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});

test("xhsResolveDownload 点选时重取新链，页面状态缺档时按笔记页 HTML 取，取不到退回旧链", async () => {
  const item = { videoId: NOTE_ID, title: "t", author: "up", streams: [] };
  const restore = withState({ note: { noteDetailMap: { [NOTE_ID]: { note } } } });
  try {
    const plan = await xhsResolveDownload(item, { label: "1080p", url: "https://cdn/old.mp4" });
    assert.equal(plan.url, "https://cdn/1080-avc.mp4");
    assert.equal(plan.credentials, "omit");
    assert.equal(plan.filename, "up_t_1080p.mp4");
  } finally {
    restore();
  }

  const partial = {
    ...note,
    video: {
      media: {
        stream: {
          EF4: [{ width: 720, height: 1280, avgBitrate: 3434770, masterUrl: "https://cdn/live-720.mp4" }],
        },
      },
    },
  };
  const restore3 = withState({ note: { noteDetailMap: { [NOTE_ID]: { note: partial } } } });
  const realFetch3 = globalThis.fetch;
  globalThis.fetch = async () =>
    mockNoteHtml({ ...partial, video: { media: { stream: { EF5: [{ width: 2160, height: 3840, avgBitrate: 6590211, masterUrl: "https://cdn/html-2160.mp4" }] } } } });
  try {
    const plan = await xhsResolveDownload(item, { label: "2160p", url: "https://cdn/old-2160.mp4" });
    assert.equal(plan.url, "https://cdn/html-2160.mp4");
  } finally {
    globalThis.fetch = realFetch3;
    restore3();
  }

  const restore2 = withState(undefined);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    const plan = await xhsResolveDownload(item, { label: "720p", url: "https://cdn/old-720.mp4" });
    assert.equal(plan.url, "https://cdn/old-720.mp4");
    await assert.rejects(() => xhsResolveDownload(item, { label: "480p", url: "" }), /该清晰度不可用/);
  } finally {
    globalThis.fetch = realFetch;
    restore2();
  }
});

test("xhsParse/xhsNormalizeStreams/xhsFilename 走中性契约", () => {
  assert.equal(xhsParse(note).videoId, NOTE_ID);
  assert.equal(xhsParse({ type: "normal" }), null);
  assert.deepEqual(
    xhsNormalizeStreams(note.video).map((s) => s.label),
    ["1080p", "720p"]
  );
  assert.equal(
    xhsFilename({ author: "up", title: "a/b:c" }, { label: "1080p" }),
    "up_a_b_c_1080p.mp4"
  );
});

test("xiaohongshuAdapter 暴露卡片现取钩子，且不带 SSR/perf 网络源", () => {
  assert.equal(xiaohongshuAdapter.ssrSelector, null);
  assert.equal(xiaohongshuAdapter.perfPattern, null);
  assert.deepEqual(xiaohongshuAdapter.sources, []);
  assert.deepEqual(xiaohongshuAdapter.domSources, []);
  assert.equal(typeof xiaohongshuAdapter.stub, "function");
  assert.equal(typeof xiaohongshuAdapter.loadItem, "function");
  assert.equal(typeof xiaohongshuAdapter.prefetch, "function");
  assert.equal(typeof xiaohongshuAdapter.refresh, "function");
  assert.equal(xiaohongshuAdapter.streamToDisk, undefined);
});

test("xhsPrefetch 补全过的档位不再请求，未补全的会补一次", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return mockNoteHtml(note);
  };
  try {
    const store = createStore();
    store.upsert({
      videoId: NOTE_ID,
      title: "t",
      author: "a",
      streams: [{ label: "720p", url: "u" }],
      __xhsFull: true,
    });
    xhsPrefetch(NOTE_ID, store);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls, 0);

    const store2 = createStore();
    store2.upsert({ videoId: NOTE_ID, title: "t", author: "a", streams: [{ label: "720p", url: "u" }] });
    xhsPrefetch(NOTE_ID, store2);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls, 1);
    assert.equal(store2.get(NOTE_ID).streams.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
