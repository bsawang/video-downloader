import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/kernel/store.js";

const item = (videoId, title) => ({ videoId, title, author: "a", streams: [{ label: "1080p", url: "u" }] });

test("同 id 后到覆盖，size 不变", () => {
  const store = createStore();
  store.upsert(item("1", "旧"));
  store.upsert(item("1", "新"));
  assert.equal(store.size, 1);
  assert.equal(store.get("1").title, "新");
});

test("空 videoId 拒绝写入", () => {
  const store = createStore();
  assert.equal(store.upsert({ videoId: "", title: "x", streams: [] }), null);
  assert.equal(store.size, 0);
});

test("onChange 收到每次写入", () => {
  const store = createStore();
  const seen = [];
  store.onChange((it) => seen.push(it.videoId));
  store.upsert(item("1", "a"));
  store.upsert(item("2", "b"));
  assert.deepEqual(seen, ["1", "2"]);
});
