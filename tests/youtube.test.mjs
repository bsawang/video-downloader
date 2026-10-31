import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ytCardTitle,
  ytCardVideoId,
  ytCurrentVideoId,
  ytRules,
  ytVideoIdFromUrl,
} from "../src/platforms/youtube/rules.js";
import {
  youtubeAdapter,
  ytBuildStreams,
  ytFetchPlayer,
  ytFilename,
  ytLoadVideo,
  ytParsePlayer,
  ytRefresh,
  ytResolveDownload,
  ytStub,
} from "../src/platforms/youtube/adapter.js";
import { createStore } from "../src/kernel/store.js";

const ID = "dQw4w9WgXcQ";

const player = {
  playabilityStatus: { status: "OK" },
  videoDetails: { videoId: ID, title: "测试视频", author: "测试作者" },
  streamingData: {
    formats: [
      {
        itag: 18,
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        qualityLabel: "360p",
        bitrate: 600000,
        url: "http://rr1.example.com/videoplayback?itag=18",
      },
    ],
    adaptiveFormats: [
      {
        itag: 137,
        mimeType: 'video/mp4; codecs="avc1.640028"',
        qualityLabel: "1080p",
        bitrate: 2000000,
        url: "https://rr1.example.com/v137",
      },
      {
        itag: 248,
        mimeType: 'video/webm; codecs="vp9"',
        qualityLabel: "1080p",
        bitrate: 3000000,
        url: "https://rr1.example.com/v248",
      },
      {
        itag: 400,
        mimeType: 'video/mp4; codecs="av01.0.08M.08"',
        qualityLabel: "1440p",
        bitrate: 3500000,
        url: "https://rr1.example.com/v400",
      },
      {
        itag: 999,
        mimeType: 'video/mp4; codecs="avc1.4d401f"',
        qualityLabel: "720p",
        bitrate: 1200000,
      },
      {
        itag: 140,
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 129000,
        url: "https://rr1.example.com/a140",
      },
      {
        itag: 251,
        mimeType: 'audio/webm; codecs="opus"',
        bitrate: 160000,
        url: "https://rr1.example.com/a251",
      },
    ],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withYtcfg(key) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "ytcfg");
  Object.defineProperty(globalThis, "ytcfg", {
    configurable: true,
    value: key ? { get: (name) => (name === "INNERTUBE_API_KEY" ? key : "") } : undefined,
  });
  return () => {
    if (prev) Object.defineProperty(globalThis, "ytcfg", prev);
    else delete globalThis.ytcfg;
  };
}

function withLocation(search) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search } });
  return () => {
    if (prev) Object.defineProperty(globalThis, "location", prev);
    else delete globalThis.location;
  };
}

function mockFetch(handler) {
  const prev = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts, calls.length);
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = prev;
    },
  };
}

function ok(json) {
  return { ok: true, status: 200, json: async () => json };
}

test("ytVideoIdFromUrl 解析 watch 与 shorts 的 id", () => {
  assert.equal(ytVideoIdFromUrl("https://www.youtube.com/watch?v=" + ID + "&list=x"), ID);
  assert.equal(ytVideoIdFromUrl("/watch?v=" + ID), ID);
  assert.equal(ytVideoIdFromUrl("https://www.youtube.com/shorts/" + ID), ID);
  assert.equal(ytVideoIdFromUrl("/shorts/" + ID + "?feature=share"), ID);
  assert.equal(ytVideoIdFromUrl("https://www.youtube.com/watch?v=short"), null);
  assert.equal(ytVideoIdFromUrl("https://www.youtube.com/shorts/short"), null);
  assert.equal(ytVideoIdFromUrl("https://www.youtube.com/results?search_query=rick"), null);
  assert.equal(ytVideoIdFromUrl(""), null);
});

test("ytCurrentVideoId 从地址栏 pathname/search 取 id", () => {
  assert.equal(ytCurrentVideoId({ search: "?v=" + ID }), ID);
  assert.equal(ytCurrentVideoId({ pathname: "/shorts/" + ID, search: "" }), ID);
  assert.equal(ytCurrentVideoId({ search: "?list=x" }), null);
  assert.equal(ytCurrentVideoId({ pathname: "/shorts/", search: "" }), null);
});

