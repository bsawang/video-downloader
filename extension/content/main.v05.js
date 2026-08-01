// 页面世界脚本（world: MAIN）v0.5。
// 通用视频提取：hook 所有 fetch/XHR 响应，不管什么接口（搜索/推荐流/详情/feed），
// 只要响应文本里含 video.bit_rate 的视频条目就递归提取；同时解析 SSR 的 RENDER_DATA。
// 提取结果精简后转发隔离世界（aweme_id → 标题/作者/多清晰度直链）；负责下载（fetch→blob→a download）。
// 相比 v0.4.2：不再挑 URL（不限于含 aweme），响应用 text() 逐行解析（兼容流式帧 general/search），
// 提取逻辑通用递归（不限 aweme_detail/aweme_list 等固定 key）。
(() => {
  console.log("[dy-dl] main v0.5.0");
  const MSG = "DY_EXT_MESSAGE";
  const origFetch = window.fetch;
  const DEBUG = true;
  const log = (...a) => DEBUG && console.log("[dy-dl:main]", ...a);

  function notify(payload) {
    window.postMessage({ type: MSG, payload }, "*");
  }

  // ---- 通用视频提取：从任意响应文本（JSON / JSONL / 流式帧）递归找含 video.bit_rate 的条目 ----
  function extractFromText(text) {
    const items = [];
    const seen = new Set();
    const collect = (o, depth) => {
      if (!o || typeof o !== "object" || depth > 40) return;
      if (o.aweme_id && o.video && o.video.bit_rate && o.video.bit_rate.length) {
        const id = String(o.aweme_id);
        if (!seen.has(id)) {
          seen.add(id);
          items.push(o);
        }
        return;
      }
      if (o.aweme_detail) {
        collect(o.aweme_detail, depth + 1);
        return;
      }
      for (const k in o) {
        const v = o[k];
        if (v && typeof v === "object") collect(v, depth + 1);
      }
    };
    // 流式帧 / JSONL：逐行尝试（general/search 返回 <hex长度>\n<JSON> 帧）
    for (const line of String(text).split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        collect(JSON.parse(t), 0);
      } catch (e) {}
    }
    // 普通 JSON 整体
    try {
      collect(JSON.parse(text), 0);
    } catch (e) {}
    return items;
  }

  // ---- 精简 streams：过滤 adapt/pay/hdr 特殊流，标准化清晰度标签 ----
  function normalizeStreams(video) {
    const out = [];
    const seen = new Set();
    for (const br of (video && video.bit_rate) || []) {
      const pa = br.play_addr || {};
      const urls = pa.url_list || [];
      if (!urls.length) continue;
      const gear = String(br.gear_name || "");
      const m = gear.match(/(\d{3,4})/);
      let label;
      if (m) {
        label = m[1] + "p";
      } else {
        const low = gear.toLowerCase();
        if (low.includes("adapt") || low.includes("pay_") || low.includes("hdr")) continue;
        label = gear || "默认";
      }
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({ label, url: urls[0] });
    }
    if (!out.length) {
      const pa = (video && video.play_addr) || {};
      const ul = pa.url_list || [];
      if (ul.length) out.push({ label: "默认", url: ul[0] });
    }
    return out;
  }

  // 精简候选（避免 postMessage 塞大量完整对象），只留隔离世界需要的
  function simplify(items) {
    const list = [];
    for (const c of items) {
      const streams = normalizeStreams(c.video);
      if (!streams.length) continue;
      list.push({
        aweme_id: String(c.aweme_id),
        title: c.desc || "",
        author: (c.author && c.author.nickname) || "",
        streams,
      });
    }
    return list;
  }

  function notifyCandidates(items) {
    const list = simplify(items);
    if (list.length) {
      log("video candidates:", list.length, "ids:", list.map((c) => c.aweme_id).slice(0, 8).join(","));
      notify({ kind: "video_candidates", candidates: list });
    }
  }

  // ---- hook fetch：所有响应都尝试提取（不挑接口）----
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const body = await resp.clone().text();
      const list = extractFromText(body);
      if (list.length) notifyCandidates(list);
    } catch (e) {}
    return resp;
  };

  // ---- hook XHR ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__dyUrl = String(url);
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        if (this.responseText) {
          const list = extractFromText(this.responseText);
          if (list.length) notifyCandidates(list);
        }
      } catch (e) {}
    });
    return origSend.apply(this, args);
  };

  // ---- SSR 内嵌数据：script#RENDER_DATA（详情页/单视频的补充数据源） ----
  function parseRenderData() {
    const el = document.querySelector("script#RENDER_DATA");
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      try {
        return JSON.parse(decodeURIComponent(el.textContent));
      } catch (e2) {
        return null;
      }
    }
  }
  function scanRenderData() {
    const data = parseRenderData();
    if (!data) return;
    const list = extractFromText(JSON.stringify(data));
    if (list.length) notifyCandidates(list);
  }

  // 兜底：performance 里最近一次播放的视频直链（无元数据时）
  let lastPerfUrl = null;
  function scanPerfVideo() {
    try {
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.includes("douyinvod") && u.includes("/video/"));
      if (urls.length) {
        const u = urls[urls.length - 1];
        if (u !== lastPerfUrl) {
          lastPerfUrl = u;
          log("fallback video:", u.slice(0, 110));
          notify({ kind: "fallback_video", url: u });
        }
      }
    } catch (e) {}
  }

  setInterval(() => {
    scanRenderData();
    scanPerfVideo();
  }, 2000);
  setTimeout(scanRenderData, 500);

  // ---- 下载（复用 v0.4.2：credentials 必须 omit！）----
  window.addEventListener("message", (ev) => {
    if (
      ev.data &&
      ev.data.type === MSG &&
      ev.data.payload &&
      ev.data.payload.kind === "download_request"
    ) {
      downloadVideo(ev.data.payload);
    }
  });

  async function downloadVideo(req) {
    const { url, filename } = req;
    try {
      const resp = await origFetch(url, { credentials: "omit" });
      if (!resp.ok) {
        notify({ kind: "download_status", ok: false, error: "HTTP " + resp.status });
        return;
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
        if (total) notify({ kind: "download_progress", received, total });
      }
      const blob = new Blob(chunks, {
        type: resp.headers.get("content-type") || "video/mp4",
      });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      notify({ kind: "download_status", ok: true });
    } catch (e) {
      notify({ kind: "download_status", ok: false, error: String(e) });
    }
  }
})();
