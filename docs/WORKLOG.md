# 短视频下载器 · 工作日志

> 用途：记录项目当前状态、技术发现、未解决问题，供后续会话直接接续。
> 最后更新：2026-08-01

## 一、当前状态总览

**产品方向**：自研解析的短视频下载工具。已实现 **浏览器插件（无后端模式）v0.4.2**；Python 后端 Web 版（FastAPI + Playwright）设计完毕待实施（见 `docs/superpowers/specs/` 与 `plans/`）。

**重要决策**：**抖音必须首发**，不要再建议先做其他平台（见记忆 `douyin-first-priority`）。插件先做无后端模式，Web 版为第二步。

**2026-08-01 重大进展**：**登录态搜索 → 下载已打通**（`spikes/search.py`）。之前误判"搜索被软风控返回空"，真相是搜索接口是流式帧格式 + `data[].aweme_info` 嵌套，解析方式不对。登录态复用（`spikes/login.py` + `spikes/run.py --profile`）。

## 二、插件 v0.5.2（可用部分）

### 文件结构（`extension/`）
```
extension/
├── manifest.json              # MV3，2 个 content script，all_frames: true
└── content/
    ├── main.v05.js            # 页面世界：通用视频提取（所有 fetch/XHR 响应递归找 video.bit_rate）+ RENDER_DATA + 下载
    └── isolated.v05.js        # 隔离世界：多锚点匹配 + 视频上叠下载按钮（hover 显示 + 清晰度 popover）
```

### 工作流程
```
① main 通用视频提取：hook 所有 fetch/XHR → 响应 text() 逐行解析（兼容流式帧）→ 递归找
   含 aweme_id + video.bit_rate 的条目 → 精简（过滤 adapt/pay/hdr，标准化清晰度）→ 转发
② isolated 收候选进 Map（aweme_id → 标题/作者/多清晰度直链）
③ 多锚点扫描页面元素（aweme_id 作为 DOM 属性值，不依赖混淆 class）：
   · [data-aweme-id]           首页/精选页 discover-video-card-item
   · [id^="waterfall_item_"]   搜索/推荐列表页
   · [class*="video_"]         详情页播放器容器
   · video 直链 __vid         单列大视频流（播放后 src 才有值，用户已确认）
   任一命中 → 查 Map → 命中 → 叠下载按钮（hover 显示）
④ 点按钮 → fixed 清晰度 popover → 选清晰度 → postMessage download_request → main fetch(credentials:"omit") → 下载
```

### ✅ 已验证可靠（会话式实测 2026-08-01）
- **首页**（精选页）：46 卡片 **46 图标全渲染**（data-aweme-id 锚点），hover none→block，popover 1080p/720p/540p
- **搜索结果页**：20 卡片 8 图标（waterfall_item 锚点），hover + popover + 下载 **210MB 落盘**
- **详情页**：`⬇ 下载` 大按钮（video_ 锚点），popover + 下载 5.2MB 落盘
- 全站统一"视频上叠按钮"交互（无 FAB）

### 关键实现要点（勿重复踩）
- **匹配规律 = 多锚点扫描（aweme_id 作为 DOM 属性值）**，不要依赖单一混淆 class（ZH8C4ExR 等随时会变）
- **瀑布流卡片根是 absolute 定位，绝不能改它的 position**——按钮挂卡片内部 `.videoImage`（本来就是 relative）
- 按钮 hover 才显示（default none）；popover 用 `fixed` 定位（不依赖卡片定位上下文）
- 通用视频提取用 `resp.text()` 逐行解析（流式帧），不能 `resp.json()`
- 精简转发候选（只传 aweme_id/标题/作者/清晰度直链），避免 postMessage 塞大量完整对象
- `driver.py start --extension` 加载插件到常驻浏览器 → session.py/dev.py 会话式验证真实环境（不用每次冷启动）

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
- `.gitignore` 已忽略 `.venv/`、`downloads/*`、`spikes/.pwtmp*/`、`spikes/out/`；**Playwright 临时 profile 千万别提交**；`spikes/login-profile/` 含登录态，已 gitignore（勿提交，敏感）