test("ytCardVideoId 从卡片内视频链接取 id，无链接返回 null", () => {
  const card = {
    querySelectorAll: () => [
      { getAttribute: () => "/channel/UC123" },
      { getAttribute: () => "/watch?v=" + ID + "&pp=abc" },
    ],
  };
  assert.equal(ytCardVideoId(card), ID);
  const shorts = { querySelectorAll: () => [{ getAttribute: () => "/shorts/" + ID }] };
  assert.equal(ytCardVideoId(shorts), ID);
  assert.equal(ytCardVideoId({ querySelectorAll: () => [] }), null);
  assert.equal(ytCardVideoId(null), null);
});

test("ytCardTitle 依次尝试标题选择器", () => {
  const card = { querySelector: (sel) => (sel === "h3" ? { textContent: "  标题  " } : null) };
  assert.equal(ytCardTitle(card), "标题");
  assert.equal(ytCardTitle({ querySelector: () => null }), "");
});

test("ytBuildStreams 单文件带音轨、自适应 MP4 与 AAC 合成合并档且优先 H.264", () => {
  const streams = ytBuildStreams(player);
  assert.deepEqual(
    streams.map((s) => s.label),
    ["1440p", "1080p", "360p", "音频 129kbps"]
  );
  const p1080 = streams.find((s) => s.label === "1080p");
  assert.equal(p1080.itag, 137);
  assert.equal(p1080.kind, "mux");
  assert.equal(p1080.audioItag, 140);
  assert.equal(p1080.audioUrl, "https://rr1.example.com/a140");
  assert.equal(p1080.url, "https://rr1.example.com/v137");
  const progressive = streams.find((s) => s.label === "360p");
  assert.equal(progressive.itag, 18);
  assert.equal(progressive.kind, undefined);
  assert.equal(progressive.url, "https://rr1.example.com/videoplayback?itag=18");
  const audio = streams.find((s) => s.kind === "audio");
  assert.equal(audio.itag, 140);
  assert.equal(audio.label, "音频 129kbps");
});

test("ytBuildStreams WebM/VP9 或无 AAC 时保留拆分画面", () => {
  const vp9 = clone(player);
  vp9.streamingData.adaptiveFormats = [
    vp9.streamingData.adaptiveFormats.find((f) => f.itag === 248),
    vp9.streamingData.adaptiveFormats.find((f) => f.itag === 140),
  ];
  assert.deepEqual(
    ytBuildStreams(vp9).map((s) => [s.label, s.kind]),
    [
      ["1080p 画面（无音轨）", "video"],
      ["360p", undefined],
      ["音频 129kbps", "audio"],
    ]
  );
  const noAudio = clone(player);
  noAudio.streamingData.formats = [];
  noAudio.streamingData.adaptiveFormats = noAudio.streamingData.adaptiveFormats.filter(
    (f) => !/^audio\//.test(f.mimeType)
  );
  assert.deepEqual(
    ytBuildStreams(noAudio).map((s) => [s.label, s.kind]),
    [
      ["1440p 画面（无音轨）", "video"],
      ["1080p 画面（无音轨）", "video"],
    ]
  );
});

test("ytBuildStreams 跳过无 url / 无 label 的条目", () => {
  const streams = ytBuildStreams({
    streamingData: {
      formats: [{ itag: 18, mimeType: "video/mp4", qualityLabel: "360p" }],
      adaptiveFormats: [{ itag: 137, mimeType: "video/mp4", url: "https://x/v" }],
    },
  });
  assert.deepEqual(streams, []);
});

test("ytParsePlayer 转换元信息，非 OK 或无流返回 null", () => {
  const item = ytParsePlayer(player, ID);
  assert.equal(item.videoId, ID);
  assert.equal(item.title, "测试视频");
  assert.equal(item.author, "测试作者");
  assert.equal(item.streams.length, 4);
  assert.equal(ytParsePlayer({ ...player, playabilityStatus: { status: "LOGIN_REQUIRED" } }, ID), null);
  assert.equal(ytParsePlayer({ ...player, streamingData: {} }, ID), null);
  assert.equal(ytParsePlayer(null, ID), null);
});

