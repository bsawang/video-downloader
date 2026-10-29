import { test } from "node:test";
import assert from "node:assert/strict";
import { createDownloader } from "../src/kernel/download.js";

function stubDom() {
  const clicked = [];
  globalThis.document = {
    createElement: (tag) => ({
      tag,
      href: "",
      download: "",
      click() {
        clicked.push({ tag, href: this.href, download: this.download });
      },
      remove() {},
    }),
    body: { appendChild() {} },
  };
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => ({ unref() {} });
  return {
    clicked,
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      delete globalThis.document;
    },
  };
}

function bodyOf(chunks) {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(new Uint8Array(chunk));
      c.close();
    },
  });
}

test("下载：omit credentials + 文件名 + 进度 + 完成提示", async () => {
  const dom = stubDom();
  const toasts = [];
  const calls = [];
  const nativeFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "8", "content-type": "video/mp4" }),
      body: bodyOf([[1, 2, 3, 4], [5, 6, 7, 8]]),
    };
  };
  try {
    const download = createDownloader({ nativeFetch, toast: (m) => toasts.push(m) });
    const ok = await download({ url: "https://cdn.example/v.mp4", credentials: "omit", filename: "a_b_1080p.mp4" });
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.credentials, "omit");
    assert.ok(toasts.includes("下载中 50%"), "progress 回调至少触发一次");
    assert.equal(toasts.at(-1), "✓ 下载完成");
    assert.equal(dom.clicked.length, 1);
    assert.equal(dom.clicked[0].download, "a_b_1080p.mp4");
    assert.match(dom.clicked[0].href, /^blob:/);
  } finally {
    dom.restore();
  }
});

test("下载：非 2xx 提示 HTTP 状态码", async () => {
  const dom = stubDom();
  const toasts = [];
  const nativeFetch = async () => ({ ok: false, status: 404, headers: new Headers() });
  try {
    const download = createDownloader({ nativeFetch, toast: (m) => toasts.push(m) });
    const ok = await download({ url: "https://cdn.example/v.mp4", filename: "x.mp4" });
    assert.equal(ok, false);
    assert.equal(toasts.at(-1), "✗ 下载失败：HTTP 404");
    assert.equal(dom.clicked.length, 0);
  } finally {
    dom.restore();
  }
});

test("下载：网络异常落入失败提示", async () => {
  const dom = stubDom();
  const toasts = [];
  const nativeFetch = async () => {
    throw new Error("CORS blocked");
  };
  try {
    const download = createDownloader({ nativeFetch, toast: (m) => toasts.push(m) });
    const ok = await download({ url: "https://cdn.example/v.mp4", filename: "x.mp4" });
    assert.equal(ok, false);
    assert.match(toasts.at(-1), /^✗ 下载失败：/);
  } finally {
    dom.restore();
  }
});