### 7. 登录态搜索 = 流式帧 + aweme_info 嵌套（2026-08-01 打通，勿重复踩）
- **误判教训**：曾以为"搜索被软风控、`general/search` 返回空 data"。真相是解析方式错，不是风控。
- 搜索接口 `https://www.douyin.com/aweme/v1/web/general/search/stream/` 返回**流式帧**：`<hex长度>\n<JSON>\n<hex长度>\n<JSON>...`，且帧内 JSON 可能是多行 JSONL。**`resp.json()` 必然失败**（`Extra data: line 2 column 1`）→ 必须 `resp.text()` 后按 `\n` 逐行 `json.loads`。
- 搜索结果的真实数据在 **`data[].aweme_info`**（视频条目），不是顶层 `aweme_id`。`data[0]` 是 `{type, aweme_info, ...}`。
- 登录态（`spikes/login-profile`）+ Playwright（headed + `--disable-blink-features=AutomationControlled` + 覆盖 `navigator.webdriver`）下搜索完全正常，返回真实结果（实测"舞蹈"10 条，含标题/作者/多路清晰度/直链）。
- 结果直链 httpx 下载 HTTP 200（Referer + UA）。**需要登录**：无登录态时搜索页连结果都不渲染（登录墙 + `get/user/risklevel` 风控接口）。
- 一次性登录：`spikes/login.py`（headed 弹窗扫码 → 登录态持久化到 `spikes/login-profile/`）。

## 四、未完成 / 后续计划

### 近期（插件收尾，可选）
- [ ] 插件文档 `extension/README.md`（安装/使用说明）还没写（计划 Task 4）
- [ ] 移除插件里的调试日志（`RENDER_DATA script: NOT FOUND` 等每 2 秒一条太吵），或加开关
- [ ] 兜底模式体验：现在只显示"当前清晰度"，可考虑匹配 performance 直链与元数据

### 中期（登录态搜索下载）— 插件 v0.5 已验证可行（2026-08-01 突破）
- **关键新发现**：登录态搜索结果接口 `general/search/stream` **不走 SW**（是普通页面 fetch，实测页面 main world fetch hook 能拦截），且**结果自带直链**（`aweme_info.bit_rate`）→ **插件也能做登录态搜索下载，不需要后端、不需要穿透 SW**
- 之前"受限"特指登录态搜索**弹窗 detail**（走 SW）——但下载不依赖 detail，用搜索结果列表直链即可
- **插件 v0.5 方案已在页面实测通过**（决定性验证 2026-08-01）：
  1. **通用视频提取 hook（不挑接口）**：hook 所有 fetch + XHR 响应 → 递归提取含 `aweme_id + video.bit_rate` 的对象 → 入库全局 Map（85 条，覆盖搜索结果 + 推荐流 + 首页推荐所有数据流）
  2. **卡片锚点：`#waterfall_item_{aweme_id}`**（视频卡片 div 的 id 直接含视频 id，稳定；比 `[href*="/video/"]` 可靠，后者时有时无）
  3. **匹配率 85%**（20 卡片 17 匹配；剩余为图文笔记/无视频直链，本就不该有下载图标）
  4. 图标渲染：挂到卡片内部 `.videoImage`（本来就是 relative），**绝不改卡片根 position**（瀑布流卡片根是 absolute，改了会破坏瀑布流布局——已踩坑）
  5. 动态 redraw：MutationObserver 监听新卡片 + 数据到达自动补图标
- 关键：搜索结果接口只返回 ~8 条，页面其余是推荐流（另一个接口）→ 必须用**通用视频提取**而非只 hook `general/search`
- 截图：`spikes/out/out_v05_icons_fixed.png`、`out_v05_universal.png`；验证片段 `spikes/snippets/`（step2b/step4b/step5/step6）
- 边界：直接 goto `/search/关键词` URL **不渲染结果**（登录墙/风控），必须**从页面内触发搜索**（SPA 状态完整）→ 插件只需"被动"在真实搜索结果页工作

