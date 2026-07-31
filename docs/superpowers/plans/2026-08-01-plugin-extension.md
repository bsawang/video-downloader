# 短视频下载器浏览器插件（无后端模式）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个纯前端的浏览器插件：用户浏览抖音视频页时，页面浮出"下载"按钮，点开可选清晰度、无水印下载当前视频到本地。零后端、零构建。

**Architecture:** Manifest V3。两个 content script 跑在同一页面：`content/main.js` 用 `world: "MAIN"` 注入页面世界，hook 页面的 `fetch`/`XHR` 拦截 detail API 响应，并在页面上下文 fetch 视频直链转 blob 下载（自带 Referer/Cookie）；`content/isolated.js` 在隔离世界收消息、构建 Shadow DOM 浮层 UI、发起下载。两者用 `window.postMessage` 通信。

**Tech Stack:** 原生 JavaScript / Manifest V3 / Chromium 111+（本机 Edge 146 / Chrome 150 已达标）

## Global Constraints

- **零后端**：所有解析、下载都在浏览器内完成
- **零构建**：纯静态文件，无 npm/webpack/打包器；改动即刷新扩展
- **只用页面世界发下载请求**（继承 douyin Referer + Cookie），隔离世界不跨域 fetch
- **UI 必须用 Shadow DOM** 隔离，防宿主页面 CSS 污染
- Chromium 111+（`world: "MAIN"` 特性），Chrome 150 / Edge 146 已达标
- 文件 UTF-8 编码；文件名经 `sanitize` 清洗 `\ / : * ? " < > |`
- 纯手动 E2E 验证（浏览器扩展无测试框架；提取逻辑保持纯函数，方便浏览器 console 人工核对）

---

