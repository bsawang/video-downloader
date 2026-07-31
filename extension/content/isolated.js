// 隔离世界脚本。收 main.js 的候选视频消息，按当前 URL 匹配正在看的视频，
// 构建 Shadow DOM 浮层 UI；下载请求转发给 background（chrome.downloads）。
(() => {
  const MSG = "DY_EXT_MESSAGE";
  const ROOT_ID = "dy-downloader-root";
  let root = null;
  let candidates = []; // 原始 aweme 条目
  let current = null; // { videoId, title, author, streams }

  function qualityLabel(gearName) {
    const m = String(gearName || "").match(/(\d{3,4})/);
    return m ? m[1] + "p" : gearName || "未知";
  }

  function sanitize(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, "_").trim();
  }

  function currentIdFromUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get("modal_id")) return q.get("modal_id");
    const m = location.pathname.match(/\/video\/(\d+)/);
    return m ? m[1] : null;
  }

  function pickCurrent() {
    if (!candidates.length) return null;
    const id = currentIdFromUrl();
    if (!id) return null; // 无法确认当前视频，宁可不出按钮也不下载错视频
    return candidates.find((c) => String(c.aweme_id) === id) || null;
  }

  function toInfo(item) {
    if (!item) return null; // pickCurrent 可能返回 null（id 匹配不到候选）
    const video = item.video || {};
    const author = item.author || {};
    const streams = [];
    const seen = new Set();
    for (const br of video.bit_rate || []) {
      const urls = (br.play_addr && br.play_addr.url_list) || [];
      if (!urls.length) continue;
      const label = qualityLabel(br.gear_name);
      if (seen.has(label)) continue;
      seen.add(label);
      streams.push({ label, url: urls[0] });
    }
    if (!streams.length) {
      const urls = (video.play_addr && video.play_addr.url_list) || [];
      if (urls.length) streams.push({ label: "默认", url: urls[0] });
    }
    return {
      videoId: String(item.aweme_id || ""),
      title: item.desc || "（无标题）",
      author: author.nickname || "未知",
      streams,
    };
  }

  function buildUI() {
    if (root) return;
    // document_start 时 documentElement 可能还没解析出来，等 DOM 就绪再建
    if (!document.documentElement) {
      document.addEventListener("DOMContentLoaded", buildUI, { once: true });
      return;
    }
    root = document.createElement("div");
    root.id = ROOT_ID;
    const shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: system-ui, sans-serif; }
        .fab {
          position: fixed; right: 24px; bottom: 24px; z-index: 2147483647;
          background: #2f6bff; color: #fff; border: none; border-radius: 999px;
          padding: 12px 18px; font-size: 14px; cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,.25);
        }
        .panel {
          position: fixed; right: 24px; bottom: 76px; z-index: 2147483647;
          width: 300px; background: #1f2937; color: #f3f4f6;
          border-radius: 12px; padding: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
          display: flex; flex-direction: column; gap: 8px;
        }
        .title { font-weight: 600; font-size: 13px; line-height: 1.4;
          max-height: 40px; overflow: hidden; }
        .author { color: #9ca3af; font-size: 12px; }
        .row { display: flex; gap: 8px; align-items: center; }
        select {
          flex: 1; padding: 6px; border-radius: 6px; border: none;
          background: #374151; color: #f3f4f6; font-size: 13px;
        }
        button.go {
          background: #2f6bff; color: #fff; border: none; border-radius: 6px;
          padding: 7px 14px; font-size: 13px; cursor: pointer;
        }
        .bar-wrap { height: 14px; background: #374151; border-radius: 6px;
          overflow: hidden; position: relative; }
        .bar { height: 100%; width: 0%; background: #2f6bff; transition: width .2s; }
        .pct { position: absolute; right: 6px; top: 0; font-size: 11px; color: #f3f4f6; }
        .err { color: #f87171; font-size: 12px; }
        .hidden { display: none !important; }
      </style>
      <button class="fab">⬇ 下载</button>
      <div class="panel hidden">
        <div class="title"></div>
        <div class="author"></div>
        <div class="row">
          <select class="quality"></select>
          <button class="go">下载</button>
        </div>
        <div class="bar-wrap hidden"><div class="bar"></div><span class="pct"></span></div>
        <div class="err hidden"></div>
      </div>`;
    document.documentElement.appendChild(root);

    const $ = (sel) => shadow.querySelector(sel);
    $(".fab").addEventListener("click", () => {
      const panel = $(".panel");
      const isHidden = panel.classList.contains("hidden");
      if (isHidden && current) {
        panel.classList.remove("hidden");
      } else {
        panel.classList.add("hidden");
      }
    });
    $(".go").addEventListener("click", () => {
      if (!current || !current.streams.length) return;
      const stream = current.streams[$(".quality").selectedIndex];
      const filename =
        sanitize(current.author + "_" + current.title + "_" + stream.label) + ".mp4";
      $(".err").classList.add("hidden");
      $(".bar-wrap").classList.remove("hidden");
      $(".bar").style.width = "0%";
      $(".pct").textContent = "0%";
      window.postMessage(
        { type: MSG, payload: { kind: "download_request", url: stream.url, filename } },
        "*"
      );
    });

    if (current) render();
  }

  function render() {
    const shadow = root.shadowRoot;
    const $ = (sel) => shadow.querySelector(sel);
    $(".fab").classList.remove("hidden");
    $(".title").textContent = current.title;
    $(".author").textContent = "@" + current.author;
    const sel = $(".quality");
    sel.innerHTML = "";
    current.streams.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.url;
      opt.textContent = s.label;
      sel.appendChild(opt);
    });
    $(".bar-wrap").classList.add("hidden");
    $(".err").classList.add("hidden");
  }

  function showError(msg) {
    if (!root) return;
    const shadow = root.shadowRoot;
    const err = shadow.querySelector(".err");
    err.textContent = msg;
    err.classList.remove("hidden");
  }

  function showVideo(info) {
    current = info;
    if (!root) {
      buildUI(); // 若 UI 未建（documentElement 未就绪），建好后会调用 render
      return;
    }
    render();
  }

  function onCandidates(cands) {
    // 累计候选（按 aweme_id 去重），避免被后到的推荐流响应覆盖掉 detail 数据
    for (const c of cands) {
      const cid = String(c.aweme_id);
      if (!candidates.some((x) => String(x.aweme_id) === cid)) candidates.push(c);
    }
    const info = toInfo(pickCurrent());
    if (info && info.videoId) showVideo(info);
    else hideVideo();
  }

  function hideVideo() {
    current = null;
    if (!root) return;
    const shadow = root.shadowRoot;
    shadow.querySelector(".panel").classList.add("hidden");
    shadow.querySelector(".fab").classList.add("hidden");
  }

  // 收页面世界消息（候选 / 下载进度 / 下载状态）
  window.addEventListener("message", (ev) => {
    if (!ev.data || ev.data.type !== MSG) return;
    const p = ev.data.payload;
    if (!p) return;
    if (p.kind === "video_candidates") {
      onCandidates(p.candidates);
    } else if (p.kind === "download_progress" && root) {
      const shadow = root.shadowRoot;
      const pct = p.total ? Math.round((p.received / p.total) * 100) : 0;
      shadow.querySelector(".bar").style.width = pct + "%";
      shadow.querySelector(".pct").textContent = p.total ? pct + "%" : "下载中…";
    } else if (p.kind === "download_status" && root) {
      const shadow = root.shadowRoot;
      if (p.ok) {
        shadow.querySelector(".bar").style.width = "100%";
        shadow.querySelector(".pct").textContent = "完成";
        setTimeout(() => shadow.querySelector(".bar-wrap").classList.add("hidden"), 1500);
      } else {
        shadow.querySelector(".pct").textContent = "失败";
        showError("下载失败：" + (p.error || "未知错误"));
      }
    }
  });

  // 监听 URL 变化（SPA 切换视频）→ 重新匹配当前视频
  let lastId = null;
  setInterval(() => {
    const id = currentIdFromUrl();
    if (id === lastId) return;
    lastId = id;
    const info = toInfo(pickCurrent());
    if (info && info.videoId) showVideo(info);
    else hideVideo();
  }, 800);
})();