### 二期（Web/后端版，已有完整设计）
- `docs/superpowers/specs/2026-08-01-video-downloader-design.md`（设计）
- `docs/superpowers/plans/2026-08-01-video-downloader.md`（11 任务 TDD 实施计划）
- 技术栈：Python 3.12 + FastAPI + httpx + Playwright（驱动本地 Edge）+ ffmpeg
- 解析方案：Playwright 加载视频页 → 拦截 `/aweme/v1/web/aweme/detail/` 响应 → 提取多路清晰度
  → httpx 直链下载（Referer + UA，已验证 200）
- **Playwright 后端方案已验证可行**（`spikes/spike_playwright.py`，拦截到 9 路清晰度 + 直链下载 HTTP 200）

## 五、测试脚本（`spikes/`）

### ✅ 常驻浏览器 + 动态测试（`spikes/driver.py`）— 解决反复开闭浏览器的痛点
```bash
.venv/Scripts/python spikes/driver.py start     # 启动常驻 Edge（CDP 端口 9222，含登录态）
.venv/Scripts/python spikes/driver.py status    # 是否运行中
.venv/Scripts/python spikes/driver.py stop      # 关闭（CDP Browser.close，注意 browser.close() 只断连不关进程）
```
- **原理**：Edge 带 `--remote-debugging-port=9222` 常驻，run.py/search.py 通过 CDP **连接**执行（新开 tab，用完只关 tab，浏览器不关）。改代码重跑 = 刷新页面，秒级。
- **自动连接**：常驻浏览器在时，run.py/search.py **自动**走连接模式（打印"连接常驻浏览器"）；不在时自动冷启动兼容。`--cold` 强制冷启动，`--connect` 强制连接。
- **实测提速**：run.py 解析 25s→7s，search.py 搜索下载 40s→16s。
- profile 复用 login-profile → 常驻浏览器一开就有登录态。**注意**：常驻期间别再用 `run.py --profile` 冷启动（profile 锁冲突）。
- plugin 模式需加载扩展，始终冷启动（连接模式无扩展）。
- driver.py 找不到 msedge 时会用 Playwright 探测路径。

### ✅ 常驻测试会话（`spikes/session.py`）— 状态累积、增量推进（终极动态测试形态）
```bash
.venv/Scripts/python spikes/session.py start              # 常驻会话服务（HTTP 9100，持有页面+捕获）
.venv/Scripts/python spikes/session.py navigate <链接>     # 当前 tab 内导航
.venv/Scripts/python spikes/session.py eval "<js>"        # 对当前页面执行 JS
.venv/Scripts/python spikes/session.py watch <子串>       # 拦截 url 含该子串的响应（累积到 captured）
.venv/Scripts/python spikes/session.py captured           # 查看已捕获响应
.venv/Scripts/python spikes/session.py extract            # 从捕获响应提取视频条目（search 流式帧/detail JSON）
.venv/Scripts/python spikes/session.py items / download <编号>   # 看条目 / httpx 下载
.venv/Scripts/python spikes/session.py stop               # 关服务（浏览器保持）
```
- **设计**：服务进程持有 连接 + 当前页面 + `captured[]`（网络拦截累积）+ `items[]`（提取条目）。每个命令只推进，页面不重载、捕获不丢 → 新测试直接接在旧状态上，不用从头跑。
- **关键坑**：sync Playwright 绑定创建线程（greenlet），ThreadingHTTPServer 多线程必然 `Cannot switch to a different thread`。**必须用 async Playwright + 单事件循环**，HTTP handler 经 `asyncio.run_coroutine_threadsafe` 桥接；`on_response` 回调在 loop 里 `await resp.text()`。
- 与 driver.py 配合：driver 管浏览器常驻，session 管会话状态累积。登录态搜索流程：`watch general/search` → `navigate 首页` → `eval` 触发搜索 → `captured`/`extract`/`download`。