### Task 1: manifest.json + 页面世界 hook（content/main.js）

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/content/main.js`

**Interfaces:**
- Produces: `content/main.js`（页面世界）hook `window.fetch` 与 `XMLHttpRequest`，检测到 `aweme/v1/web/aweme/detail` 响应时向隔离世界 `window.postMessage({type:"DY_EXT_MESSAGE", payload:{kind:"video_data", data}})`；并监听隔离世界的 `download_request` 消息，执行 fetch→blob→`<a download>` 下载。Task 2 的 isolated.js 依赖此消息协议。

- [ ] **Step 1: 写 extension/manifest.json**

```json
{
  "manifest_version": 3,
  "name": "短视频下载器",
  "version": "0.1.0",
  "description": "抖音视频无水印下载（无后端，页面内直接下载）",
  "minimum_chrome_version": "111",
  "content_scripts": [
    {
      "matches": ["*://*.douyin.com/*"],
      "js": ["content/main.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["*://*.douyin.com/*"],
      "js": ["content/isolated.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: 写 extension/content/main.js（页面世界：hook 请求 + 下载）**

```js
// 页面世界脚本（world: MAIN）。hook 页面的 fetch/XHR，拦截 detail API 响应；
// 并负责在页面上下文下载视频直链（继承 Referer + Cookie）。
(() => {
  const MSG = "DY_EXT_MESSAGE";
  const DETAIL_PATTERN = "aweme/v1/web/aweme/detail";
  const origFetch = window.fetch;

  function notify(payload) {
    window.postMessage({ type: MSG, payload }, "*");
  }

  // ---- hook fetch ----
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url =
        typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      if (url.includes(DETAIL_PATTERN)) {
        resp
          .clone()
          .json()
          .then((data) => {
            if (data && data.aweme_detail) notify({ kind: "video_data", data });
          })
          .catch(() => {});
      }
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
        if (this.__dyUrl && this.__dyUrl.includes(DETAIL_PATTERN)) {
          const data = JSON.parse(this.responseText);
          if (data && data.aweme_detail) notify({ kind: "video_data", data });
        }
      } catch (e) {}
    });
    return origSend.apply(this, args);
  };

  // ---- 监听隔离世界的下载请求 ----
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
      const resp = await origFetch(url, { credentials: "include" });
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
```

- [ ] **Step 3: 加载扩展验证 hook 生效**

1. Chrome 打开 `chrome://extensions` → 开启"开发者模式" → "加载已解压的扩展程序" → 选 `extension/` 目录。
2. 打开一个抖音视频页（如 `https://www.douyin.com/video/7666780213276190857`）。
3. 打开 DevTools → Console，执行：
```js
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "DY_EXT_MESSAGE") console.log("CAPTURED", e.data.payload.kind);
});
```
4. 刷新页面，确认能看到 `CAPTURED video_data` 打印。
Expected: 打印 `CAPTURED video_data`（说明 hook 生效、detail 响应被拦到）。

- [ ] **Step 4: Commit**

```bash
git add extension/
git commit -m "feat(plugin): manifest + 页面世界 hook 拦截 detail API"
```

---

### Task 2: 隔离世界浮层 UI（content/isolated.js）

**Files:**
- Create: `extension/content/isolated.js`

**Interfaces:**
- Consumes: Task 1 的 `postMessage {type:"DY_EXT_MESSAGE", payload}` 协议（`video_data` / `download_progress` / `download_status`）。
- Produces: 页面右下角浮动按钮 + 点击展开面板（标题/作者/清晰度下拉/下载按钮/进度条/错误提示），Shadow DOM 隔离。点击下载时向 main.js 发 `{kind:"download_request", url, filename}`。Task 3 验证完整下载链路。

- [ ] **Step 1: 写 extension/content/isolated.js**

```js
// 隔离世界脚本。收 main.js 的消息，构建 Shadow DOM 浮层 UI，发起下载。
(() => {
  const MSG = "DY_EXT_MESSAGE";
  const ROOT_ID = "dy-downloader-root";
  let root = null;
  let current = null; // { videoId, title, author, streams }

  function qualityLabel(gearName) {
    const m = String(gearName || "").match(/(\d{3,4})/);
    return m ? m[1] + "p" : gearName || "未知";
  }

  function sanitize(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, "_").trim();
  }

  function extractInfo(data) {
    const item = data.aweme_detail || {};
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
  }

  function showVideo(info) {
    if (!root) buildUI();
    current = info;
    const shadow = root.shadowRoot;
    const $ = (sel) => shadow.querySelector(sel);
    $(".title").textContent = info.title;
    $(".author").textContent = "@" + info.author;
    const sel = $(".quality");
    sel.innerHTML = "";
    info.streams.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.url;
      opt.textContent = s.label;
      sel.appendChild(opt);
    });
    $(".bar-wrap").classList.add("hidden");
    $(".err").classList.add("hidden");
  }

  window.addEventListener("message", (ev) => {
    if (!ev.data || ev.data.type !== MSG) return;
    const p = ev.data.payload;
    if (!p) return;
    if (p.kind === "video_data") {
      const info = extractInfo(p.data);
      if (info.videoId) showVideo(info);
    } else if (p.kind === "download_progress" && root) {
      const shadow = root.shadowRoot;
      const pct = Math.round((p.received / p.total) * 100);
      shadow.querySelector(".bar").style.width = pct + "%";
      shadow.querySelector(".pct").textContent = pct + "%";
    } else if (p.kind === "download_status" && root) {
      const shadow = root.shadowRoot;
      if (p.ok) {
        shadow.querySelector(".bar").style.width = "100%";
        shadow.querySelector(".pct").textContent = "完成";
        setTimeout(() => shadow.querySelector(".bar-wrap").classList.add("hidden"), 1500);
      } else {
        const err = shadow.querySelector(".err");
        err.textContent = "下载失败：" + (p.error || "未知错误");
        err.classList.remove("hidden");
      }
    }
  });
})();
```

- [ ] **Step 2: 刷新扩展，验证浮层出现**

1. `chrome://extensions` → 点击插件"重新加载"（刷新扩展）。
2. 打开抖音视频页并刷新页面，等待 detail 响应被拦。
Expected: 页面右下角出现蓝色"⬇ 下载"圆形按钮；点击展开面板，显示标题、作者、清晰度下拉（1080p/720p/540p…）。

- [ ] **Step 3: Commit**

```bash
git add extension/content/isolated.js
git commit -m "feat(plugin): 隔离世界浮层 UI（Shadow DOM 隔离）"
```

---

### Task 3: 端到端验证（真机下载）

**Files:**
- Modify: （无代码改动，纯验证；若发现 bug 在此修复并提交）

**Interfaces:**
- Consumes: Task 1 + Task 2 的完整链路。
- Produces: 验证通过的标准。

- [ ] **Step 1: 真机下载验证**

打开一个抖音视频页（建议选一个普通作品，如 `https://www.douyin.com/video/7666780213276190857`）：
1. 点"⬇ 下载"按钮 → 面板展开。
2. 选最高清晰度 → 点"下载"。
3. 观察进度条增长 → 浏览器下载文件。
Expected:
- 下载的文件是**无水印**、声音正常的 MP4。
- 文件名形如 `作者_标题_1080p.mp4`（无非法字符）。
- 控制台无跨域报错阻断下载。

- [ ] **Step 2: 边界用例验证**

- 无网络/视频已删除：detail 无响应 → 不弹浮层（可接受）。
- 连续下载两个不同视频：浮层数据正确更新为新视频。
- 页面内 SPA 切换视频（在推荐流里点下一个视频）：再次捕获到新 `video_data`，浮层更新。

- [ ] **Step 3: 修复发现的问题并 Commit**

若验证中发现 bug，修复后：
```bash
git add -A
git commit -m "fix(plugin): 端到端验证修复"
```

---

### Task 4: 使用说明 + 收尾

**Files:**
- Create: `extension/README.md`

**Interfaces:**
- Consumes: 最终可用的插件。
- Produces: 加载/使用说明文档。

- [ ] **Step 1: 写 extension/README.md**

```markdown
# 短视频下载器（浏览器插件，无后端模式）

在抖音视频页直接下载无水印视频，纯前端，无服务器。

## 安装（加载已解压的扩展）

### Chrome
1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」→ 选择本项目 `extension/` 文件夹

### Edge
1. 打开 `edge://extensions`
2. 左侧开启「开发人员模式」
3. 点「加载解压缩的扩展」→ 选择 `extension/` 文件夹

## 使用
1. 打开任意抖音视频页（`www.douyin.com/video/...`）
2. 页面右下角出现「⬇ 下载」按钮
3. 点击展开，选清晰度 → 点「下载」
4. 浏览器自动保存无水印 MP4 到下载目录

## 更新
改动代码后，在扩展管理页点「重新加载」，再刷新抖音页面即可。

## 原理
- `content/main.js`（页面世界）：hook 页面自身 fetch/XHR，拦截 `/aweme/v1/web/aweme/detail/` 响应拿到视频数据；用页面上下文下载直链（自带 douyin Referer/Cookie）
- `content/isolated.js`（隔离世界）：构建浮层 UI，与页面世界 postMessage 通信

## 已知边界
- 仅当你在抖音页面浏览时可用（不支持粘贴链接——那需要后端，见仓库 Web 方案）
- 大视频（几十 MB+）下载会占用相应内存（blob 方案）
- 仅 Chromium 内核浏览器（Chrome/Edge，111+）
```

- [ ] **Step 2: 最终全量验证清单**

在 Chrome 和 Edge 各跑一遍 Task 3 的验证清单，确认都能下载无水印视频。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(plugin): 使用说明与收尾"
```
