// plan 允许是 Promise：长视频平台的清晰度直链要现取（签名会过期），
// 先拿到 Promise 再进下载函数，picker 才能在用户点击的同一次激活里同步弹出。
export function createDownloader({ nativeFetch, toast }) {
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
      // 代理/边节点可能回 206 + 完整 content-length 却只给几个字节，不能当成功
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = plan.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast("✓ 下载完成");
      return true;
    } catch (e) {
      try {
        if (writable) await writable.abort();
      } catch (e2) {}
      toast("✗ 下载失败：" + e);
      return false;
    }
  };
}
