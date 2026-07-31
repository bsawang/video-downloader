# 短视频下载器 · 工作日志

> 用途：记录项目当前状态、技术发现、未解决问题，供后续会话直接接续。
> 最后更新：2026-08-01

## 一、当前状态总览

**产品方向**：自研解析的短视频下载工具。已实现 **浏览器插件（无后端模式）v0.4.2**；Python 后端 Web 版（FastAPI + Playwright）设计完毕待实施（见 `docs/superpowers/specs/` 与 `plans/`）。

**重要决策**：**抖音必须首发**，不要再建议先做其他平台（见记忆 `douyin-first-priority`）。插件先做无后端模式，Web 版为第二步。

## 二、插件 v0.4.2（可用的部分）

### 文件结构（`extension/`）
```
extension/
├── manifest.json              # MV3，2 个 content script，all_frames: true
└── content/
    ├── main.v042.js           # 页面世界（world: MAIN）：hook fetch/XHR + 解析 RENDER_DATA + performance 兜底 + 下载
    └── isolated.v042.js       # 隔离世界：候选匹配 + Shadow DOM 浮层 UI + 下载请求转发
```

### 工作流程
```
① main.js hook 页面的 fetch/XHR，拦截含 aweme 的 API 响应
   → extractCandidates() 递归提取 {aweme_id, video} 条目 → postMessage 发给隔离世界
② 同时解析 script#RENDER_DATA（SSR 内嵌数据），同样提取候选
③ isolated.js 累计候选（按 aweme_id 去重），用 URL 的 modal_id 或 /video/{id} 严格匹配当前视频
   → 匹配到 → 显示标题/作者/多清晰度；匹配不到但有 performance 直链 → 兜底"当前清晰度"
④ 点下载 → isolated postMessage download_request → main.js 用 fetch(credentials:"omit") 拿视频
   → 转 blob → <a download> 存本地
```

### ✅ 已验证可靠（Playwright 端到端实测）
- **直接视频页** `/video/{id}`：完整标题 + 多清晰度 + 无水印下载
- 首页/推荐视频：用户确认可用
- 退出登录的搜索弹窗：用户确认可用

## 三、技术发现与踩坑（重要，勿重复踩）

### 1. 抖音 web 端纯 HTTP 解析已锁死（2026-08-01 实测）
- 无 Cookie 请求 → 空 JS 壳（72KB），`_ROUTER_DATA` 不再出现在原始 HTML
- 带 Cookie 但无签名 → **验证码中间页**
- `/aweme/v1/web/aweme/detail/` 接口 → 空响应，强制 a_bogus/X-Bogus 签名
- 结论：**纯 HTTP 抓 HTML 的方案不可行** → 当初改用 Playwright 后端；插件用"页面内 hook"绕开

### 2. 登录态搜索浮窗 = 浏览器扩展硬限制（未解决）
- 登录态下弹窗视频的 detail 请求和媒体都走**页面 Service Worker**
- 以下手段**全部看不见**：fetch/XHR hook、RENDER_DATA（搜索页无此脚本）、`performance.getEntriesByType("resource")`、`chrome.webRequest`（含 host_permissions + onBeforeRequest + --disable-quic 均实测无效）
- 结论：客户端插件无法穿透页面 SW → **该场景需 Web/后端版（服务端 Playwright）解决**

### 3. 下载机制关键细节
- 抖音 CDN 返回 `Access-Control-Allow-Origin: *`
- 页面内 `fetch(url, { credentials: "include" })` 会触发 CORS 拦截（`ACAO:*` 与凭据模式不兼容）→ 报 `Failed to fetch`
- **必须用 `credentials: "omit"`** 才能读取响应
- `chrome.downloads.download({ headers: [{Referer}] })` 会报 `Unsafe request header name`（只允许 XHR 安全头）
- CDN 直链**不需要 Referer**（httpx 实测无 Referer 也 200），直链带签名+时效

### 4. 候选匹配必须严格
- `candidates` 要用**累计+去重**，否则被后到的推荐流响应覆盖 → 抓到别的视频
- 匹配必须**严格按 URL 的 modal_id / /video/{id}**，匹配不到就隐藏按钮，绝不兜底"取最后一个"

### 5. Chrome 扩展缓存坑
- 内容脚本文件被 Chrome 缓存，点"重新加载"不总能破缓存
- **有效方案：改名内容脚本文件**（如 main.v040.js → main.v042.js）→ 用户"移除重装"扩展

### 6. 其它
- ffmpeg 位置：`H:/ComfyUI_Windows_portable/python_standalone/Scripts/ffmpeg.exe`（8.1.1，不在 PATH，config.py 自动探测）
- `.gitignore` 已忽略 `.venv/`、`downloads/*`、`spikes/.pwtmp*/`；**Playwright 临时 profile 千万别提交**

## 四、未完成 / 后续计划

### 近期（插件收尾，可选）
- [ ] 插件文档 `extension/README.md`（安装/使用说明）还没写（计划 Task 4）
- [ ] 移除插件里的调试日志（`RENDER_DATA script: NOT FOUND` 等每 2 秒一条太吵），或加开关
- [ ] 兜底模式体验：现在只显示"当前清晰度"，可考虑匹配 performance 直链与元数据

### 中期（登录态搜索浮窗）
- 客户端插件解决不了 → **需要 Web/后端版**（服务端 Playwright 拦截 detail API，不受浏览器 SW 限制）
- 或尝试 `chrome.debugger` API（能穿透 SW，但要常驻调试+提示条，脆弱，不推荐）

### 二期（Web/后端版，已有完整设计）
- `docs/superpowers/specs/2026-08-01-video-downloader-design.md`（设计）
- `docs/superpowers/plans/2026-08-01-video-downloader.md`（11 任务 TDD 实施计划）
- 技术栈：Python 3.12 + FastAPI + httpx + Playwright（驱动本地 Edge）+ ffmpeg
- 解析方案：Playwright 加载视频页 → 拦截 `/aweme/v1/web/aweme/detail/` 响应 → 提取多路清晰度
  → httpx 直链下载（Referer + UA，已验证 200）
- **Playwright 后端方案已验证可行**（`spikes/spike_playwright.py`，拦截到 9 路清晰度 + 直链下载 HTTP 200）

## 五、测试脚本（`spikes/`）
- `spike_playwright.py` — Playwright 拦截 detail API 的验证脚本（后端方案可行性证据）
- `probe_modal.py` — 探针：直接页/搜索页的 performance/iframe/请求
- `test_extension.py` — 用 Playwright 加载真实插件，验证按钮+兜底
- `test_bg.py` — 验证 webRequest 观察器（已证明无效，留档）
- `test_addr.py` / `test_dl_headers.py` / `test_dl_browser.py` / `test_omit.py` / `inspect_stream.py` — CDN/下载机制验证

## 六、启动/验证命令备忘
```bash
cd e:/work/ai/video-downloader
.venv/Scripts/python -m playwright install --with-deps   # 仅服务器部署需要；本地用系统 Edge
.venv/Scripts/python spikes/spike_playwright.py          # 后端方案可行性验证
# 插件：chrome://extensions → 加载已解压 → 选 extension/ 目录
```
