import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { collect, parseLooseJSON, normalizeQuality, sortStreams } from "../src/kernel/extract.js";
import { douyinAdapter } from "../src/platforms/douyin/adapter.js";
import { sources } from "../src/platforms/douyin/rules.js";
import { legacyExtract, legacySimplify } from "./fixtures/legacy.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const networkSource = sources[0];

function project(list) {
  return list.map((i) => ({
    videoId: i.videoId,
    title: i.title,
    author: i.author,
    streams: i.streams,
  }));
}

function legacyProject(list) {
  return list.map((i) => ({
    videoId: i.aweme_id,
    title: i.title,
    author: i.author,
    streams: i.streams,
  }));
}

for (const name of ["detail.json", "feed.json", "search-stream.txt"]) {
  test(`oracle 等价: ${name}`, () => {
    const text = fixture(name);
    const expected = legacyProject(legacySimplify(legacyExtract(text)));
    const actual = project(collect(text, networkSource, douyinAdapter));
    assert.deepEqual(actual, expected);
  });
}

test("parseLooseJSON 处理流式帧与整体 JSON", () => {
  assert.equal(parseLooseJSON(fixture("search-stream.txt")).length, 2);
  assert.equal(parseLooseJSON(fixture("detail.json")).length, 2);
});

test("normalizeQuality 与旧实现同序判定", () => {
  assert.equal(normalizeQuality("normal_1080_0"), "1080p");
  assert.equal(normalizeQuality("adapt_lowest_4_1"), null);
  assert.equal(normalizeQuality("pay_bvc1_hdr_1080_0"), "1080p");
  assert.equal(normalizeQuality(""), "默认");
  assert.equal(normalizeQuality("normal_1080_0", { normal_1080_0: "1080p 高清" }), "1080p 高清");
});

test("sortStreams 按清晰度降序", () => {
  const sorted = sortStreams([
    { label: "540p", url: "c" },
    { label: "1080p", url: "a" },
    { label: "720p", url: "b" },
  ]);
  assert.deepEqual(sorted.map((s) => s.label), ["1080p", "720p", "540p"]);
});