test("ytFetchPlayer 请求 InnerTube 并走 ytcfg 的 key", async () => {
  const restoreCfg = withYtcfg("TESTKEY");
  const mock = mockFetch(() => ok(clone(player)));
  try {
    const data = await ytFetchPlayer(ID);
    assert.equal(data.videoDetails.videoId, ID);
    assert.match(mock.calls[0].url, /\/youtubei\/v1\/player\?key=TESTKEY&prettyPrint=false/);
    assert.equal(mock.calls[0].opts.method, "POST");
    const body = JSON.parse(mock.calls[0].opts.body);
    assert.equal(body.videoId, ID);
    assert.equal(body.context.client.clientName, "ANDROID_VR");
    assert.equal(body.contentCheckOk, true);
  } finally {
    mock.restore();
    restoreCfg();
  }
});

test("ytFetchPlayer 非 2xx 与不可播放状态抛错", async () => {
  const restoreCfg = withYtcfg("K");
  let mock = mockFetch(() => ({ ok: false, status: 429, json: async () => ({}) }));
  try {
    await assert.rejects(ytFetchPlayer(ID), /HTTP 429/);
  } finally {
    mock.restore();
  }
  mock = mockFetch(() => ok({ playabilityStatus: { status: "LOGIN_REQUIRED" } }));
  try {
    await assert.rejects(ytFetchPlayer(ID), /需要登录或年龄验证/);
  } finally {
    mock.restore();
  }
  mock = mockFetch(() =>
    ok({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" } })
  );
  try {
    await assert.rejects(ytFetchPlayer(ID), /人机验证/);
  } finally {
    mock.restore();
    restoreCfg();
  }
});

test("ytFetchPlayer 首个 client 被风控时换 IOS 重试", async () => {
  const restoreCfg = withYtcfg("K");
  const mock = mockFetch((url, opts, n) =>
    n === 1
      ? ok({
          playabilityStatus: {
            status: "LOGIN_REQUIRED",
            reason: "Sign in to confirm you’re not a bot",
          },
        })
      : ok(clone(player))
  );
  try {
    const data = await ytFetchPlayer(ID);
    assert.equal(data.videoDetails.videoId, ID);
    assert.equal(mock.calls.length, 2);
    assert.equal(JSON.parse(mock.calls[1].opts.body).context.client.clientName, "IOS");
  } finally {
    mock.restore();
    restoreCfg();
  }
});

test("ytLoadVideo 取档位写 store，第二次命中缓存", async () => {
  const restoreCfg = withYtcfg("K");
  const mock = mockFetch(() => ok(clone(player)));
  try {
    const store = createStore();
    const item = await ytLoadVideo(ID, store);
    assert.equal(item.streams.length, 4);
    assert.equal(store.get(ID).title, "测试视频");
    await ytLoadVideo(ID, store);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
    restoreCfg();
  }
});

test("ytLoadVideo 并发同一 id 只发一次请求，失败后可重试", async () => {
  const restoreCfg = withYtcfg("K");
  let fail = true;
  const mock = mockFetch(() => (fail ? { ok: false, status: 500, json: async () => ({}) } : ok(clone(player))));
  try {
    const store = createStore();
    await assert.rejects(ytLoadVideo(ID, store), /HTTP 500/);
    fail = false;
    const [a, b] = await Promise.all([ytLoadVideo(ID, store), ytLoadVideo(ID, store)]);
    assert.equal(a, b);
    // 失败那次两个 client 各一发；并发成功只发一发
    assert.equal(mock.calls.length, 3);
  } finally {
    mock.restore();
    restoreCfg();
  }
});

test("ytLoadVideo 拒绝非法 id", async () => {
  await assert.rejects(ytLoadVideo("short", createStore()), /缺少视频 id/);
});

test("ytResolveDownload 按 label 取新链，失败退回菜单旧链", async () => {
  const restoreCfg = withYtcfg("K");
  const fresh = clone(player);
  fresh.streamingData.formats[0].url = "https://rr2.example.com/fresh18";
  let mock = mockFetch(() => ok(fresh));
  try {
    const stream = ytBuildStreams(player).find((s) => s.itag === 18);
    const item = ytParsePlayer(player, ID);
    const plan = await ytResolveDownload(item, stream);
    assert.equal(plan.url, "https://rr2.example.com/fresh18");
    assert.equal(plan.credentials, "omit");
    assert.deepEqual(plan.headers, { Range: "bytes=0-" });
    assert.match(plan.filename, /测试作者_测试视频_360p\.mp4$/);
  } finally {
    mock.restore();
  }
  mock = mockFetch(() => ({ ok: false, status: 403, json: async () => ({}) }));
  try {
    const stream = ytBuildStreams(player).find((s) => s.kind === "audio");
    const item = ytParsePlayer(player, ID);
    const plan = await ytResolveDownload(item, stream);
    assert.equal(plan.url, "https://rr1.example.com/a140");
    assert.match(plan.filename, /音频 129kbps\.m4a$/);
  } finally {
    mock.restore();
    restoreCfg();
  }
});

test("ytResolveDownload 无可用直链时抛错", async () => {
  const restoreCfg = withYtcfg("K");
  const mock = mockFetch(() => ({ ok: false, status: 403, json: async () => ({}) }));
  try {
    await assert.rejects(
      ytResolveDownload({ videoId: ID }, { label: "1080p 画面（无音轨）", itag: 137 }),
      /该清晰度不可用/
    );
  } finally {
    mock.restore();
    restoreCfg();
  }
});

test("ytResolveDownload 节点不可达时换 mn 里的节点", async () => {
  const restoreCfg = withYtcfg("K");
  const fresh = clone(player);
  fresh.streamingData.adaptiveFormats.find((f) => f.itag === 137).url =
    "https://rr2---sn-aaa.googlevideo.com/videoplayback?itag=137&mn=sn-aaa,sn-bbb";
  const mock = mockFetch((url) => {
    if (!/googlevideo/.test(url)) return ok(fresh);
    if (new URL(url).host.includes("sn-aaa")) throw new Error("node down");
    return { ok: true, status: 206, json: async () => ({}) };
  });
  try {
    const stream = ytBuildStreams(fresh).find((s) => s.itag === 137);
    assert.equal(stream.kind, "mux");
    const item = ytParsePlayer(fresh, ID);
    const plan = await ytResolveDownload(item, stream);
    assert.match(plan.parts[0].url, /rr2---sn-bbb\.googlevideo\.com/);
  } finally {
    mock.restore();
    restoreCfg();
  }
});

test("ytResolveDownload 合并档返回画面 + 音轨两路新链", async () => {
  const restoreCfg = withYtcfg("K");
  const fresh = clone(player);
  fresh.streamingData.adaptiveFormats.find((f) => f.itag === 137).url = "https://rr2.example.com/v137fresh";
  fresh.streamingData.adaptiveFormats.find((f) => f.itag === 140).url = "https://rr2.example.com/a140fresh";
  const mock = mockFetch(() => ok(fresh));
  try {
    const stream = ytBuildStreams(player).find((s) => s.label === "1080p");
    const plan = await ytResolveDownload(ytParsePlayer(player, ID), stream);
    assert.equal(plan.merge, "fmp4");
    assert.equal(plan.parts.length, 2);
    assert.equal(plan.parts[0].url, "https://rr2.example.com/v137fresh");
    assert.equal(plan.parts[1].url, "https://rr2.example.com/a140fresh");
    assert.deepEqual(plan.parts[0].headers, { Range: "bytes=0-" });
    assert.match(plan.filename, /测试作者_测试视频_1080p\.mp4$/);
  } finally {
    mock.restore();
    restoreCfg();
  }
});

test("ytFilename 清理非法字符并按流类型取扩展名", () => {
  assert.equal(
    ytFilename({ author: "a", title: "b/c" }, { label: "1080p 画面（无音轨）" }),
    "a_b_c_1080p 画面（无音轨）.mp4"
  );
  assert.equal(ytFilename({ author: "a", title: "b" }, { label: "音频 129kbps", kind: "audio" }), "a_b_音频 129kbps.m4a");
});

test("ytStub 卡片取 DOM 标题，详情取页面标题", () => {
  const card = { querySelector: (sel) => (sel === "#video-title" ? { textContent: "卡片标题" } : null) };
  assert.deepEqual(ytStub(ID, card, { kind: "card" }), { videoId: ID, title: "卡片标题", author: "", streams: [] });
  const prevDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { title: "视频标题 - YouTube" },
  });
  try {
    assert.equal(ytStub(ID, null, { kind: "detail" }).title, "视频标题");
  } finally {
    if (prevDoc) Object.defineProperty(globalThis, "document", prevDoc);
    else delete globalThis.document;
  }
  assert.equal(ytStub("", card, { kind: "card" }), null);
});

