import { test } from "node:test";
import assert from "node:assert/strict";
import { readBiliPage } from "../src/platforms/bilibili/rules.js";
import {
  biliFilename,
  biliParsePlayurl,
  biliResolveDownload,
  biliRefresh,
  bilibiliAdapter,
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

test("biliRefresh 每个 cid 只取一次并写入 store", async () => {
  const restore = withState(state);
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      json: async () => ({
        code: 0,
        data: { accept_quality: [64, 16], accept_description: ["高清 720P", "流畅 360P"] },
      }),
    };
  };
  try {
    const store = createStore();
    await biliRefresh(store);
    await biliRefresh(store);
    await biliRefresh(store);
    assert.equal(calls, 1);
    assert.equal(store.get("43140253613").streams.length, 2);
  } finally {
    globalThis.fetch = realFetch;
    restore();
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
