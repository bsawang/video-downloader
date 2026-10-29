import { test } from "node:test";
import assert from "node:assert/strict";
import { douyinAdapter, fiberToRaw } from "../src/platforms/douyin/adapter.js";
import { scanDomSources } from "../src/kernel/hook.js";
import { createStore } from "../src/kernel/store.js";

const ai = {
  awemeId: "7701655982320979215",
  itemTitle: "标题",
  authorInfo: { nickname: "作者" },
  video: {
    bitRateList: [
      { gearName: "1080_1_1", width: 1920, height: 1080, playAddr: [{ src: "https://cdn/1080-h265" }] },
      { gearName: "normal_1080_0", width: 1920, height: 1080, playAddr: [{ src: "https://cdn/1080" }] },
      { gearName: "normal_720_0", width: 1280, height: 720, playAddr: [{ src: "https://cdn/720" }] },
      { gearName: "low_540_0", width: 1024, height: 576, playAddr: [{ src: "https://cdn/540" }] },
    ],
    playAddr: [{ src: "https://cdn/default" }],
  },
};

test("fiberToRaw 折回接口形状后可被 parse 复用", () => {
  const item = douyinAdapter.parse(fiberToRaw(ai));
  assert.equal(item.videoId, "7701655982320979215");
  assert.equal(item.title, "标题");
  assert.equal(item.author, "作者");
  assert.deepEqual(
    item.streams.map((s) => s.label),
    ["1080p", "720p", "540p"]
  );
  assert.equal(item.streams[0].url, "https://cdn/1080-h265");
});

test("fiberToRaw 无 bitRateList 时回落到 playAddr", () => {
  const raw = fiberToRaw({ awemeId: "1", video: { playAddr: [{ src: "https://cdn/only" }] } });
  const item = douyinAdapter.parse(raw);
  assert.deepEqual(item.streams, [{ label: "默认", url: "https://cdn/only" }]);
});

test("scanDomSources 写入仓库，streams 未变时不重复通知", () => {
  const store = createStore();
  let changes = 0;
  store.onChange(() => changes++);
  const adapter = { domSources: [{ id: "x", scan: () => [douyinAdapter.parse(fiberToRaw(ai))] }] };
  scanDomSources(adapter, store);
  assert.equal(store.size, 1);
  assert.equal(changes, 1);
  scanDomSources(adapter, store);
  assert.equal(changes, 1);
});

test("scanDomSources 单个源抛错不影响其他源", () => {
  const store = createStore();
  const adapter = {
    domSources: [
      { id: "bad", scan: () => { throw new Error("boom"); } },
      { id: "good", scan: () => [douyinAdapter.parse(fiberToRaw(ai))] },
    ],
  };
  scanDomSources(adapter, store);
  assert.equal(store.size, 1);
});

test("douyin-fiber 源从列表卡片读数据", () => {
  const a = { querySelector: () => null };
  a["__reactFiber$1"] = { memoizedProps: {}, return: { memoizedProps: { awemeInfo: ai }, return: null } };
  const li = { querySelector: (sel) => (sel === "a" ? a : null) };
  const root = { querySelectorAll: () => [li] };
  const src = douyinAdapter.domSources.find((s) => s.id === "douyin-fiber");
  const items = src.scan(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].videoId, "7701655982320979215");
  assert.equal(items[0].streams.length, 3);
});
