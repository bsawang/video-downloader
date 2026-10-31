import { mergeFmp4Blobs } from "./merge.js";

// 内存回退上限：没有 OPFS 或没有保存对话框时，合并只能整份驻留内存
const MERGE_MEMORY_LIMIT = 512 * 1024 * 1024;

// plan 允许是 Promise：长视频平台的清晰度直链要现取（签名会过期），
// 先拿到 Promise 再进下载函数，picker 才能在用户点击的同一次激活里同步弹出。
export function createDownloader({ nativeFetch, toast, opfs }) {
  function tempRoot() {
    if (opfs !== undefined) return Promise.resolve(opfs);
    const nav = globalThis.navigator;
    if (!nav || !nav.storage || typeof nav.storage.getDirectory !== "function") {
      return Promise.resolve(null);
    }
    return nav.storage.getDirectory().catch(() => null);
  }

  async function opfsSink(root, name) {
    const handle = await root.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    return {
      async write(chunk) {
        await writer.write(chunk);
      },
      async close() {
        await writer.close();
      },
      async abort() {
        try {
          await writer.abort();
        } catch (e) {}
      },
      async file() {
        return handle.getFile();
      },
      async remove() {
        try {
          await root.removeEntry(name);
        } catch (e) {}
      },
    };
  }

  function memorySink(budget) {
    const chunks = [];
    return {
      async write(chunk) {
        budget.bytes += chunk.length;
        if (budget.bytes > MERGE_MEMORY_LIMIT) {
          throw new Error("当前浏览器不支持大文件合并下载");
        }
        chunks.push(chunk);
      },
      async close() {},
      async abort() {
        chunks.length = 0;
      },
      file() {
        return new Blob(chunks);
      },
      async remove() {},
    };
  }

  async function fetchToSink(part, sink, label) {
    const resp = await nativeFetch(part.url, {
      credentials: part.credentials || "omit",
      headers: part.headers,
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const total = parseInt(resp.headers.get("content-length") || "0", 10) || 0;
    const reader = resp.body.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await sink.write(value);
      received += value.length;
      if (total) toast("下载" + label + " " + Math.round((received / total) * 100) + "%");
    }
    // 代理/边节点可能回 206 + 完整 content-length 却只给几个字节，不能当成功
    if (total && received < total) {
      throw new Error("数据不完整（" + received + "/" + total + " 字节）");
    }
    return received;
  }

  async function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function runSingle(plan, writable) {
    const resp = await nativeFetch(plan.url, {
      credentials: plan.credentials || "omit",
      headers: plan.headers,
    });
    if (!resp.ok) {
      if (writable) await writable.abort();
      toast("✗ 下载失败：HTTP " + resp.status);
      return false;
    }
    const total = parseInt(resp.headers.get("content-length") || "0", 10) || 0;
    const reader = resp.body.getReader();
    const chunks = writable ? null : [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (writable) await writable.write(value);
      else chunks.push(value);
      received += value.length;
      if (total) toast("下载中 " + Math.round((received / total) * 100) + "%");
    }
    if (total && received < total) {
      if (writable) await writable.abort();
      toast("✗ 下载失败：数据不完整（" + received + "/" + total + " 字节）");
      return false;
    }
    if (writable) {
      await writable.close();
      toast("✓ 下载完成");
      return true;
    }
    const blob = new Blob(chunks, { type: resp.headers.get("content-type") || "video/mp4" });
    await saveBlob(blob, plan.filename);
    toast("✓ 下载完成");
    return true;
  }

  async function runMerged(plan, writable, opts) {
    if (!plan.parts || plan.parts.length < 2) throw new Error("合并计划缺少两路直链");
    const root = await tempRoot();
    const id = "dl-merge-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    let videoSink = null;
    let audioSink = null;
    let output = writable;
    let memoryOutput = null;
    try {
      if (root) {
        try {
          videoSink = await opfsSink(root, id + "-v");
          audioSink = await opfsSink(root, id + "-a");
        } catch (e) {
          // 第二个临时文件创建失败时，第一个可能已经开好写入器，先释放再删
          if (videoSink) await videoSink.abort();
          if (audioSink) await audioSink.abort();
          videoSink = null;
          audioSink = null;
          for (const name of [id + "-v", id + "-a"]) {
            try {
              await root.removeEntry(name);
            } catch (e2) {}
          }
        }
      }
      if (!videoSink) {
        // 两路输入共用一个预算：分开各算 512 MiB 会放行合计超限的任务
        const inputBudget = { bytes: 0 };
        videoSink = memorySink(inputBudget);
        audioSink = memorySink(inputBudget);
      }
      if (!output) {
        memoryOutput = memorySink({ bytes: 0 });
        output = memoryOutput;
      }

      await fetchToSink(plan.parts[0], videoSink, "画面");
      await videoSink.close();
      await fetchToSink(plan.parts[1], audioSink, "音轨");
      await audioSink.close();

      const videoFile = await videoSink.file();
      const audioFile = await audioSink.file();
      try {
        await mergeFmp4Blobs(videoFile, audioFile, output, (p) => toast("合并中 " + p + "%"));
      } catch (e) {
        e.mergeFailed = true;
        throw e;
      }
      if (writable) {
        await writable.close();
      } else {
        await saveBlob(memoryOutput.file(), plan.filename || opts.suggestedName);
      }
      toast("✓ 下载完成（已合并）");
      return true;
    } catch (e) {
      try {
        if (writable) await writable.abort();
        else if (memoryOutput) await memoryOutput.abort();
      } catch (e2) {}
      toast((e && e.mergeFailed ? "✗ 合并失败：" : "✗ 下载失败：") + (e && e.message ? e.message : e));
      return false;
    } finally {
      // 下载中途失败时写入器还开着，不 abort 会锁住临时文件、removeEntry 静默失败
      if (videoSink) {
        await videoSink.abort();
        await videoSink.remove();
      }
      if (audioSink) {
        await audioSink.abort();
        await audioSink.remove();
      }
    }
  }

  return async function download(planOrPromise, opts = {}) {
    let writable = null;
    if (opts.streamToDisk && typeof globalThis.showSaveFilePicker === "function") {
      try {
        const pickerOpts = opts.suggestedName ? { suggestedName: opts.suggestedName } : {};
        const handle = await globalThis.showSaveFilePicker(pickerOpts);
        writable = await handle.createWritable();
      } catch (e) {
        if (e && e.name === "AbortError") {
          toast("已取消下载");
          return false;
        }
      }
    }
    try {
      const plan = await planOrPromise;
      if (!plan) return false;
      if (plan.merge === "fmp4" && Array.isArray(plan.parts)) {
        return await runMerged(plan, writable, opts);
      }
      return await runSingle(plan, writable);
    } catch (e) {
      try {
        if (writable) await writable.abort();
      } catch (e2) {}
      toast("✗ 下载失败：" + e);
      return false;
    }
  };
}
