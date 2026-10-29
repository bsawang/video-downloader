export function createDownloader({ nativeFetch, toast }) {
  return async function download(plan) {
    try {
      const resp = await nativeFetch(plan.url, {
        credentials: plan.credentials || "omit",
        headers: plan.headers,
      });
      if (!resp.ok) {
        toast("✗ 下载失败：HTTP " + resp.status);
        return false;
      }
      const total = parseInt(resp.headers.get("content-length") || "0", 10) || 0;
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total) toast("下载中 " + Math.round((received / total) * 100) + "%");
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
      toast("✗ 下载失败：" + e);
      return false;
    }
  };
}
