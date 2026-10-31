import { test } from "node:test";
import assert from "node:assert/strict";
import { createDownloader } from "../src/kernel/download.js";
import { parseBoxes } from "../src/kernel/merge.js";

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

// —— 合成 fMP4（box 结构与 merge.test.mjs 相同，够合并器解析即可）——
function cat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function box(type, body) {
  const payload = Uint8Array.from(body);
  const out = new Uint8Array(8 + payload.length);
  out.set([(out.length >>> 24) & 255, (out.length >>> 16) & 255, (out.length >>> 8) & 255, out.length & 255], 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function fullBox(type, body) {
  return box(type, cat([0, 0, 0, 0], body));
}

function mdat(bytes) {
  return box("mdat", bytes);
}

function u32(v) {
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

function fmp4(trackId, media) {
  const tkhd = fullBox("tkhd", cat(u32(0), u32(0), u32(trackId), new Uint8Array(60)));
  const trak = box("trak", tkhd);
  const trex = fullBox("trex", cat(u32(trackId), new Uint8Array(12)));
  const mvhd = fullBox("mvhd", cat(new Uint8Array(96), u32(2)));
  const moov = box("moov", cat(mvhd, trak, box("mvex", trex)));
  const tfhd = fullBox("tfhd", cat(u32(trackId), new Uint8Array(8)));
  const moof = box("moof", cat(fullBox("mfhd", [0, 0, 0, 1]), box("traf", tfhd)));
  return cat(box("ftyp", [1, 2, 3, 4]), moov, moof, mdat(media));
}

function fakeOpfs({ failOn } = {}) {
  const files = new Map();
  const removed = [];
  const aborted = [];
  return {
    files,
    removed,
    aborted,
    async getFileHandle(name) {
      if (failOn && failOn(name)) throw new Error("opfs open failed");
      if (!files.has(name)) files.set(name, []);
      return {
        async createWritable() {
          return {
            async write(chunk) {
              files.get(name).push(new Uint8Array(chunk));
            },
            async close() {},
            async abort() {
              aborted.push(name);
            },
          };
        },
        async getFile() {
          return new Blob(files.get(name));
        },
      };
    },
    async removeEntry(name) {
      removed.push(name);
      files.delete(name);
    },
  };
}

function fakePicker() {
  const state = { writes: [], aborted: false, closed: false, calls: 0 };
  globalThis.showSaveFilePicker = async () => {
    state.calls++;
    return {
      async createWritable() {
        return {
          async write(chunk) {
            state.writes.push(new Uint8Array(chunk));
          },
          async close() {
            state.closed = true;
          },
          async abort() {
            state.aborted = true;
          },
        };
      },
    };
  };
  state.bytes = () => cat(...state.writes);
  return state;
}

function mergedPlan(videoBody, audioBody) {
  return {
    merge: "fmp4",
    filename: "作者_标题_1080p.mp4",
    parts: [
      { url: "https://cdn/v.mp4", credentials: "omit" },
      { url: "https://cdn/a.m4s", credentials: "omit" },
    ],
  };
}

function mediaFetch(videoBody, audioBody) {
  return async (url) => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": String(url.includes("v.mp4") ? videoBody.length : audioBody.length) }),
    body: bodyOf([videoBody]),
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

// —— M10.2 合并下载 ——

function trackIds(moovBytes) {
  const ids = [];
  for (const trak of parseBoxes(moovBytes).filter((b) => b.type === "trak")) {
    const inner = moovBytes.slice(trak.start + 8, trak.end);
    const tkhd = parseBoxes(inner).find((b) => b.type === "tkhd");
    const at = 8 + 4 + 4 + 4;
    ids.push(new DataView(inner.buffer, inner.byteOffset + at, 4).getUint32(0));
  }
  return ids;
}

function moovOf(bytes) {
  const moov = parseBoxes(bytes).find((b) => b.type === "moov");
  return moov ? bytes.slice(moov.start + 8, moov.end) : null;
}

function restorePicker(prev) {
  if (prev === undefined) delete globalThis.showSaveFilePicker;
  else globalThis.showSaveFilePicker = prev;
}

test("合并下载：一次保存对话框，两路进度，输出单 moov 双 trak，临时文件清理", async () => {
  const dom = stubDom();
  const toasts = [];
  const videoBody = fmp4(1, [1, 2, 3, 4]);
  const audioBody = fmp4(1, [5, 6, 7, 8]);
  const opfs = fakeOpfs();
  const picker = fakePicker();
  try {
    const download = createDownloader({
      nativeFetch: mediaFetch(videoBody, audioBody),
      toast: (m) => toasts.push(m),
      opfs,
    });
    const ok = await download(mergedPlan("v", "a"), {
      streamToDisk: true,
      suggestedName: "作者_标题_1080p.mp4",
    });
    assert.equal(ok, true);
    assert.equal(picker.calls, 1, "只弹一次保存对话框");
    assert.equal(picker.closed, true);
    assert.ok(toasts.includes("下载画面 100%"), "画面进度");
    assert.ok(toasts.includes("下载音轨 100%"), "音轨进度");
    assert.equal(toasts.at(-1), "✓ 下载完成（已合并）");

    const out = picker.bytes();
    const top = parseBoxes(out);
    assert.equal(top.filter((b) => b.type === "moov").length, 1, "只有一个 moov");
    assert.equal(top.filter((b) => b.type === "moof").length, 2, "两路分片都搬过来");
    assert.deepEqual(trackIds(moovOf(out)), [1, 2], "音轨 track_ID 改成 2");
    assert.equal(opfs.removed.length, 2, "两路临时文件都清理");
    assert.equal(opfs.files.size, 0);
    assert.equal(dom.clicked.length, 0, "落盘不走 blob");
  } finally {
    restorePicker();
    dom.restore();
  }
});

test("合并下载：第二路字节不足时中止输出、清理临时文件", async () => {
  const dom = stubDom();
  const toasts = [];
  const videoBody = fmp4(1, [1, 2, 3, 4]);
  const opfs = fakeOpfs();
  const picker = fakePicker();
  const nativeFetch = async (url) => {
    const video = url.includes("v.mp4");
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": video ? String(videoBody.length) : "100" }),
      body: bodyOf([video ? videoBody : [5]]),
    };
  };
  try {
    const download = createDownloader({ nativeFetch, toast: (m) => toasts.push(m), opfs });
    const ok = await download(mergedPlan("v", "a"), { streamToDisk: true });
    assert.equal(ok, false);
    assert.equal(picker.aborted, true, "半成品输出要中止");
    assert.equal(picker.closed, false);
    assert.match(toasts.at(-1), /^✗ 下载失败：数据不完整（1\/100 字节）$/);
    assert.ok(!toasts.includes("✓ 下载完成（已合并）"));
    assert.equal(opfs.removed.length, 2);
    assert.ok(opfs.aborted.some((n) => n.endsWith("-a")), "中途失败要先 abort 写入器再删文件");
  } finally {
    restorePicker();
    dom.restore();
  }
});

test("合并下载：第二个临时文件建不出来时清理已开文件并回落内存", async () => {
  const dom = stubDom();
  const toasts = [];
  const videoBody = fmp4(1, [1, 2, 3, 4]);
  const audioBody = fmp4(1, [5, 6, 7, 8]);
  const opfs = fakeOpfs({ failOn: (name) => name.endsWith("-a") });
  const picker = fakePicker();
  try {
    const download = createDownloader({
      nativeFetch: mediaFetch(videoBody, audioBody),
      toast: (m) => toasts.push(m),
      opfs,
    });
    const ok = await download(mergedPlan("v", "a"), { streamToDisk: true });
    assert.equal(ok, true, "回落内存后仍能合并成功");
    assert.equal(opfs.files.size, 0, "半途建好的临时文件要删掉");
    assert.ok(opfs.removed.some((n) => n.endsWith("-v")));
    assert.equal(toasts.at(-1), "✓ 下载完成（已合并）");
  } finally {
    restorePicker();
    dom.restore();
  }
});

test("合并下载：非分片 MP4 判为合并失败并清理", async () => {
  const dom = stubDom();
  const toasts = [];
  const opfs = fakeOpfs();
  const picker = fakePicker();
  const nativeFetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": "8" }),
    body: bodyOf([[1, 2, 3, 4, 5, 6, 7, 8]]),
  });
  try {
    const download = createDownloader({ nativeFetch, toast: (m) => toasts.push(m), opfs });
    const ok = await download(mergedPlan("v", "a"), { streamToDisk: true });
    assert.equal(ok, false);
    assert.equal(picker.aborted, true);
    assert.match(toasts.at(-1), /^✗ 合并失败：/);
    assert.equal(opfs.removed.length, 2);
  } finally {
    restorePicker();
    dom.restore();
  }
});

test("合并下载：OPFS 不可用时走内存合并", async () => {
  const dom = stubDom();
  const toasts = [];
  const videoBody = fmp4(1, [1, 2, 3, 4]);
  const audioBody = fmp4(1, [5, 6, 7, 8]);
  const picker = fakePicker();
  try {
    const download = createDownloader({
      nativeFetch: mediaFetch(videoBody, audioBody),
      toast: (m) => toasts.push(m),
      opfs: null,
    });
    const ok = await download(mergedPlan("v", "a"), { streamToDisk: true });
    assert.equal(ok, true);
    assert.equal(toasts.at(-1), "✓ 下载完成（已合并）");
    const out = picker.bytes();
    assert.equal(parseBoxes(out).filter((b) => b.type === "moov").length, 1);
    assert.deepEqual(trackIds(moovOf(out)), [1, 2]);
  } finally {
    restorePicker();
    dom.restore();
  }
});

test("合并下载：没有保存对话框时落成 blob", async () => {
  const dom = stubDom();
  const toasts = [];
  const videoBody = fmp4(1, [1, 2, 3, 4]);
  const audioBody = fmp4(1, [5, 6, 7, 8]);
  const prevPicker = globalThis.showSaveFilePicker;
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;
  delete globalThis.showSaveFilePicker;
  URL.createObjectURL = () => "blob:merged";
  URL.revokeObjectURL = () => {};
  try {
    const download = createDownloader({
      nativeFetch: mediaFetch(videoBody, audioBody),
      toast: (m) => toasts.push(m),
      opfs: fakeOpfs(),
    });
    const ok = await download(mergedPlan("v", "a"), { streamToDisk: true });
    assert.equal(ok, true);
    assert.equal(dom.clicked.length, 1);
    assert.equal(dom.clicked[0].download, "作者_标题_1080p.mp4");
    assert.equal(dom.clicked[0].href, "blob:merged");
    assert.equal(toasts.at(-1), "✓ 下载完成（已合并）");
  } finally {
    restorePicker(prevPicker);
    URL.createObjectURL = prevCreate;
    URL.revokeObjectURL = prevRevoke;
    dom.restore();
  }
});

test("合并下载：取消保存对话框不发起请求", async () => {
  const dom = stubDom();
  const toasts = [];
  const opfs = fakeOpfs();
  let fetched = 0;
  const prevPicker = globalThis.showSaveFilePicker;
  globalThis.showSaveFilePicker = async () => {
    const e = new Error("cancelled");
    e.name = "AbortError";
    throw e;
  };
  try {
    const download = createDownloader({
      nativeFetch: async () => {
        fetched++;
        return { ok: true, status: 200, headers: new Headers(), body: bodyOf([]) };
      },
      toast: (m) => toasts.push(m),
      opfs,
    });
    const ok = await download(mergedPlan("v", "a"), { streamToDisk: true });
    assert.equal(ok, false);
    assert.equal(fetched, 0);
    assert.equal(toasts.at(-1), "已取消下载");
    assert.equal(opfs.removed.length, 0, "没下载就不该有临时文件");
  } finally {
    restorePicker(prevPicker);
    dom.restore();
  }
});