test("ytRefresh 从地址栏取 id 补档，已有档位不再请求", async () => {
  const restoreCfg = withYtcfg("K");
  const restoreLoc = withLocation("?v=" + ID);
  const mock = mockFetch(() => ok(clone(player)));
  try {
    const store = createStore();
    await ytRefresh(store);
    assert.equal(store.get(ID).streams.length, 4);
    await ytRefresh(store);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
    restoreLoc();
    restoreCfg();
  }
});

test("ytRules 播放页/Shorts 锚点与卡片锚点", () => {
  assert.deepEqual(ytRules.matches, ["*://www.youtube.com/*", "*://youtube.com/*"]);
  const watch = ytRules.anchors.find((a) => a.selector === "#movie_player");
  assert.equal(watch.kind, "detail");
  assert.deepEqual(watch.pos, { top: 12, right: 12 });
  assert.equal(watch.pageScope.test("/watch"), true);
  assert.equal(watch.pageScope.test("/shorts/" + ID), false);
  assert.equal(watch.pageScope.test("/results"), false);
  const shorts = ytRules.anchors.find((a) => a.selector === "#shorts-player");
  assert.equal(shorts.kind, "detail");
  assert.deepEqual(shorts.mount, ["self"]);
  // 顶部 12px 是站点控件（播放/静音/全屏），按钮下移到 70px 让开
  assert.deepEqual(shorts.pos, { top: 70, right: 12 });
  assert.equal(shorts.pageScope.test("/shorts/" + ID), true);
  assert.equal(shorts.pageScope.test("/watch"), false);
  const card = ytRules.anchors.filter((a) => a.kind === "card");
  assert.deepEqual(
    card.map((a) => a.selector),
    ["yt-lockup-view-model", "ytm-shorts-lockup-view-model", "ytd-video-renderer", "ytd-compact-video-renderer", "ytd-reel-item-renderer"]
  );
  // 卡片按钮必须常显：hover 预览层会让卡片失去 :hover
  assert.equal(card.every((a) => a.alwaysShow === true), true);
  assert.equal(card[0].idFrom({ querySelectorAll: () => [{ getAttribute: () => "/watch?v=" + ID }] }), ID);
  const shortsCard = card.find((a) => a.selector === "ytm-shorts-lockup-view-model");
  assert.deepEqual(shortsCard.mount, ["yt-thumbnail-view-model", "self"]);
  assert.equal(shortsCard.idFrom({ querySelectorAll: () => [{ getAttribute: () => "/shorts/" + ID }] }), ID);
  // 货架容器带 transform：卡内按钮压不过全局预览层，必须改挂页面级浮层
  assert.equal(shortsCard.overlay, true);
  assert.equal(card.find((a) => a.selector === "ytd-reel-item-renderer").overlay, true);
  assert.equal(card[0].overlay, undefined);
  assert.equal(card[0].idFrom({ querySelectorAll: () => [] }), null);
});

test("youtubeAdapter 走占位挂载 + 现取钩子，长文件落盘", () => {
  assert.deepEqual(youtubeAdapter.sources, []);
  assert.equal(youtubeAdapter.streamToDisk, true);
  assert.equal(typeof youtubeAdapter.loadItem, "function");
  assert.equal(typeof youtubeAdapter.stub, "function");
  assert.equal(typeof youtubeAdapter.resolveDownload, "function");
});
