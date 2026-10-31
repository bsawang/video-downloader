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

test("下载：plan 可以是 Promise，流式写盘不建 blob", async () => {
  const dom = stubDom();
  const toasts = [];
  const written = [];
  const prevPicker = globalThis.showSaveFilePicker;
  globalThis.showSaveFilePicker = async () => ({
    createWritable: async () => ({
      write: async (chunk) => {
        for (const b of chunk) written.push(b);
      },
      close: async () => {},
      abort: async () => {},
    }),
  });
  const nativeFetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": "4", "content-type": "video/mp4" }),
    body: bodyOf([[1, 2], [3, 4]]),
  });
  try {
    const download = createDownloader({ nativeFetch, toast: (m) => toasts.push(m) });
    const ok = await download(Promise.resolve({ url: "https://cdn/v", filename: "x.mp4" }), {
      streamToDisk: true,
      suggestedName: "作者_标题_1080P.mp4",
    });
    assert.equal(ok, true);
    assert.deepEqual(written, [1, 2, 3, 4]);
    assert.equal(dom.clicked.length, 0);
    assert.equal(toasts.at(-1), "✓ 下载完成");
  } finally {
    if (prevPicker === undefined) delete globalThis.showSaveFilePicker;
    else globalThis.showSaveFilePicker = prevPicker;
    dom.restore();
  }
});

test("下载：字节数不足 content-length 时判失败并丢弃半成品", async () => {
  const dom = stubDom();
  const toasts = [];
  const state = { aborted: false, closed: false, writes: 0 };
  const prevPicker = globalThis.showSaveFilePicker;
  globalThis.showSaveFilePicker = async () => ({
    createWritable: async () => ({
      write: async () => {
        state.writes++;
      },
      close: async () => {
        state.closed = true;
      },
      abort: async () => {
        state.aborted = true;
      },
    }),
  });
  const nativeFetch = async () => ({
    ok: true,
    status: 206,
    headers: new Headers({ "content-length": "1354370", "content-type": "video/mp4" }),
    body: bodyOf([[1]]),
  });
  try {
    const download = createDownloader({ nativeFetch, toast: (m) => toasts.push(m) });
    const ok = await download(Promise.resolve({ url: "https://cdn/v", filename: "x.mp4" }), { streamToDisk: true });
    assert.equal(ok, false);
    assert.equal(state.writes, 1);
    assert.equal(state.aborted, true);
    assert.equal(state.closed, false);
    assert.match(toasts.at(-1), /^✗ 下载失败：数据不完整（1\/1354370 字节）$/);
    assert.ok(!toasts.includes("✓ 下载完成"));
  } finally {
    if (prevPicker === undefined) delete globalThis.showSaveFilePicker;
    else globalThis.showSaveFilePicker = prevPicker;
    dom.restore();
  }
});

test("下载：用户取消保存对话框不发起请求", async () => {
  const dom = stubDom();
  const toasts = [];
  let fetched = 0;
  const prevPicker = globalThis.showSaveFilePicker;
  globalThis.showSaveFilePicker = async () => {
    const e = new Error("cancelled");
    e.name = "AbortError";
    throw e;
  };
  const nativeFetch = async () => {
    fetched++;
    return { ok: true, status: 200, headers: new Headers(), body: bodyOf([]) };
  };
  try {
    const download = createDownloader({ nativeFetch, toast: (m) => toasts.push(m) });
    const ok = await download(Promise.resolve({ url: "u", filename: "x.mp4" }), { streamToDisk: true });
    assert.equal(ok, false);
    assert.equal(fetched, 0);
    assert.equal(toasts.at(-1), "已取消下载");
  } finally {
    if (prevPicker === undefined) delete globalThis.showSaveFilePicker;
    else globalThis.showSaveFilePicker = prevPicker;
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
