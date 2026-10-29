import { test } from "node:test";
import assert from "node:assert/strict";
import { scan, pickAnchor } from "../src/kernel/mount.js";

globalThis.getComputedStyle = (el) => ({ position: el.style && el.style.position ? el.style.position : "static" });

function stubEl(id, attrs = {}) {
  return {
    id,
    className: attrs.className || "",
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
  };
}

function stubRoot(map) {
  return { querySelectorAll: (sel) => map[sel] || [] };
}

test("scan 支持函数式 idFrom", () => {
  const el = stubEl("x");
  const root = stubRoot({ ".card": [el] });
  const found = scan([{ selector: ".card", idFrom: (e) => (e === el ? "42" : null) }], root);
  assert.equal(found.length, 1);
  assert.equal(found[0].videoId, "42");
  assert.equal(found[0].el, el);
});

test("scan 过滤函数返回 null 的元素", () => {
  const root = stubRoot({ ".card": [stubEl("a"), stubEl("b")] });
  const found = scan([{ selector: ".card", idFrom: () => null }], root);
  assert.equal(found.length, 0);
});

test("scan 同一目标被多条规则命中只取第一条", () => {
  const el = stubEl("dup", { "data-aweme-id": "111" });
  const root = stubRoot({ ".a": [el], ".b": [el] });
  const found = scan(
    [
      { selector: ".a", idFrom: { type: "attr", name: "data-aweme-id" } },
      { selector: ".b", idFrom: () => "222" },
    ],
    root
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].videoId, "111");
});

test("scan 尊重 resolve 指定的挂载目标", () => {
  const outer = stubEl("outer");
  const el = stubEl("inner");
  el.closest = () => outer;
  const root = stubRoot({ ".v": [el] });
  const found = scan([{ selector: ".v", idFrom: () => "7", resolve: (e) => e.closest(".outer") }], root);
  assert.equal(found[0].el, outer);
});

test("pickAnchor self 直接返回自身", () => {
  const el = stubEl("li");
  assert.equal(pickAnchor(el, ["self"]), el);
});

test("pickAnchor 选播放器容器而不是宽容器", () => {
  const base = stubEl("base");
  base.style = { position: "relative" };
  const el = stubEl("wrap");
  el.querySelector = (sel) => (sel === ".basePlayerContainer" ? base : null);
  const mounts = [".videoImage", ".douyin-player-video-container", ".basePlayerContainer", "self"];
  assert.equal(pickAnchor(el, mounts), base);
});