### ✅ 搜索下载工具（`spikes/search.py`）— 登录态关键词搜索 → 列表 → 下载
```bash
.venv/Scripts/python spikes/login.py                         # 一次性登录（弹窗扫码，登录态存 login-profile/）
.venv/Scripts/python spikes/search.py 舞蹈                   # 列出搜索结果
.venv/Scripts/python spikes/search.py 舞蹈 --index 1,3       # 下载第 1、3 条（最高清晰度）
.venv/Scripts/python spikes/search.py 舞蹈 --all --max 20    # 下载前 20 条全部
```
- 需要先登录（login.py）。下载走 httpx 直链（Referer + UA）到 `downloads/`。
- 解析要点：搜索响应是流式帧（`hex长度\nJSON\n`）+ `data[].aweme_info` 嵌套，见第三节第 7 条。

### ✅ 统一测试 runner（`spikes/run.py`）— 日常测试走这个，别再用零散脚本
三种模式，一条命令拿结论，输出统一到 `spikes/out/run_<时间戳>_<模式>/`（result.json + page.png）：
```bash
.venv/Scripts/python spikes/run.py --url video                 # backend：解析验证（headless，默认）
.venv/Scripts/python spikes/run.py --url video --download      # backend + httpx 验证直链下载
.venv/Scripts/python spikes/run.py --url video --mode plugin   # 插件 UI + 下载链路（headed，弹窗口）
.venv/Scripts/python spikes/run.py --url <链接> --mode probe   # 诊断：perf直链/iframe/aweme请求
.venv/Scripts/python spikes/run.py --url <链接> --profile spikes/login-profile   # 复用登录态
.venv/Scripts/python spikes/run.py --list                      # 内置测试链接（video/search）
```
- `--url` 可传任意抖音链接，也接受 preset 名（video/search）
- `--profile` 复用登录态目录（login.py 生成）；backend/probe 支持，plugin 也支持（可测登录态下插件）
- 断言 PASS/FAIL 汇总，退出码 0/1，可直接进 CI
- **关键设计**：每次用全新临时 profile → 内容脚本永远读磁盘，**缓存坑根治**，不用改文件名、不用移除重装、不碰真浏览器
- **编码坑已解**：run.py 顶部 reconfigure stdout 为 UTF-8（本机终端按 UTF-8 解读，默认 GBK 会乱码）
- 产物目录已加 `.gitignore`

### 旧脚本（已退役，仅留档）
- `spike_playwright.py` — Playwright 拦截 detail API 的验证脚本（后端方案可行性证据）
- `probe_modal.py` — 探针：直接页/搜索页的 performance/iframe/请求（已并入 run.py --mode probe）
- `test_extension.py` — 用 Playwright 加载真实插件验证按钮+兜底（已并入 run.py --mode plugin）
- `test_bg.py` — 验证 webRequest 观察器（已证明无效，留档）
- `test_addr.py` / `test_dl_headers.py` / `test_dl_browser.py` / `test_omit.py` / `inspect_stream.py` — CDN/下载机制验证（结论已固化到下面第四节）

## 六、启动/验证命令备忘
```bash
cd e:/work/ai/video-downloader
.venv/Scripts/python spikes/login.py                          # 首次：登录一次（弹窗扫码）
.venv/Scripts/python spikes/search.py 舞蹈 --index 1,2        # 登录态搜索下载
.venv/Scripts/python spikes/run.py --url video --download     # 后端解析 + 直链下载（日常主验证）
.venv/Scripts/python spikes/run.py --url video --mode plugin  # 插件发布前 UI + 下载回归
.venv/Scripts/python -m playwright install --with-deps        # 仅服务器部署需要；本地用系统 Edge
# 手动装插件：chrome://extensions → 加载已解压 → 选 extension/ 目录（仅最终体验确认用）
```
