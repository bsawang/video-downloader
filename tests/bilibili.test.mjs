import { test } from "node:test";
import assert from "node:assert/strict";
import { biliCardBvid, biliCardTitle, biliRules, readBiliPage } from "../src/platforms/bilibili/rules.js";
import {
  biliFilename,
  biliLoadCard,
  biliParsePlayurl,
  biliPrefetch,
  biliResolveDownload,
  biliRefresh,
  biliStub,
  bilibiliAdapter,
  buildBiliDashStreams,
  buildBiliStreams,
} from "../src/platforms/bilibili/adapter.js";
import { createStore } from "../src/kernel/store.js";

function withState(state) {
  const prev = globalThis.__INITIAL_STATE__;
  globalThis.__INITIAL_STATE__ = state;
  return () => {
    if (prev === undefined) delete globalThis.__INITIAL_STATE__;
    else globalThis.__INITIAL_STATE__ = prev;
  };
}

const state = {
  bvid: "BV1JYsd6sE4k",
  cid: 43140253613,
  p: 3,
  videoData: {
    bvid: "BV1JYsd6sE4k",
    cid: 43140187661,
    title: "千星纪游PV",
    owner: { name: "崩坏星穹铁道" },
    pages: [
      { page: 1, cid: 43140187661, part: "中" },
      { page: 2, cid: 43140252346, part: "日" },
      { page: 3, cid: 43140253613, part: "英" },
    ],
  },
};

test("readBiliPage 取当前分P（不是 videoData.cid）", () => {
  const restore = withState(state);
  try {
    const page = readBiliPage({ search: "?p=3" });
    assert.equal(page.cid, "43140253613");
    assert.equal(page.page, 3);
    assert.equal(page.part, "英");
    assert.equal(page.pageCount, 3);
    assert.equal(page.title, "千星纪游PV");
    assert.equal(page.author, "崩坏星穹铁道");
  } finally {
    restore();
  }
});

test("readBiliPage 缺 s.p 时用 URL 的 p 定位", () => {
  const restore = withState({ ...state, p: undefined, cid: undefined });
  try {
    assert.equal(readBiliPage({ search: "?p=2" }).cid, "43140252346");
  } finally {
    restore();
  }
});

test("readBiliPage 非视频页返回 null", () => {
  const restore = withState(undefined);
  try {
    assert.equal(readBiliPage({ search: "" }), null);
  } finally {
    restore();
  }
});

test("buildBiliStreams 用 accept 列表并按清晰度降序", () => {
  const streams = buildBiliStreams({
    accept_quality: [16, 80, 64],
    accept_description: ["流畅 360P", "高清 1080P", "高清 720P"],
  });
  assert.deepEqual(streams, [
    { label: "高清 1080P", qn: 80 },
    { label: "高清 720P", qn: 64 },
    { label: "流畅 360P", qn: 16 },
  ]);
});

test("biliParsePlayurl 产出中性条目（videoId=cid）", () => {
  const item = biliParsePlayurl(
    { accept_quality: [64, 16], accept_description: ["高清 720P", "流畅 360P"] },
    { bvid: "BV1xx", cid: "123", page: 1, pageCount: 1, title: "t", author: "a", part: "" }
  );
  assert.equal(item.videoId, "123");
  assert.equal(item.bvid, "BV1xx");
  assert.equal(item.streams.length, 2);
  assert.equal(item.streams[0].label, "高清 720P");
  assert.equal(item.streams[0].qn, 64);
});

test("biliFilename 多P带 P 号与分P名并去非法字符", () => {
  const item = { author: "up", title: "a/b:c", page: 3, pageCount: 3, part: "英" };
  const name = biliFilename(item, { label: "高清 720P" });
  assert.equal(name, "up_a_b_c_P3 英_高清 720P.mp4");
});

