import { test } from "node:test";
import assert from "node:assert/strict";
import { readFiberAwemeId, rules } from "../src/platforms/douyin/rules.js";

function elWithFiber(chain) {
  const a = { querySelector: () => null };
  a["__reactFiber$abc123"] = chain;
  return { querySelector: (sel) => (sel === "a" ? a : null), a };
}

test("readFiberAwemeId 从祖先 fiber 的 memoizedProps 取 awemeId", () => {
  const el = elWithFiber({
    memoizedProps: {},
    return: { memoizedProps: { awemeInfo: { awemeId: "7701655982320979215" } }, return: null },
  });
  assert.equal(readFiberAwemeId(el), "7701655982320979215");
});

test("readFiberAwemeId 无 fiber 返回 null", () => {
  const el = { querySelector: () => null };
  assert.equal(readFiberAwemeId(el), null);
});

test("readFiberAwemeId 链路里没有 awemeInfo 返回 null", () => {
  const el = elWithFiber({ memoizedProps: {}, return: { memoizedProps: {}, return: null } });
  assert.equal(readFiberAwemeId(el), null);
});

test("作者作品列表锚点使用函数式 idFrom", () => {
  const rule = rules.anchors.find((r) => r.selector === '[data-e2e="author-card-list"] li');
  assert.ok(rule, "缺少 author-card-list 规则");
  assert.equal(typeof rule.idFrom, "function");
  assert.deepEqual(rule.mount, ["self"]);
});

test("详情弹层规则优先挂到播放器盒子，self 排最后", () => {
  const rule = rules.anchors.find((r) => r.selector === '[class*="video_"]');
  assert.ok(rule, "缺少 video_ 详情规则");
  assert.ok(
    rule.mount.indexOf(".basePlayerContainer") < rule.mount.indexOf("self"),
    "播放器容器必须排在 self 之前，否则右侧面板展开后按钮不跟随"
  );
});