test("biliResolveDownload 现取 durl 并带单文件直链", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      json: async () => ({
        code: 0,
        data: { durl: [{ order: 1, url: "https://cdn.example/v.mp4?e=x" }] },
      }),
    };
  };
  try {
    const plan = await biliResolveDownload(
      { bvid: "BV1xx", cid: "123", author: "up", title: "t", page: 1, pageCount: 1, part: "" },
      { label: "高清 720P", qn: 64 }
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /bvid=BV1xx/);
    assert.match(calls[0].url, /cid=123/);
    assert.match(calls[0].url, /fnval=1/);
    assert.match(calls[0].url, /qn=64/);
    assert.equal(calls[0].init.credentials, "include");
    assert.equal(plan.url, "https://cdn.example/v.mp4?e=x");
    assert.equal(plan.credentials, "omit");
    assert.equal(plan.filename, "up_t_高清 720P.mp4");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("biliResolveDownload 分段视频直接拒绝", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    json: async () => ({ code: 0, data: { durl: [{ url: "a" }, { url: "b" }] } }),
  });
  try {
    await assert.rejects(
      () => biliResolveDownload({ bvid: "BV1", cid: "1" }, { label: "720P", qn: 64 }),
      /分段视频暂不支持/
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("biliRefresh 每个 cid 只取一次（单文件 + DASH 两路）并写入 store", async () => {
  const restore = withState(state);
  const realFetch = globalThis.fetch;
  const calls = [];
  const json = (data) => ({ json: async () => ({ code: 0, data }) });
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("fnval=4048")) {
      return json({
        accept_quality: [80, 64, 16],
        accept_description: ["高清 1080P", "高清 720P", "流畅 360P"],
        dash: {
          video: [{ id: 80, codecid: 7, bandwidth: 2000, baseUrl: "https://cdn/v.m4s" }],
          audio: [{ id: 30280, bandwidth: 192000, baseUrl: "https://cdn/a.m4s" }],
        },
      });
    }
    return json({ accept_quality: [64, 16], accept_description: ["高清 720P", "流畅 360P"] });
  };
  try {
    const store = createStore();
    await biliRefresh(store);
    await biliRefresh(store);
    await biliRefresh(store);
    assert.equal(calls.length, 2);
    assert.equal(store.get("43140253613").streams.length, 4);
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});

test("buildBiliDashStreams 只补单文件拿不到的高档位，并拆画面/音频", () => {
  const durl = { accept_quality: [64, 16], accept_description: ["高清 720P", "流畅 360P"] };
  const dash = {
    accept_quality: [112, 80, 64, 32, 16],
    accept_description: ["高清 1080P+", "高清 1080P", "高清 720P", "清晰 480P", "流畅 360P"],
    dash: {
      video: [
        { id: 80, codecid: 12, bandwidth: 3000, baseUrl: "hevc" },
        { id: 80, codecid: 7, bandwidth: 2000, baseUrl: "avc" },
        { id: 64, codecid: 7, bandwidth: 1000, baseUrl: "720" },
        { id: 32, codecid: 7, bandwidth: 500, baseUrl: "480" },
      ],
      audio: [
        { id: 30216, bandwidth: 64000, baseUrl: "a64" },
        { id: 30280, bandwidth: 192000, baseUrl: "a192" },
      ],
    },
  };
  assert.deepEqual(buildBiliDashStreams(durl, dash), [
    { label: "高清 1080P 画面（无音轨）", qn: 80, kind: "video" },
    { label: "高清 1080P 音频", qn: 80, kind: "audio" },
  ]);
});

test("buildBiliDashStreams 单文件已有 1080P 时不重复补", () => {
  const durl = { accept_quality: [80, 64, 16], accept_description: ["高清 1080P", "高清 720P", "流畅 360P"] };
  const dash = {
    accept_quality: [112, 80, 64, 16],
    accept_description: ["高清 1080P+", "高清 1080P", "高清 720P", "流畅 360P"],
    dash: {
      video: [
        { id: 112, codecid: 7, bandwidth: 9000, baseUrl: "1080p-plus" },
        { id: 80, codecid: 7, bandwidth: 2000, baseUrl: "1080" },
      ],
      audio: [{ id: 30280, bandwidth: 192000, baseUrl: "a" }],
    },
  };
  assert.deepEqual(buildBiliDashStreams(durl, dash), [
    { label: "高清 1080P+ 画面（无音轨）", qn: 112, kind: "video" },
    { label: "高清 1080P+ 音频", qn: 112, kind: "audio" },
  ]);
});

test("biliParsePlayurl 合并 DASH 档位并按清晰度排序", () => {
  const item = biliParsePlayurl(
    { accept_quality: [64, 16], accept_description: ["高清 720P", "流畅 360P"] },
    { bvid: "BV1", cid: "1", page: 1, pageCount: 1, title: "t", author: "a" },
    {
      accept_quality: [80, 64, 16],
      accept_description: ["高清 1080P", "高清 720P", "流畅 360P"],
      dash: {
        video: [{ id: 80, codecid: 7, bandwidth: 2000, baseUrl: "v" }],
        audio: [{ id: 30280, bandwidth: 192000, baseUrl: "a" }],
      },
    }
  );
  assert.deepEqual(item.streams.map((s) => s.label), [
    "高清 1080P 画面（无音轨）",
    "高清 1080P 音频",
    "高清 720P",
    "流畅 360P",
  ]);
});

test("biliResolveDownload 分离视频流选 AVC 并现取 baseUrl", async () => {
  const realFetch = globalThis.fetch;
  let seen = "";
  globalThis.fetch = async (url) => {
    seen = String(url);
    return {
      json: async () => ({
        code: 0,
        data: {
          dash: {
            video: [
              { id: 80, codecid: 12, bandwidth: 3000, baseUrl: "https://cdn/hevc.m4s" },
              { id: 80, codecid: 7, bandwidth: 2000, baseUrl: "https://cdn/avc.m4s" },
            ],
            audio: [{ id: 30280, bandwidth: 192000, baseUrl: "https://cdn/a.m4s" }],
          },
        },
      }),
    };
  };
  try {
    const plan = await biliResolveDownload(
      { bvid: "BV1", cid: "1", author: "up", title: "t", page: 1, pageCount: 1, part: "" },
      { label: "高清 1080P 画面（无音轨）", qn: 80, kind: "video" }
    );
    assert.match(seen, /fnval=4048/);
    assert.match(seen, /qn=80/);
    assert.equal(plan.url, "https://cdn/avc.m4s");
    assert.equal(plan.credentials, "omit");
    assert.equal(plan.filename, "up_t_高清 1080P 画面（无音轨）.mp4");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("biliResolveDownload 分离音频取标准 AAC 最高码率并落 .m4a", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    json: async () => ({
      code: 0,
      data: {
        dash: {
          video: [{ id: 80, codecid: 7, bandwidth: 2000, baseUrl: "v" }],
          audio: [
            { id: 30216, bandwidth: 64000, baseUrl: "https://cdn/a64.m4s" },
            { id: 30280, bandwidth: 192000, baseUrl: "https://cdn/a192.m4s" },
            { id: 30250, bandwidth: 999000, baseUrl: "https://cdn/dolby.m4s" },
          ],
        },
      },
    }),
  });
  try {
    const plan = await biliResolveDownload(
      { bvid: "BV1", cid: "1", author: "up", title: "t", page: 1, pageCount: 1, part: "" },
      { label: "高清 1080P 音频", qn: 80, kind: "audio" }
    );
    assert.equal(plan.url, "https://cdn/a192.m4s");
    assert.equal(plan.filename, "up_t_高清 1080P 音频.m4a");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("biliResolveDownload 分离流缺对应档位时报不可用", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => ({ code: 0, data: { dash: { video: [], audio: [] } } }) });
  try {
    await assert.rejects(
      () => biliResolveDownload({ bvid: "BV1", cid: "1" }, { label: "1080P", qn: 80, kind: "video" }),
      /该清晰度不可用/
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("bilibiliAdapter 走单文件 + 落盘，且不带 SSR/perf 源", () => {
  assert.equal(bilibiliAdapter.streamToDisk, true);
  assert.equal(bilibiliAdapter.ssrSelector, null);
  assert.equal(bilibiliAdapter.perfPattern, null);
  assert.deepEqual(bilibiliAdapter.sources, []);
  assert.equal(typeof bilibiliAdapter.filename, "function");
  assert.equal(typeof bilibiliAdapter.refresh, "function");
});

// ---- 卡片页（首页/热门/排行/搜索）：只有 bvid，cid 与档位现查 ----

function fakeCard(html) {
  return {
    querySelector(sel) {
      if (sel.includes("a[href")) {
        return html.href ? { getAttribute: () => html.href } : null;
      }
      return html[sel] ? { textContent: html[sel] } : null;
    },
  };
}

test("biliCardBvid 从卡片链接取 bvid（协议相对/带参数）", () => {
  assert.equal(biliCardBvid(fakeCard({ href: "//www.bilibili.com/video/BV1m9HG6gEQm?trackid=x" })), "BV1m9HG6gEQm");
  assert.equal(biliCardBvid(fakeCard({ href: "https://www.bilibili.com/video/BV1JYsd6sE4k/" })), "BV1JYsd6sE4k");
  assert.equal(biliCardBvid(fakeCard({})), null);
  assert.equal(biliCardBvid(null), null);
});

test("biliCardTitle 依次尝试首页/热门/排行标题选择器", () => {
  assert.equal(biliCardTitle(fakeCard({ ".bili-video-card__info--tit": " 首页标题 " })), "首页标题");
  assert.equal(biliCardTitle(fakeCard({ ".video-card__info-title": "热门标题" })), "热门标题");
  assert.equal(biliCardTitle(fakeCard({ ".title": "排行标题" })), "排行标题");
  assert.equal(biliCardTitle(fakeCard({})), "");
});

test("biliRules 覆盖卡片页：www 全站 + 搜索站，四条卡片规则", () => {
  assert.deepEqual(biliRules.matches, ["*://www.bilibili.com/*", "*://search.bilibili.com/*"]);
  const kinds = biliRules.anchors.map((a) => a.kind);
  assert.deepEqual(kinds, ["detail", "card", "card", "card", "card"]);
  const cardSel = biliRules.anchors.filter((a) => a.kind === "card").map((a) => a.selector);
  assert.deepEqual(cardSel, [
    ".bili-video-card",
    ".video-card",
    ".rank-item",
    ".video-page-card-small",
  ]);
  // 卡片按钮让开右上角站内控件
  assert.ok(biliRules.anchors.filter((a) => a.kind === "card").every((a) => a.iconRight === 44));
});

function mockCardApi({ viewCode = 0 } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/web-interface/view")) {
      return {
        json: async () =>
          viewCode === 0
            ? {
                code: 0,
                data: {
                  title: "卡片标题",
                  owner: { name: "卡片UP" },
                  pages: [
                    { page: 1, cid: 999, part: "P1" },
                    { page: 2, cid: 1000, part: "P2" },
                  ],
                },
              }
            : { code: -404, message: "啥都木有" },
      };
    }
    if (String(url).includes("fnval=4048")) {
      return {
        json: async () => ({
          code: 0,
          data: {
            accept_quality: [80, 64, 16],
            accept_description: ["高清 1080P", "高清 720P", "流畅 360P"],
            dash: {
              video: [{ id: 80, codecid: 7, bandwidth: 3000, baseUrl: "https://cdn/v80" }],
              audio: [{ id: 30280, bandwidth: 193, baseUrl: "https://cdn/a80" }],
            },
          },
        }),
      };
    }
    return {
      json: async () => ({
        code: 0,
        data: { accept_quality: [64, 16], accept_description: ["高清 720P", "流畅 360P"] },
      }),
    };
  };
  return calls;
}

test("biliLoadCard 依次查 view 与两路 playurl，并写入 store", async () => {
  const realFetch = globalThis.fetch;
  const calls = mockCardApi();
  try {
    const store = createStore();
    const item = await biliLoadCard("BV1card", store);
    assert.equal(calls.length, 3);
    assert.match(calls[0], /web-interface\/view\?bvid=BV1card/);
    assert.match(calls[1], /bvid=BV1card/);
    assert.equal(item.videoId, "BV1card");
    assert.equal(item.cid, "999");
    assert.equal(item.pageCount, 2);
    assert.equal(item.title, "卡片标题");
    assert.equal(item.author, "卡片UP");
    assert.deepEqual(
      item.streams.map((s) => s.label),
      ["高清 1080P 画面（无音轨）", "高清 1080P 音频", "高清 720P", "流畅 360P"]
    );
    assert.equal(store.get("BV1card").streams.length, 4);
    await biliLoadCard("BV1card", store);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("biliLoadCard 并发同一 bvid 只发一轮请求", async () => {
  const realFetch = globalThis.fetch;
  const calls = mockCardApi();
  try {
    const store = createStore();
    await Promise.all([biliLoadCard("BV1card", store), biliLoadCard("BV1card", store)]);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("biliLoadCard 接口失败时报错且允许重试", async () => {
  const realFetch = globalThis.fetch;
  let calls = mockCardApi({ viewCode: -404 });
  try {
    const store = createStore();
    await assert.rejects(() => biliLoadCard("BV1gone", store), /啥都木有/);
    assert.equal(calls.length, 1);
    await assert.rejects(() => biliLoadCard("BV1gone", store), /啥都木有/);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("biliPrefetch 只处理 bvid，不碰详情页的 cid", async () => {
  const realFetch = globalThis.fetch;
  const calls = mockCardApi();
  try {
    const store = createStore();
    biliPrefetch("43140253613", store);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.length, 0);
    biliPrefetch("BV1card", store);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.get("BV1card").streams.length, 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("biliStub 只带 bvid 与 DOM 标题，不带档位", () => {
  const stub = biliStub("BV1card", fakeCard({ ".bili-video-card__info--tit": "占位标题" }));
  assert.equal(stub.videoId, "BV1card");
  assert.equal(stub.title, "占位标题");
  assert.deepEqual(stub.streams, []);
});

test("bilibiliAdapter 暴露卡片页钩子", () => {
  assert.equal(typeof bilibiliAdapter.stub, "function");
  assert.equal(typeof bilibiliAdapter.loadItem, "function");
  assert.equal(typeof bilibiliAdapter.prefetch, "function");
});
