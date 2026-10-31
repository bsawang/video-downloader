# PROGRESS

> 单一真相源：本文件。prd / spec 的状态后缀是镜像，由本文件回写。

## 全览（索引 —— 唯一真相源）
| Mx.y | 状态 | 批次 |
|---|---|---|
| M6.2 | ✅ | 批次 1 |
| M1.1 | ✅ | 批次 1 |
| M1.2 | ✅ | 批次 1 |
| M1.3 | ✅ | 批次 1 |
| M2.1 | ✅ | 批次 1 |
| M2.2 | ✅ | 批次 1 |
| M3.1 | ✅ | 批次 1 |
| M3.2 | ✅ | 批次 1 |
| M4.1 | ✅ | 批次 1 |
| M4.2 | ✅ | 批次 1 |
| M5.1 | ✅ | 批次 1 |
| M6.1 | ✅ | 批次 1 |
| M3.3 | ✅ | 批次 2 |
| M7.1 | ✅ | 批次 3 |
| M7.2 | ✅ | 批次 3 |
| M7.3 | ✅ | 批次 3 |
| M7.4 | ✅ | 批次 4 |
| M8.1 | ✅ | 批次 5 |
| M8.2 | ✅ | 批次 5 |
| M8.3 | ✅ | 批次 5 |
| M9.1 | ✅ | 批次 6 |
| M9.2 | ✅ | 批次 6 |
| M9.3 | ✅ | 批次 6 |
| M9.4 | ✅ | 批次 7 |
| M10.1 | ✅ | 批次 8 |
| M10.2 | ✅ | 批次 8 |
| M10.3 | ✅ | 批次 8 |
| M10.4 | ✅ | 批次 8 |

## v0.14.0 ✅ {spec §M10 · 音视频合并下载}
- 目标：分离流档位（YouTube 自适应 / B站 DASH）点一档只下一个文件（画面+音轨无损合并在浏览器内完成）
- 方案定案：自写零依赖 fMP4 box 合并（不引入 mediabunny / ffmpeg.wasm，不做云端队列）；实测 dist 72 841 B → 90 498 B（+17 657 B，+24.2%，合并器本体 10 297 B）
- 子需求：M10.1 合并算法 → M10.2 合并下载编排 → M10.3 YouTube 合并档 → M10.4 B站合并档
- 实现：
  - [src/kernel/merge.js](file:///E:/work/ai/video-downloader/src/kernel/merge.js)：box 解析（含 `largesize` / `size=0`）、单 `moov` 双 `trak` 合并、`tkhd`/`trex`/`tfhd` track_ID 补丁、`mvhd.next_track_ID` 补丁、丢弃 `sidx/ssix/mfra`、媒体段视频→音频流式搬箱
  - [src/kernel/download.js](file:///E:/work/ai/video-downloader/src/kernel/download.js)：`MuxPlan` 编排；OPFS 临时文件（不可用回退内存，512 MiB 上限）；两路分别上报进度；任一路截断 `abort`；成功/失败都清理临时文件；无 picker 时落 blob
  - [src/platforms/youtube/adapter.js](file:///E:/work/ai/video-downloader/src/platforms/youtube/adapter.js)：MP4 自适应画面 + AAC → 单条合并档（`kind:"mux"` + `audioItag/audioUrl`）；VP9/WebM 或无 AAC 保留拆分
  - [src/platforms/bilibili/adapter.js](file:///E:/work/ai/video-downloader/src/platforms/bilibili/adapter.js)：DASH 高档位有标准 AAC 时输出合并档，否则拆分；点选时一次 `fnval=4048` 现取两路
  - [tools/build.mjs](file:///E:/work/ai/video-downloader/tools/build.mjs)：`ORDER` 补 `kernel/merge.js`（首次真页点下载暴露 `mergeFmp4Blobs is not defined`，单测走 ESM import 抓不到漏拼）
- 单测：`npm test` **118 pass / 0 fail**（`tests/merge.test.mjs` 6 例；`tests/download.test.mjs` 增合并落盘/两路进度/截断中止/非分片合并失败/临时文件创建失败回退/内存回退/blob 回退/picker 取消 7 例；两个 adapter 合并档与拆分回退；新增 `tests/build.test.mjs` 校验每个 `src` 模块都进了产物）
- 真页收点（CDP 注入最终构建 0.14.0，B站 `BV1GJ411x7h7`）：
  - 菜单：`高清 1080P`（合并档）/ `高清 1080P 音频` / `高清 720P` / `流畅 360P`；点合并档只弹 1 次保存对话框
  - 落盘：OPFS 输出 **75 165 765 B**，353 次写入，`closed:true` / `aborted:false`；toast 序列含 `合并中 33%…97%` → **`✓ 下载完成（已合并）`**
  - 结构：`ftyp + moov(mvhd,mvex,trak,trak,udta) + moof/mdat…`，`tkhd` id `[1,2]`、`trex` id `[1,2]`
  - 可播放：同一文件挂 `video`，`duration 212.308833s`、`1920x1080`、`readyState 4`、`played:true`
  - CDN：两路 `Range: bytes=0-1023` 均 `206`、正文 1024 B、首盒 `ftyp`；两路完整下载由 `content-length` 校验（截断会 abort）
  - 临时清理：成功与失败两次运行后 OPFS 根目录只剩验证输出文件，`dl-merge-*` 无残留
  - 过程缺陷：首次真页点下载报 `mergeFmp4Blobs is not defined`（`tools/build.mjs` 的 `ORDER` 漏了 `kernel/merge.js`），补 `ORDER` 并新增 `tests/build.test.mjs` 防回归；修复后重跑通过
- 构建：`npm run build` → `dist/douyin.user.js` **90 498 B**，`node --check` 通过，`@version 0.14.0`，sha256 `11800a5809b9d158d0bb32015e8ebd9ec76b24ed56cfbc315a63a49d10b9567c`
- 发版：release v0.14.0 挂 `douyin.user.js` + `video-downloader-v0.5.3.crx/.zip`；固定别名 → `200`、90 498 B、`@version 0.14.0`，sha256 与本地全等；`releases/latest` → `v0.14.0`


## v0.13.0 ✅ {spec §M9.4 · Shorts 接入 + hover 预览下按钮存活}
- 缺陷 / 需求（用户反馈）：
  - 视频卡片 hover 触发预览后下载按钮消失（YouTube 预览是覆盖在缩略图上的全局层 `#video-preview`，指针进入后卡片不再 `:hover`，hover 揭示把按钮藏掉）
  - Shorts 类型没有下载入口（`/shorts/<id>` 播放页与首页 Shorts 货架卡片均不挂）
- 调研（CDP 运行态）：
  - 预览层：`DIV#video-preview > YTD-VIDEO-PREVIEW.ytdVideoPreviewHost.ytdVideoPreviewActive`（`position:absolute`，`z-index:auto`），内部 `DIV.ytdVideoPreviewVideoPreviewContainer` 与缩略图同框（528×297），**不在卡片 DOM 内**（`closest('yt-lockup-view-model')` 为 null）
  - 常规网格卡片：按钮常显后 25/25 命中测试为按钮本身（根层叠上下文里 `z-index:99999` 高于预览层），无需抬层
  - Shorts 货架：容器 `DIV#contents.ytd-rich-shelf-renderer` 带 `transform` → 建立层叠上下文，卡内按钮（`z-index:99999`）整页层面压不过预览层，命中测试落到 `VIDEO`；必须挂页面级浮层
  - Shorts DOM：播放页实际播放器是竖屏 `#shorts-player`（405×767），`#movie_player` 存在但 0×0 隐藏；货架卡片 `ytm-shorts-lockup-view-model`，id 只在内部 `a[href="/shorts/<id>"]`，标题在 `h3`
  - Shorts 直链：`ANDROID_VR` 对该 Short 回 `LOGIN_REQUIRED` → `IOS` 兜底 `OK`，30 条 adaptive、0 条 progressive（菜单因此只有「画面（无音轨）」+ 音频）
- 改动：
  - [src/platforms/youtube/rules.js](file:///E:/work/ai/video-downloader/src/platforms/youtube/rules.js)：`ytVideoIdFromUrl` 同时认 `/watch?v=` 与 `/shorts/`；`ytCurrentVideoId` 读 `pathname + search`；`ytCardVideoId` 遍历任意 `a[href]`；新增 `#shorts-player` 详情锚点（`pageScope: /^\/shorts/`，`pos: { top: 70, right: 12 }` —— 顶部 12px 落在站点控件行（播放/静音/全屏按钮 y 80..128）下方会被吃掉命中，下移到 70px 让开 48px 控件）；卡片锚点加 `ytm-shorts-lockup-view-model` / `ytd-reel-item-renderer`，全部 `alwaysShow`，Shorts 两条另加 `overlay`
  - [src/kernel/core.js](file:///E:/work/ai/video-downloader/src/kernel/core.js)：新增页面级浮层挂载（`div[data-dl-layer]`：`fixed;inset:0;pointer-events:none;z-index:100000`，按钮自身 `pointer-events:auto`）；`placeOverlay` 按挂载元素 `getBoundingClientRect()` 定位右上内缩 8px，离屏/零尺寸隐藏；`scroll`(capture)/`resize` 走 rAF 合批重定位；节点复用/卸载时同步清理浮层条目
  - [src/kernel/ui.js](file:///E:/work/ai/video-downloader/src/kernel/ui.js)：卡片按钮支持 `fixed` 定位；常显由 `alwaysShow` 控制
  - [src/kernel/download.js:43](file:///E:/work/ai/video-downloader/src/kernel/download.js#L43)：补完整性校验 —— 服务端给了 `content-length` 但实际只收到更少字节时，`writable.abort()` 丢弃半成品并提示「✗ 下载失败：数据不完整（收到/总字节）」，不再误报 `✓ 下载完成`（对照 M3.2「落盘字节数等于 content-length」）
  - 文档：prd M9 范围、spec §2.2 `AnchorRule.alwaysShow/overlay`、M9.2/M9.4 详细设计（含控件行避让与层叠上下文）、README「YouTube 说明」补 Shorts 与常显按钮
  - 版本 0.12.0 → **0.13.0**
- 单测：`npm test` **100 pass / 0 fail**（含 Shorts id 解析、`#movie_player`/`#shorts-player` scope 互斥、卡片 `alwaysShow/overlay`、字节不足判失败）
- 真页收点（CDP 注入 0.13.0）：
  - 首页 Shorts 货架：10/10 卡片按钮挂浮层；例：缩略图 311×466 @ (264,629) → 按钮 27×28 @ (540,637)（右缩 8px / 上缩 8px）；视口外卡片按钮 `display:none`
  - hover 预览激活（`ytd-video-preview` 带 `Active/Playing`，`<video>` `readyState 4`、`t=1.7s`、未暂停）时按钮仍 `display:block`，按钮中心 `elementFromPoint` = `button[data-dl-icon]`，层序 `button > video > #inline-preview-player`
  - 货架卡片点按钮 → 菜单 **6 档**（720p/480p/360p/240p/144p 画面（无音轨）+ 音频 130kbps），标题取自接口
  - Shorts 播放页 `/shorts/KTNDdzmWnkU`：`stats {candidates:1,anchors:1,mounted:1}`，按钮 **79×40 @ (1144,134)**（`#shorts-player` 829×767 @ (829,64) 右上 `top:70/right:12`）；悬停按钮中心命中 `button[data-dl-icon]`，层序 `button > video > #shorts-player > #container`；点开菜单 6 档；点 144p → InnerTube 200 + googlevideo 请求发出
  - 当前网络下字节流不可用（独立于产品代码的对照）：同源页面直接 `fetch` googlevideo 也拿不到正文 —— `/shorts` 页直链 302 到另一节点后响应缺 `Access-Control-Allow-Origin`（`Network.loadingFailed` = `MissingAllowOriginHeader`）→ toast「✗ 下载失败：TypeError: Failed to fetch」；`/watch` 页直链 `206 + content-length 705986` 但正文只回 1 B，新校验给出「✗ 下载失败：数据不完整（1/705986 字节）」并 abort 半成品。链路请求（档位/签名/Range）本身正确，等服务端/代理恢复后即可完整落盘
- 构建：`npm run build` → `dist/douyin.user.js` **72 841 B**，`@version 0.13.0`，sha256 `31a4949c406fe445e975478d484a99a7518804787c9e5c7276df79faca6e9bee`
- 发版：release v0.13.0 挂 `douyin.user.js` + `video-downloader-v0.5.3.crx/.zip`；固定别名 → `200`、72 841 B、`@version 0.13.0`，sha256 与本地全等

## v0.12.0 ✅ {spec §M9 · YouTube 平台接入}
- 调研（CDP 运行态 + InnerTube 实测）：
  - 播放页内联 `ytInitialPlayerResponse` 只有 SABR 信息，没有逐档直链
  - 同源 `POST https://www.youtube.com/youtubei/v1/player?key=<ytcfg INNERTUBE_API_KEY>&prettyPrint=false`（`credentials: include`）可取 `formats/adaptiveFormats`
  - `ANDROID_VR`（1.62.27 / Android 32）给 progressive 360p + adaptive + AAC；受限视频返回 `LOGIN_REQUIRED` 或 `Sign in to confirm you're not a bot`
  - 回退 `IOS`（20.10.4）返回 `OK`，37 条 adaptive（1080p avc1 + AAC），无 progressive
  - googlevideo 直链：IOS 来源不带 `Range` 直接 GET 是 403，带 `Range: bytes=0-` 为 206（`Content-Length` 为全长）；单条响应里的边节点可达性不定，`mn=` 给出同 `rrN---` 前缀的备用节点
  - 新版首页/相关推荐卡片是 `yt-lockup-view-model`；搜索页仍 `ytd-video-renderer`；旧相关推荐 `ytd-compact-video-renderer`；播放器 `#movie_player`
- 改动：
  - 新增 [src/platforms/youtube/rules.js](file:///E:/work/ai/video-downloader/src/platforms/youtube/rules.js)：视频 ID / 卡片标题提取，详情锚点（`#movie_player`，`top:12 right:12`，`pageScope: ^/watch`）+ 四种卡片锚点
  - 新增 [src/platforms/youtube/adapter.js](file:///E:/work/ai/video-downloader/src/platforms/youtube/adapter.js)：`YT_CLIENTS`（VR → IOS）取播放数据、`ytBuildStreams` 分 progressive/画面/音频并排序、`ytResolveDownload` 现取直链 + `ytPickReachable` 节点探测 + `Range: bytes=0-`、`ytFilename`/`ytStub`/`ytRefresh`/`ytLoadVideo`
  - [src/entry/tm.js:5](file:///E:/work/ai/video-downloader/src/entry/tm.js#L5) 与 [tools/build.mjs](file:///E:/work/ai/video-downloader/tools/build.mjs) 接入第四份适配（`ORDER` / `matches` 并集 / `@description`）
  - 新增 `tests/youtube.test.mjs` 21 例
  - 文档：prd M9 客户端口径、spec M9.1–M9.3 详细设计、README 新增「YouTube 说明」
  - 版本 0.11.5 → **0.12.0**（新增模块 M9）
- 单测：`npm test` **99 pass / 0 fail**
- 真页收点（CDP 注入 0.12.0）：
  - 播放页：21 个锚点全挂（1 详情 + 20 相关），详情按钮 78.7×40 @ `#movie_player` 右上 12px，菜单 **10 档**（progressive + 画面/音频分离流）
  - 首页：23/23 `yt-lockup-view-model` 卡片全挂，卡片按钮在缩略图内 8px；点 Minimax 卡片 → IOS 兜底约 **1.0 s** 出 **9 档**菜单
  - 下载：144p 完整落盘 **2 058 142 B / 54 writes**，toast `✓ 下载完成`；720p 传输至 5.2 MiB（随后网络中断，与页面自身播放器同时卡缓冲）；更早构建 1080p 完整 **80 911 999 B**（77.2 MiB / 4 638 writes）
  - 受限视频：不再静默失败，提示「YouTube 要求人机验证，请先在浏览器打开该视频后再试」；`LOGIN_REQUIRED` 单独提示
- 构建：`npm run build` → `dist/douyin.user.js` **68 543 B**，`@version 0.12.0`，sha256 `a3cd23b98e86a05c6b0e77437f29cc90d71c364a965dd1c434e07c08be8ea570`
- 发版：release v0.12.0 挂 `douyin.user.js` + `video-downloader-v0.5.3.crx/.zip`；固定别名 → `200`、68 543 B、`@version 0.12.0`，sha256 与本地全等

## 快道 v0.11.5 ✅ {spec §7 · /red_video 栏目笔记不挂按钮}
- 缺陷（用户反馈）：首页正常，`https://www.xiaohongshu.com/red_video` 栏目仍有问题——从该栏目点开卡片后，播放弹层里没有下载按钮
- 定位：
  - 该栏目打开笔记时地址是 `/red_video/<24hex>`（如 `/red_video/6ae44628000000001802e5b0?xsec_token=…&xsec_source=pc_dual_feed`），不是 `explore` / `discovery/item`
  - `NOTE_PATH` 与详情锚点 `pageScope` 都只放行 `explore|discovery/item` → `xhsNoteIdFromPath` 返回 null → 详情锚点 `idFrom` 直接 null，kernel 跳过
  - 实测该弹层 `#noteContainer`/`.player-container`/`video` 齐全，`noteDetailMap` 里也有该 id 且 `note.type === "video"` —— 数据没问题，只是路径没认
- 改动：
  - [src/platforms/xiaohongshu/rules.js:7](file:///E:/work/ai/video-downloader/src/platforms/xiaohongshu/rules.js#L7) `NOTE_PATH` 增加 `red_video`；[src/platforms/xiaohongshu/rules.js:181](file:///E:/work/ai/video-downloader/src/platforms/xiaohongshu/rules.js#L181) 详情 `pageScope` 同步增加 `red_video`
  - `tests/xiaohongshu.test.mjs`：`xhsNoteIdFromPath` 增 `/red_video/<id>` 与 `/red_video` 两例，详情 `pageScope` 增同两例
  - 版本 0.11.4 → **0.11.5**；无 Mx.y 与验收判据变化
- 单测：`npm test` **78 pass / 0 fail**
- 真页收点（CDP 注入 0.11.5）：
  - 修前（TM 0.11.4，同一 `/red_video/6ae44628…` 弹层）：`#noteContainer` 等节点齐全，按钮 0 个
  - 修后：`__dlStats` `{candidates:1, anchors:1, mounted:1, downloadable:1}`；hover 后按钮 **78.7×37.25 @ (950.6,101)**，`elementFromPoint` 命中按钮本身
  - 点开菜单：弹层 182×101.8，标题「美元这轮没加息 背后看到了什么？」，档位 `⬇ 1080p / 720p`（与页面状态 EF4 的 1080×1920 / 720×1280 两档一致）
  - 点 720p：解析出 `https://sns-video-v6.xhscdn.com/stream/1/110/258/01eae445…_258.mp4?sign=…&t=…`，响应 `200`、`content-length` **20 031 057 B**，与状态里 720p EF4 的 `size` 完全相同
  - `/red_video` 栏目网格：20 张卡片 / 20 个按钮全挂；注入 0.11.5 后 20 个新按钮，卡片按钮 27.1×24.9 @ (544.8,203.5)；点按钮 → 菜单 `⬇ 1080p / 720p`
- 构建：`npm run build` → `dist/douyin.user.js` **55 712 B**，`@version 0.11.5`，sha256 `1704bb0d…f1d697`
- 发版：release v0.11.5 挂同名资产；固定别名 → `200`、55 712 B、`@version 0.11.5`，sha256 与本地全等

## 快道 v0.11.4 ✅ {spec §7 · 弹层按钮延迟出现}
- 缺陷（用户反馈）：小红书播放弹窗的下载按钮出现慢，要等一会儿才挂上
- 定位（弹层实测时间线，相对点击卡片）：
  - 点击 → 地址栏切换 +7 ms → `#noteContainer` / `.player-container` +173 ms → **视频 `<video>` +2574 ms**
  - 0.11.3 的 DOM 兜底等 `<video>` 出现才认视频笔记；而 kernel 的变更防抖是纯 debounce，页面重绘（播放器分步插入）会不断重置 300 ms 计时 → 按钮要等整段重绘停下来
  - 修复前按钮在地址栏切换后约 **986 ms** 才出现
- 改动：
  - [src/platforms/xiaohongshu/rules.js:175](file:///E:/work/ai/video-downloader/src/platforms/xiaohongshu/rules.js#L175) DOM 兜底改认 `.player-container / .video-player-media / video`——播放器容器与弹层同刻插入，不再等视频节点；图文弹层只有 `.media-container.swiper`，仍不挂
  - [src/kernel/core.js:23](file:///E:/work/ai/video-downloader/src/kernel/core.js#L23) `scheduleRender` 由 300 ms 纯防抖改为 200 ms 节流（首次变更固定间隔渲染，期间变更排下一轮，不再被连续重绘饿死）
  - 版本 0.11.3 → **0.11.4**；无 Mx.y 与验收判据变化
- 单测：`npm test` **78 pass / 0 fail**（详情锚点用例补 `.player-container` 命中与图文 `.swiper` 不命中）
- 真页收点（CDP 注入 0.11.4，弹层路径 `6ac0fdfe…`）：
  - 新时间线（相对点击）：`pushState +7 ms` → 容器/播放器 `+173 ms` → **按钮 `+278 ms`**；`<video>` 到 `+2574 ms` 才出现，已与按钮挂载无关
  - 按钮在 `.player-container` 上、`data-dl-hover=1`；点开菜单 `⬇ 1080p / 720p`，标题取到笔记真实标题
  - B站首页注入同一构建：21/21 锚点挂载，静置 4 s 后仍 21/21（无重复挂载/抖动）
- 构建：`npm run build` → `dist/douyin.user.js` **55 603 B**，`@version 0.11.4`，sha256 `a06d2986…62fc`
- 发版：release v0.11.4 挂同名资产；固定别名 → `200`、55 603 B、`@version 0.11.4`，sha256 与本地全等

## 快道 v0.11.3 ✅ {spec §7 · 小红书播放弹窗按钮消失}
- 缺陷（用户反馈）：小红书播放弹窗（从发现页点卡片打开的 `#noteContainer`）里没有下载按钮
- 定位：
  - 新版弹层从接口取笔记数据，不再写 `window.__INITIAL_STATE__`：打开后 `note.noteDetailMap` 为空对象（实测 `keys: []`），而 `#noteContainer` 与 `.player-container`/`video` 正常渲染
  - 详情锚点 `idFrom` 只认 `noteDetailMap` 里的 video 笔记 → 返回 null → kernel 直接跳过该锚点，永不挂按钮
  - 直开笔记 URL 时页面仍会内联状态，所以该缺陷只在「卡片点开弹层」路径出现
- 改动：
  - [src/platforms/xiaohongshu/rules.js:169](file:///E:/work/ai/video-downloader/src/platforms/xiaohongshu/rules.js#L169) `idFrom` 改为两级判定：页面状态是视频笔记 → 取路径 id；否则容器里已有 `video` 播放器 → 也认作视频笔记；图文弹层无 `video`，仍不挂按钮
  - 版本 0.11.2 → **0.11.3**；无 Mx.y 与验收判据变化
- 单测：`npm test` **78 pass / 0 fail**（新增详情锚点三种情况：无状态 + 有播放器 → 取 id；无状态 + 无播放器 → null；有状态 → 取 id）
- 真页收点（CDP 注入 0.11.3，弹层路径 `6adc4870…`，注入前弹层 0 按钮）：
  - 注入后 `#noteContainer .player-container` 挂上新按钮，`data-dl-hover=1`；`window.__dlStats` `{anchors:16, mounted:16, candidates:1}`
  - hover 后点开菜单：标题「盘点那些杀人诛心爆笑名场面」，档位 `⬇ 1080p / 720p`（标题与档位均来自补全请求的笔记页 HTML）
  - 点 720p：`sns-video-v6…/258/…_258.mp4` 单次传输 **88 300 669 B** 完成
  - 图文卡片点击未打开弹层（站点交互未触发），未取得图文弹层真页样本；单测覆盖「无 video → null」
- 构建：`npm run build` → `dist/douyin.user.js` **55 001 B**，`@version 0.11.3`，sha256 `cf4041ae…1523`
- 发版：release v0.11.3 挂同名资产；固定别名 → `200`、55 001 B、`@version 0.11.3`，sha256 与本地全等

## 快道 v0.11.2 ✅ {spec §7 · 小红书登录态取档位失败 + 弹层档位不全}
- 缺陷（用户反馈）：已登录小红书后点下载提示取链接失败；另外菜单档位比站点实际提供的少
- 定位一（取链失败）：
  - 登录态笔记页 HTML 的 `window.__INITIAL_STATE__` 不是严格 JSON：值位置有裸 `undefined`，还夹带 `new Map([])`（如 `tailMap`）
  - `xhsStateFromHtml` 只做 `JSON.parse`，解析失败返回 `null` → `xhsFetchNote` 抛「获取视频信息失败」→ 卡片 `onOpen` 拒绝 → `createButton` 的 catch 静默返回，表现为「点了没反应/取链失败」
  - 实证：登录态请求笔记页 `200`、124 113 B，状态串含 `new Map([])`；修复前解析 `null`
- 定位二（档位差异）：
  - 同一笔记 `6ae3fba90000000016019c84`，页面状态 `note.video.media.stream` 只有 `EF4:720x1280`（弹层与直开详情页均如此），播放器实际取 `_258.mp4` 720p 播放
  - 同一 id 的笔记页 HTML 状态里有完整阶梯：`EF5:720/1080/1440/2160 + EF4:720`
  - 旧实现优先用页面状态且 store 缓存后不再取 → 菜单只列 720p
- 改动：
  - `src/platforms/xiaohongshu/rules.js:119` 新增 `xhsFixStateLiterals`：裸 `undefined/NaN/Infinity → null`、`new Map([...]) → 对象`、`new Set([...]) → 数组`，严格 JSON 失败后宽松化重试（`rules.js:139`）
  - `src/platforms/xiaohongshu/adapter.js:20` 新增 `XHS_FULL` 标记 + `xhsMergeStreams`（页面状态 / 缓存 / HTML 三源按档位取并集，先到先得）；`xhsLoadNote`（`:48`）每次都尝试取一份笔记页 HTML 补齐，成功后打标记；`xhsPrefetch`（`:103`）与 `xhsRefresh`（`:111`）改为走同一补全路径，补过的 id 不再请求；`xhsResolveDownload`（`:137`）在页面状态缺该档时按 HTML 取新链，令牌缺失时回退地址栏
  - 版本 0.11.1 → **0.11.2**；无 Mx.y 与验收判据变化
- 单测：`npm test` **77 pass / 0 fail**（新增 Map/Set 字面量解析、HTML 补全缺档、缺档重取新链、补全后不重复请求等用例；RED 阶段 `xhsStateFromHtml` 返回 null 触发 TypeError）
- 真页收点（CDP 注入 0.11.2 构建）：
  - 直开笔记 `6ae3fba9…`：页面状态只有 `EF4:720`（播放器 720×1280 blob），菜单为 `⬇ 2160p / 1440p / 1080p / 720p` 四行；补全请求 1 次（`explore/<id>` transfer 36 446 B、304 ms）
  - 弹层同一笔记：同样四行；点 `2160p` 下载 `_523.mp4` **30 642 312 B** 完成
  - `/red_video` 卡片 `6ae338e4…`：hover 预取后菜单 `⬇ 1080p / 720p`，点 `720p` 下载 **97 539 892 B**，toast `✓ 下载完成`
  - 链接对照：站点播放器 `sns-video-v6.xhscdn.com/stream/79/110/258/…_258.mp4?sign=cd9d…&t=6aea52e9`；下载 2160p `…/523/…_523.mp4?sign=c2cb…&t=6aea53fb`——同主机同路径前缀，仅档位段不同；`sign/t` 每次加载重签；状态里的 `http://` 已升 `https://`
- 构建：`npm run build` → `dist/douyin.user.js` **54 805 B**，`@version 0.11.2`，sha256 `97f46ffa…fe12`
- 发版：release v0.11.2 挂同名资产；固定别名 `releases/latest/download/douyin.user.js` → `200`、54 805 B、`@version 0.11.2`，sha256 与本地全等
- 未覆盖：未登录/无令牌时仍只能拿到页面状态里的档位（小红书卡片正常渲染都带令牌）；97 MB 级 720p 走 blob 的整体内存峰值未单独测量（沿用既有下载路径）

## 快道 v0.11.1 ✅ {spec §7 · 按钮箭头被渲染成彩色 emoji}
- 缺陷（用户反馈）：小红书页面的下载按钮箭头变成彩色 emoji 图标，不是原来的单色箭头
- 定位：
  - 字符本身没换过，一直是 `⬇`（U+2B07，Emoji_Presentation=Yes），自 v0.5.3 起未改
  - 按钮没设 `font-family`，继承站点正文：小红书 `<body>` 栈把 `"Apple Color Emoji"/"Segoe UI Emoji"/"Noto Color Emoji"` 排在 `system-ui` 之后，命中的 emoji 字体接管该码位 → 彩色；B站/抖音正文栈无 emoji 字体，故一直是单色
  - canvas 像素实测（13px×8）：旧栈 ink 13 689 / color 10 084；钉死纯文本栈 ink 1 301 / color 0
- 改动：
  - `src/kernel/ui.js`：新增 `FONT` 纯文本字体栈（`system-ui, Segoe UI, Roboto, PingFang SC, Microsoft YaHei, Segoe UI Symbol, Apple Symbols, Noto Sans Symbols 2, sans-serif`，不含任何 emoji 字体），详情与卡片两套按钮 `cssText` 与档位弹层容器都拼上（弹层原为 `system-ui,sans-serif`）；`textContent` 保持 `⬇` / `⬇ 下载`
  - 版本 0.11.0 → **0.11.1**；无 Mx.y 与验收判据变化
- 单测：`npm test` **75 pass / 0 fail**
- 真页收点（CDP 注入 0.11.1 等价构建，新旧按钮用 `data-old` 区分）：
  - 小红书 `/red_video`：20 张视频卡各出新按钮，`computed font-family` 为新栈；hover 揭示 → 新按钮 27.1×24.9 @1756,532、`elementFromPoint` 命中按钮本身；6 倍放大截图（`captureScreenshot` clip）为白色单色箭头
  - 字体对照探针（同一 canvas 五个栈 56px，页面截图）：旧小红书栈画彩色 emoji；旧 B站栈、新栈、`Segoe UI Symbol`、`Microsoft YaHei` 四者均为同形单色箭头 → 新栈与用户此前在 B站/抖音看到的箭头一致
  - B站详情页 `BV1ecnb6oEnt`：注入后 `⬇ 下载` 按钮 78.7×35 @1081,184，`font-family` 为新栈；放大截图为白色单色箭头 + 「下载」
  - B站首页卡片：注入后点开档位弹层，`computed font-family` 为新栈，4 行 `⬇ 高清 1080P 画面（无音轨）/ 高清 1080P 音频 / 高清 720P / 流畅 360P`，截图 `H:/temp/menu-mono.png` 箭头全为单色
- 构建：`npm run build` → `dist/douyin.user.js` **52 661 B**，`@version 0.11.1`，sha256 `c591d0b0…7fd8`
- 未覆盖：macOS 下的 `Apple Symbols` / `Noto Sans Symbols 2` 兜底未实测；小红书登录态丢失后无法复验卡片点击（未登录时卡片无令牌，点按钮不出菜单，与本次改动无关）；按钮宽度因去掉 emoji 宽字形而略窄（27.1 vs 37.9，详情 78.7 vs 91）

## v0.11.0 ✅ {spec §M8 · 小红书平台接入}
- 需求：继续增加小红书（M8.1 详情页 / M8.2 卡片页 / M8.3 直链现取）
- 调研（未登录真页 + 页面状态实证）：
  - 发现页 `/explore`：30 张 `.note-item`，视频卡带 `.play-icon`；卡片 `data-note-id` + `a.cover` 链接里的 `xsec_token`
  - 详情页 `/explore/<24位id>?xsec_token=...` 与旧路径 `/discovery/item/<id>`；从卡片点开是盖在发现页上的 `#noteContainer`（`.player-container` > `.xgplayer` > `video`），xgplayer 控制条都在底部
  - 档位：`__INITIAL_STATE__.note.noteDetailMap[id].note.video.media.stream` 按编码分组（EF4/EF5/EF6/EF7，部分为空），条目含 `width/height/avgBitrate/masterUrl/streamDesc`；EF4 为 H.264、EF5 常带更高档
  - 卡片页没有档位，只有 id 与令牌：`GET /explore/<id>?xsec_token=<token>` 返回的 HTML 里内联同一份状态；不带令牌服务端回「页面不见了」
  - CDN：`sns-video-v4.xhscdn.com` 签名直链，`credentials: omit` 可用；部分笔记下发 `http://`，https 页面上 fetch 会被混合内容拦截，同签名换 https 返回 `206 video/mp4`
  - 访客态会被登录弹层（`.login-container` 等）盖住播放器，hover 揭示失效；移除弹层后一切正常（测试环境行为，不是代码问题）
- 改动：
  - 新增 `src/platforms/xiaohongshu/rules.js` / `adapter.js`（命名统一 `xhs` 前缀）
  - `src/entry/tm.js` 与 `tools/build.mjs`：接入第三份 adapter，`@match` 并入 `*://www.xiaohongshu.com/*`，`@description` 加小红书
  - 详情：`xhsRefresh` 遍历 `noteDetailMap` 写 store；锚点 `#noteContainer` 挂 `.player-container`（跟随右侧面板收窄），`pos {top:12,right:12}`
  - 卡片：`xhsStub` 从 DOM 取标题/作者与令牌并记住 → `prefetch/loadItem` 用令牌取笔记页 HTML → `xhsStateFromHtml` 解析（裸 `undefined/NaN` 兜底）
  - 直链：点选时按 id/令牌重取；`xhsBuildStreams` 把 `http://` 升 `https://`；文件名 `作者_标题_<label>.mp4`
  - 版本 0.10.2 → **0.11.0**
- 单测：`npm test` **75 pass / 0 fail**（新增 `tests/xiaohongshu.test.mjs` 22 例）
- 真页收点（用户 Chrome CDP，未登录，注入等价构建）：
  - 详情页 `6ac31b54…`：`{candidates:1, anchors:12, mounted:12, downloadable:1}`；按钮 91×37 @ (936,44)，播放器 (441,32,599,799)，右/顶间距均 12；菜单 `[1080p, 720p]`；点选后 CDN 请求带签名、无 Cookie，Range `206 / video/mp4 / ftyp`
  - 发现页 `/explore`：30 张卡中 12 张视频卡全部挂按钮（图文卡 0）；hover 后 `candidates 0→1 / downloadable 0→1`；按钮 38×25 @ (898,237)（卡片右缩进 8）；菜单 `[1080p, 720p]`
  - 卡片点选 `1080p`：请求为 `https://sns-video-v4.xhscdn.com/...sign=...`，传输 **139 056 187 B**（http 直链版本实测 `Failed to fetch`，升 https 后成功）
- 构建：`npm run build` → `dist/douyin.user.js` **52 283 B**，`@version 0.11.0`，sha256 `4e871e84…1e03`
- 发版：`gh release create v0.11.0`（资产 `douyin.user.js` + `video-downloader-v0.5.3.crx` + `.zip`）；固定别名拉取 `200`、52 283 B、`@version 0.11.0`，sha256 与本地 `dist/` 全等
- 未覆盖：搜索页 `/search_result` 与个人主页需登录，本轮未验证；图文笔记不注入（设计如此）

## 快道 v0.10.2 ✅ {spec §7 · 对照 M7.1 详情按钮位置}
- 缺陷（用户真页反馈）：B站详情页下载按钮固定在播放器右下（`right:16px; bottom:16px`），压住底部控制条（全屏/网页全屏等）；要求移到右上、站内「反馈」按钮左侧
- 调研（`BV1ecnb6oEnt` 真页，播放器 `.bpx-player-video-area` 968×545 @248,172）：
  - 站内反馈按钮 `.bpx-player-top-issue`：36×24 @1168,190（右缩进 12、顶缩进 18），位于 `.bpx-player-top-wrap` 内，控制条淡出时一起隐藏
  - 原按钮 85×35 @1115,666（右/底各 16），正好压在底部控制条右端
- 改动：
  - `src/kernel/ui.js`：`createButton` 增加 `pos`（只收 `top/right/bottom/left` 数字 px），详情按钮缺省仍 `right:16;bottom:16`
  - `src/kernel/core.js`：把 `rule.pos` 透传给 `createButton`
  - `src/platforms/bilibili/rules.js`：详情锚点 `pos: { top: 12, right: 56 }`
  - `docs/spec.md`：§2.2 `AnchorRule` 增加 `pos?`；M7.1 验收与算法描述同步新位置
  - 版本 0.10.1 → **0.10.2**；抖音详情按钮不受影响（未配 `pos`，仍右下）
- 单测：`npm test` **56 pass / 0 fail**（`biliRules` 用例增加详情 `pos` 断言）
- 真页收点（登录态，注入 0.10.2 等价构建，新旧按钮用 `data-old` 区分）：
  - 新按钮 85×35 @1075,184（右缘 1160）→ 与反馈按钮（左缘 1168）间距 8px，纵向 184–219 vs 190–214 居中；底部控制条不再遮挡
  - 点击新按钮出菜单 `[1080P 画面、1080P 音频、720P、360P]`，与改动前一致
  - 同一页面旧实例按钮仍在右下 @1115,666，reload 后仅保留单实例
- 构建：`npm run build` → `dist/douyin.user.js` **40 812 B**，`@version 0.10.2`，sha256 `8f8c13a1…b1e`
- 发版：`gh release create v0.10.2`（资产 `douyin.user.js` + `video-downloader-v0.5.3.crx` + `.zip`）；`releases/latest` → `v0.10.2`；固定别名拉取 `200`、40 812 B、`@version 0.10.2`，sha256 与本地 `dist/` 全等
- 未覆盖：站内顶部控制条淡出时本站按钮仍常驻（有意为之）；全屏/网页全屏未单独回归（位置随四边内缩，不变）

## 快道 v0.10.1 ✅ {spec §7 · 对照 M7.4 卡片注入 / M3.2 按钮样式}
- 缺陷（用户真页反馈，首页推荐流两张卡）：
  - 「虽然被推到烂，但还是想夸一夸的邪修脱单群」无按钮：该卡是广告型推荐，`href` 是 `cm.bilibili.com/cm/api/fees/pc/sync/v2?msg=…` 埋点，真实目标 `https://www.bilibili.com/video/BV15KWJzWEAo?...` 只在锚点的 `data-target-url` 属性上；`biliCardBvid` 只查 `a[href*="/video/BV"]`，取不到 id 自然不挂
  - 「【秋叶ComfyUI教程】…」按钮变形：站点 CSS 有 `[title^="「"], [title^="『"], [title^="【"] { text-indent:-.6em }`，我们的按钮带 `title`（视频标题）且以「【」开头被命中，shrink-to-fit 宽度从 33 缩到 25.2（`text-indent:-7.8px`，-0.6em × 13px）
- 改动：
  - `src/platforms/bilibili/rules.js`：`biliCardBvid` 遍历 `a[href], a[data-target-url]` 两个属性，命中首个 `/video/BV…`
  - `src/kernel/ui.js`：详情与卡片两套按钮 `cssText` 加 `text-indent:0`，抵消站点按 `[title]` 设置的行内缩进
  - `tests/bilibili.test.mjs`：`fakeCard` 改提供 `querySelectorAll`；新增广告卡 `data-target-url` 取 BV / 非 B站目标不取 两例
  - 版本 0.10.0 → **0.10.1**；无 Mx.y 与验收判据变化（无 BV 目标的广告卡仍不注入）
- 单测：`npm test` **56 pass / 0 fail**
- 真页收点（用户 Chrome CDP，登录态，首页，注入等价构建；注入前给旧按钮打 `data-old` 区分）：
  - 广告卡「邪修脱单群」：修复前 0 按钮 → 修复后 1 按钮 33×29.5、`text-indent:0px`；hover 正常揭示；点击出菜单 `[1080P 画面、1080P 音频、720P、360P]`（`BV15KWJzWEAo` 的 view + 两路 playurl 成功）
  - 秋叶卡「BV1ecnb6oEnt」：旧实例按钮 25.2×29.5（`text-indent:-7.8px`），新构建按钮 33×29.5（`text-indent:0px`）；点击菜单 4 档、标题正常截断
  - 覆盖：首页 36 张 `.bili-video-card` 中 22 张挂上新按钮，其余 14 张为无链接无文字的骨架占位（非视频），符合预期
- 构建：`npm run build` → `dist/douyin.user.js` **40 266 B**，`@version 0.10.1`，sha256 `f54328e1…777`
- 发版：`gh release create v0.10.1`（资产 `douyin.user.js` + `video-downloader-v0.5.3.crx` + `.zip`）；`releases/latest` → `v0.10.1`；固定别名拉取 `200`、40 266 B、`@version 0.10.1`，sha256 与本地 `dist/` 全等
- 未覆盖：广告卡的非 B站目标（电商/外链）仍不注入；按钮仍会带原生 `title` 提示，站点后续若新增其它按 `[title]` 生效的规则需再核对

## v0.10.0 ✅ {spec §M7.4 · B站卡片页按钮注入}
- 需求：确认下载链接不依赖播放页；首页 / 热门 / 排行 / 搜索 / 详情页推荐位可直接出按钮与档位（用户确认范围；多分P卡片默认只下 P1）
- 调研（登录态真页 + 接口实证）：
  - 卡片只要 bvid：`x/web-interface/view?bvid=` 返回 `pages[0].cid`、`title`、`owner.name`；随后两路 `playurl` 与详情页完全相同（`fnval=1` 低档 + `fnval=4048` DASH 高档），`credentials: include`，在 www 与 search 源上均可用
  - DOM 结构：首页/搜索 `.bili-video-card`（309×249）、热门 `.video-card`（638×116，缩略图 `.video-card__content` 206×116）、排行 `.rank-item`（缩略图 `.img` 206×116）、详情页推荐位 `.video-page-card-small`（411×107，缩略图 `.pic` 189×107）
  - 搜索页 42 张卡里 3 张是广告（只含 `cm.bilibili.com` 跳转、无 `/video/BV`），自然跳过；卡片右上角有站内「稍后再看」，按钮与之重叠会挡住该控件
  - 性能：批量 `view` 13 次 227 ms 全 `code 0`；冷点击包含 3 个请求，首页/热门实测 1s 左右
- 改动：
  - `src/platforms/bilibili/rules.js`：`matches` 扩到 `www.bilibili.com/*` 与 `search.bilibili.com/*`；新增 `biliCardBvid` / `biliCardTitle`；新增 4 条卡片锚点（`.bili-video-card` / `.video-card` / `.rank-item` / `.video-page-card-small`），`iconRight: 44` 让开「稍后再看」
  - `src/platforms/bilibili/adapter.js`：`biliLoadCard(bvid, store)`（view → 两路 playurl → 解析 → upsert，`cardPending` 并发去重）；`biliStub` 占位条目；`biliPrefetch`；`biliRefresh` 在非 `/video/` 路径直接返回；`biliParsePlayurl` 的 `videoId` 支持外部传入（卡片用 bvid）
  - kernel：`createButton` 支持 `onOpen`（点击时异步取条目）与 `iconRight`（列表按钮右偏移）；`renderAll` 支持 `adapter.stub` 占位挂载；锚点 `mouseenter` 调 `adapter.prefetch`
  - 版本 0.9.0 → **0.10.0**
- 单测：`npm test` **55 pass / 0 fail**（新增 15 例：BV 提取/标题链/4 条规则与 iconRight、`biliLoadCard` 三请求+缓存+并发去重+失败可重试、prefetch、stub、契约）
- 真页收点（用户 Chrome CDP，登录态，注入等价构建）：
  - 首页：8/8 卡片出按钮；hover 触发 `view?bvid` + `fnval=1` + `fnval=4048`；冷点击菜单 4 行；360P 落盘 **5 771 802 B**、文件名正常
  - 热门：20/20；冷点击 1353 ms 出菜单（4 行）
  - 排行（`/v/popular/rank/all`）：100 个 `.rank-item` → 100 个按钮；hover 预取 3 请求；菜单 4 行
  - 搜索：42 张卡 → 39–40 个按钮（广告卡跳过，随机波动为卡片加载）；按钮 x 579–612、站内「稍后再看」x 620–648，两者不重叠且都可点；单击出菜单 4 行
  - 详情页推荐位：20/20；hover 预取后单击出菜单 4 行；360P 落盘 **10 178 574 B**、toast `✓ 下载完成`（字节数用页面内内存 writer 桩观测，收点后 reload 复原原生 picker）
  - 详情页播放器按钮回归：菜单仍为 1080P 画面/音频/720P/360P 四行
  - 期间发现并修正：`iconRight` 让位前按钮压住「稍后再看」，且重叠区点击会先被站内控件吃掉
- 构建：`npm run build` → `dist/douyin.user.js` **39 927 B（39.0 KB）**，`node --check` 通过，头 `@version 0.10.0`、`@match` 三条
- 发版：`gh release create v0.10.0`（资产 `douyin.user.js` + `video-downloader-v0.5.3.crx` + `.zip`）；`releases/latest` → `v0.10.0`；固定别名拉取 `200`、39 927 B、`@version 0.10.0`，sha256 `89a12605…547` 与 GitHub 资产 digest 及本地 `dist/` 全等
- 未覆盖：卡片页拿不到分P列表，多分P只下 P1；广告卡不注入；1080P 合流仍走待定项 #3

## v0.9.0 ✅ {spec §M7.3 · B站 DASH 分离流档位}
- 需求：现代视频单文件接口（`fnval=1`）上限 720P，1080P 只在 DASH；先提供「画面 / 音频」两条分流链接，合流留给下载后处理队列（待定项 #3）
- 调研（登录态真页 + 接口实证）：`BV1JYsd6sE4k` 登录且 `vip=0` → `fnval=1` 仅 `[64,16]`；`fnval=4048` 的 `accept_quality` 为 `[112,80,64,32,16]`，`dash.video` 实际档位 `[80,64,32,16]`（112 为大会员锁定），`dash.audio` 为 `[30280,30216,30232]`。`credentials: include` 与 `omit` 对 `fnval=1` 结果一致 → 此前「登录后档位不对」不是 cookie 问题，是单文件通道本身只有低档
- 改动：
  - `src/platforms/bilibili/adapter.js`：`biliPlayurlUrl(meta, qn, fnval=1)`；新增 `buildBiliDashStreams`（只补 `qn >` 单文件最高档，每档「画面（无音轨）」+「音频」两条）；`biliParsePlayurl(data, meta, dashData?)` 合并两路；`biliResolveDownload` 按 `stream.kind` 走 `fnval=4048`，画面优先 `codecid=7`（AVC）、音频优先标准 AAC（30216/30232/30280）取最高码率；`biliFilename` 扩展名按 kind 取 `.mp4`/`.m4a`；`biliRefresh` 并发取两路，各自失败隔离
  - 版本 0.8.0 → **0.9.0**；README / prd / spec 同步「分流下载 + 合流后置」
- 单测：`npm test` **46 pass / 0 fail**（新增：只补高于单文件档、已含同档不重复、AVC 优先、AAC 最高码率、缺档报错、refresh 两路并发）
- 真页收点（用户 Chrome CDP，登录态，注入等价构建）：
  - 菜单 `BV1JYsd6sE4k`：`⬇ 高清 1080P 画面（无音轨）` / `⬇ 高清 1080P 音频` / `⬇ 高清 720P` / `⬇ 流畅 360P`，1080P 两条排在 720P 之上
  - 直链取证：1080P AVC `baseUrl` 带 `Range: bytes=0-1023` → `206`，`content-range: bytes 0-1023/83 276 924`
  - 音频全量：点「1080P 音频」→ 落盘 **5 211 414 B**，`close` 成功、无 abort；文件名 `…_高清 1080P 音频.m4a`
  - 画面全量：换 `BV1sqxP69Ebq` 点「1080P 画面（无音轨）」→ 落盘 **18 821 824 B**，`close` 成功、无 abort；文件名 `…_高清 1080P 画面（无音轨）.mp4`
  - 观察字节数时把 `showSaveFilePicker` 换成内存 writer（页面内测试桩），收点后删除测试桩并 reload 复原原生保存对话框
  - 抖音回归：`__dlStats` 与按钮数正常（kernel 未改动）
- 登录依赖复核（同一视频同一时刻，`fnval=4048` 对比 `credentials`）：`include` → `dash.video` 含 `80`；`omit`（无 cookie）→ 仅 `[32,16]`，接口仍「承认」`accept_quality` 有 80 但不发流。即 1080P **档位**需登录（非会员即可），1080P+（112）需大会员；菜单按实际 `dash.video` 档位补，未登录不会出现死链行
- 直链独立性：取登录态生成的 1080P AVC `baseUrl`，用 Node 裸请求（无任何 cookie）带 `Range` + `Referer: https://www.bilibili.com/` → `206`、`content-range: bytes 0-1023/83 276 924`；不带 `Referer` → `403`（CDN 防盗链）。URL 自带 `deadline` 签名（约 2 小时），下载路径 `credentials: "omit"` 可行
- 构建：`npm run build` → `dist/douyin.user.js` **33 569 B（30.7 KB）**，`node --check` 通过，头 `@version 0.9.0`
- 发版：`gh release create v0.9.0`（资产 `douyin.user.js` + `video-downloader-v0.5.3.crx` + `.zip`）；`releases/latest` → `v0.9.0`；固定别名拉取 `200`、33 569 B、`@version 0.9.0`，sha256 `aac0417a…050` 与 GitHub 资产 digest 及本地 `dist/` 全等
- 未覆盖：合流未做（待定项 #3）；大会员档（qn 112）不可达是平台策略；分段单文件视频仍拒

## v0.8.0 ✅ {spec §M7 · B站详情页}
- 需求：B 站播放页（`/video/BV...`）无水印下载，先做详情页；B 站以长视频为主
- 调研（真页 CDP + 源码/接口实证）：
  - 清晰度不在 DOM、不在 `__playinfo__`（首屏 SSR，切 P 后不更新）；以顶层 `__INITIAL_STATE__.p/.cid` 为准（`videoData.cid` 恒为第 1P）
  - 旧版 `api.bilibili.com/x/player/playurl?...&fnval=1&qn=127`（`credentials: include`）返回单文件 `durl[]` 与真实的 `accept_quality/accept_description`；DASH（`fnval=4048`）音视频分离，浏览器内无法合并
  - 档位上限随账号/视频变化（未登录常见 720P 上限，登录/VIP 提高），所以档位表必须从接口取，不能写死
  - 长视频单文件实测 3,482,563,020 B（4 小时），blob 会整份驻留内存
- 改动：
  - 新增 `src/platforms/bilibili/{rules,adapter}.js`：`readBiliPage`、`biliPlayurlUrl`、`buildBiliStreams`、`biliResolveDownload`（点选现取直链）、`biliFilename`（多分P含 `P<n> <分P名>`）、`biliRefresh`（每 cid 一次，失败 5s 不重试）
  - kernel：`adapter.refresh` 定时钩子；`resolveDownload` 允许返回 Promise；`adapter.filename`；`streamToDisk`（`showSaveFilePicker` 先同步弹、再等直链 Promise，逐块写盘）
  - `src/entry/tm.js` 按 `matches` 选 adapter；`tools/build.mjs` 合并两平台 `@match`、ORDER 加 B站两文件；产物名/更新别名不变
  - 版本 0.7.3 → **0.8.0**
- 单测：`npm test` **40 pass / 0 fail**（新增 `tests/bilibili.test.mjs` 10 例；`tests/download.test.mjs` 增 Promise 计划、落盘字节、picker 取消三例）
- 真页收点（CDP 长连接，注入等价构建）：
  - 详情页播放器右下出 ⬇ 下载；hover 揭示正常；弹层档位 `[1080P, 720P, 360P]`（当前账号可达上限）
  - 选取后保存对话框 → 落盘 **2,350,008 B**，与服务端 `content-range` 总长全等；CDN 响应 `206 video/mp4`
  - 多分P：P3 → P1 后菜单与文件名跟随当前 P（标题/分P名/档位）
  - 抖音回归：`__dlStats` 与按钮数正常（kernel 改动未破坏原平台）
  - 收点后停掉本地注入服务并 reload；`addScriptToEvaluateOnNewDocument` 在本次 Chrome 生命周期内仍存在但资源不可达，重启 Chrome 后彻底清除
- 构建：`npm run build` → `dist/douyin.user.js` **29,899 B（27.5 KB）**，`node --check` 通过，头含 `0.8.0` + 两条 `@match`
- 发版：`gh release create v0.8.0`（资产 `douyin.user.js` + `video-downloader-v0.5.3.crx` + `.zip`）；`gh release download` 拉回哈希 `5e18c1be…4b6` 与本地 `dist/` 全等，`@version 0.8.0`；`releases/latest` 指向 `v0.8.0`
- 未覆盖：B站搜索页/个人主页/番剧/直播未接；DASH 专属档位与分段视频（`durl.length > 1`）明确提示不支持；未登录下的档位上限是平台策略，非提取缺陷

## 快道 v0.7.3 ✅ {spec §7 · 对照 M3.1 锚点挂载}
- 问题：播放页自动跳转后右侧列表按钮消失——页面重渲染把外来的按钮节点清掉，而 `renderedIds` 只记 `videoId`，判定「已挂载」后不再补
- 现场：收藏页弹层 42 个 `[data-e2e="author-card-list"] li` 全部带 `data-dl-hover`（说明挂过），但 `li [data-dl-icon]` = 0
- 改动：`src/kernel/core.js` `renderedIds` 值改存 `{ videoId, btn }`，跳过条件加 `btn.isConnected`；仅 id 变化才清旧按钮
- 证据（真页 CDP，注入新构建）：79 个条目 79/79 有按钮；手动删掉全部 100 个按钮模拟重绘 → 2.5s 内恢复 82 个、条目仍 79/79；再等 5s 计数不增长（无抖动）
- 单测：`npm test` 28 pass / 0 fail
- 版本：0.7.2 → 0.7.3
- 发版：`gh release create v0.7.3`；资产 `douyin.user.js` 22 124 B，GitHub 侧 `digest` = 本地 sha256（`ce9e4296…e93`）；`gh release download` 拉回的文件 `@version 0.7.3` 且哈希一致。本机到 github.com 的裸 `curl` 当时超时（网络抖动），改用 API 通道取证

## 快道 v0.7.2 ✅ {spec §7 · 对照 M3.2 hover 揭示}
- 问题：按钮「延迟出现」——揭示靠挂载时绑 `mouseenter`；挂载那一刻指针若已停在卡片/播放器上，浏览器不再补发 `mouseenter`，按钮保持 `display:none`，必须移出再移入
- 改动：`src/kernel/ui.js` 注入 `[data-dl-hover]:hover>[data-dl-icon]{display:block!important}`；`src/kernel/core.js` 在挂载锚点上打 `data-dl-hover`，删掉 mouseenter/mouseleave 监听（子元素用 `>` 限定，避免宿主内嵌套卡片的按钮被连带显示）
- 证据（真页 CDP，指针在挂载前就停在视频/卡片上、全程不动）：详情页 4 个按钮 `computed=block` / `inline=none`；首页 49 个宿主中 2 个被 hover 各显示 1 个（其中宿主内含 4 个按钮，只显示自己的）；指针移开 → `visible=0`
- 单测：`npm test` 28 pass / 0 fail
- 版本：0.7.1 → 0.7.2
- 发版：`gh release create v0.7.2`；别名 `latest/download/douyin.user.js` → `200`、21 839 B、`@version 0.7.2`，sha256 与本地 `dist/` 全等（`c8392391…815`）
- 另：挂载本身仍需等数据（SSR ≈0.5s / 网络响应 / 作者列表 fiber 源每 2s），这部分是数据到达时间，非揭示缺陷

## 快道 v0.7.1 ✅ {spec §7 · 对照 M3.1 详情页按钮挂载}
- 问题：右侧「作者作品」面板展开后主视频下载按钮不移动——按钮挂在整屏宽滑动容器上（`right:16px` → 右缘 1904），播放器随面板收窄到 1371，按钮整块压在面板下面
- 改动：`src/platforms/douyin/rules.js` 详情弹层规则 `mount` 增加 `.douyin-player-video-container` / `.basePlayerContainer`，`self` 降为兜底
- 证据（真页 CDP，用户 Chrome inspect 长连接，注入新构建）：面板开 → `basePlayerContainer` 1371 宽、按钮 `1271–1355`；面板关 → 1920 宽、按钮 `1820–1904`；截图确认按钮位于播放器右下、面板左侧
- 单测：`npm test` 28 pass / 0 fail（新增 `pickAnchor` 选播放器容器、详情规则 mount 顺序两例）
- 版本：0.7.0 → 0.7.1
- 发版：`gh release create v0.7.1`（脚本 + 插件 v0.5.3 的 `.crx`/`.zip`）；别名 `latest/download/douyin.user.js` → `200`、21 355 B、`@version 0.7.1`，sha256 与本地 `dist/` 全等（`fa509cfe…371`）

## 分发 v0.7.0 ✅ 已发版  {spec §M6.1 分发字段 + 待定项 #1 已定案}
- 版本：`package.json` 0.6.0 → **0.7.0**（M3.3 为新功能，走 minor），构建头版本只来自 `package.json`
- 更新源：`tools/build.mjs` 新增常量 `UPDATE_URL`，头里写 `@updateURL`/`@downloadURL`，同指 `https://github.com/bsawang/video-downloader/releases/latest/download/douyin.user.js`

### 证据（本轮实跑）
- `npm run build` → `dist/douyin.user.js` 20.0 KB；`node --check` 通过；头为 `@version 0.7.0` + `@updateURL` + `@downloadURL`
- `npm test` → 26 pass / 0 fail
- `git push origin main` → `1e484eb..8a94fe0`
- `gh release create v0.7.0` → https://github.com/bsawang/video-downloader/releases/tag/v0.7.0；资产 `douyin.user.js` 21 155 B、`video-downloader-v0.5.3.crx`、`video-downloader-v0.5.3.zip`；`gh api .../releases/latest` → `v0.7.0`（插件安装包仍可从 Releases 取）
- 固定别名 `curl -sL .../releases/latest/download/douyin.user.js` → `200`、21 155 B，sha256 与本地 `dist/douyin.user.js` 全等（`eccc6a16…c03c`）

### 待办
- 从本地文件 / 拖拽安装的旧脚本没有更新源，需从固定别名链接重装一次才进入自动更新轨道（同名同 `@namespace` 会显示「更新」）

## 批次 2 ✅ 已归档  {spec §M3.3}
覆盖：M3.3 → 详情弹层「作者作品」列表锚点 + DOM(fiber) 数据源
依赖序：M3.1（锚点扫描与挂载）→ M1.2（多源调度，新增 domSources）
档位：标准档（新增子需求，模块边界不变）

### 证据（收点时实跑）
- **M3.3（单测）** `npm test` 26 pass / 0 fail：`tests/rules.test.mjs` 伪造 fiber 链测 `readFiberAwemeId`（命中 / 无 fiber / 链上无 `awemeInfo`）+ 第 6 条规则为函数式 `idFrom`；`tests/mount.test.mjs` 函数式 `idFrom`、同目标去重、`resolve` 挂载、`pickAnchor(['self'])`；`tests/fiber.test.mjs` `fiberToRaw → parse`（`1080p/720p/540p`）、无 bitRateList 回落 `默认`、`scanDomSources` 去重不重复通知、单源抛错隔离、`douyin-fiber` 源读卡片。
- **M3.3（真页 CDP，用户自己的 Chrome，inspect 长连接）** `https://www.douyin.com/jingxuan?modal_id=7698318940266581258`，点左下用户名展开右侧列表：`[data-e2e="author-card-list"] li` = 45，`li [data-dl-icon]` = 45（每条恰 1 个），按钮 `title` 为卡片标题。
- **M3.3（弹层与链路）** 点按钮弹 `data-dl-pop`：标题 = 卡片标题，行 `⬇ 1080p / ⬇ 720p / ⬇ 540p`；对卡片 fiber 的 `bitRateList[0]` 直链做 `fetch(url,{credentials:'omit',Range:'bytes=0-1023'})` → `206`、`video/mp4`、`content-range: bytes 0-1023/35144309`。
- **M3.3（数据来源判定）** 打开 `__DL_DEBUG` 观测：`[dl] domSource douyin-fiber items 1 changed 0`——fiber 源每 2s 扫到条目且不重复写入；同一时刻网络源对 `/aweme/v1/web/danmaku|mcs.zijieapi` 等响应 `items 0`，说明该列表数据不在 fetch/XHR 响应里（页面把接口数据归一化成 camelCase 塞进组件树）。
- **构建** `npm run build` → `dist/douyin.user.js` 19.8 KB；`node --check` 通过。

### 未覆盖说明
- 真页端到端是**注入等价构建**跑的（本地 HTTP 提供 `dist/douyin.user.js` + `Page.addScriptToEvaluateOnNewDocument`），因为用户装的 TM 脚本仍是旧产物；测试期间浏览器里旧 TM 脚本与新注入脚本并存，列表按钮只可能由新代码产出（旧产物无第 6 条规则与 `douyin-fiber` 源）。收点后已 `Page.removeScriptToEvaluateOnNewDocument` + reload 复原。**用户需重装 `dist/douyin.user.js` 才能在日常浏览里看到该列表按钮。**
- 右侧面板在窄布局/未点入口时不进 DOM，`li` 数量会从 0 变 45；DOM 源随面板出现后的下一轮（≤2s）补齐。


## 批次 1 ✅ 已归档  {prd §M1–M6 + spec §M1.1–M6.2}
覆盖：M6.2 → M1.1 → M1.2 → M1.3 → M2.1 → M2.2 → M3.1 → M3.2 → M4.1 → M4.2 → M5.1 → M6.1
依赖序：M6.2（基准）先于重构；其余按需求树拓扑序
守则：行为等价，不新增功能

### 证据（收点时实跑）
- **M6.2** 基准 1：`npm test` 12 pass / 0 fail，3 份 fixture 与 legacy oracle 深比较一致。基准 2：真页 `https://www.douyin.com/video/7666780213276190857`，标题与清晰度集合 `1080p/720p/540p` 与 `spikes/out/run_20260801_163730_plugin/result.json` 一致；作者由基线 `@金珍妮安利站` 变为 `绝缘ᵀ`（页面内已无旧昵称，属平台昵称变更，非提取差异）。
- **M1.1** `tests/extract.test.mjs`：3 fixture oracle 等价 + `parseLooseJSON` 帧/整体解析 + `normalizeQuality` 顺序 + `sortStreams`。
- **M1.2** `spikes/verify_dom.py`：fetch/XHR/SSR 三源入 store（`[dl] source network items 5 /api/feed`、`… /api/xhr`、SSR 空 url 两条）；perf 兜底产出 `[dl] fallback 666 …`，`stats.fallback=1`。
- **M1.3** `tests/store.test.mjs`：同 id 覆盖、size 不变、空 id 拒写、onChange。
- **M2.1** `tests/extract.test.mjs`：`adapt_lowest_4_1` → null、`normal_1080_0` → `1080p`、`pay_bvc1_hdr_1080_0` → `1080p`（与 `tests/fixtures/legacy.mjs:46` 数字优先顺序一致）；真页三档输出。
- **M2.2** `tests/download.test.mjs`：`credentials: "omit"`、文件名 `a_b_1080p.mp4`、进度 toast、HTTP 404、异常路径。真页点 540p 落盘 2 998 572 B，文件名 `绝缘ᵀ_<标题>_540p.mp4`，toast `✓ 下载完成`。
- **M3.1** `spikes/verify_dom.py`：5 条规则各命中（`mediaSrc` 2 个：候选 + 兜底），`anchors=7 / mounted=7`；静态根卡片挂到 `.videoImage`、个人主页卡片挂到内部视频链接。
- **M3.2** `spikes/verify_dom.py`：hover 前 6 个按钮 `display:none`、hover 后 `block`；popover 三档、点外部关闭。真页 toast 2.5s 自动消失（`toast_auto_dismissed: true`）。
- **M4.1** `grep -rniE "douyin|aweme|douyinvod|waterfall|scroll-list|__vid|抖音" src/kernel/` → 0 行；`tools/probe.mjs` 与 `tools/build.mjs` 同引 `douyinAdapter`。
- **M4.2** oracle 深比较（`collect` 走 `adapter.isVideo` + `adapter.parse`）三份 fixture 全等。
- **M5.1** `node tools/probe.mjs --url <详情页> --port 9333` → `{candidates:11, anchors:2, mounted:2, downloadable:11, sources:[{network, reachableInPage:true}]}`，与 Playwright 注入同页 `__dlStats` 完全一致。
- **M6.1** `npm run build` → `dist/douyin.user.js` 17 771 B；`node --check` 通过；头含 `@name/@version/@match/@run-at/@grant none`，版本取 `package.json` 0.6.0。

### 未覆盖说明
- 搜索页 / 个人主页真页未做等价对照：`spikes/login-profile` 当前无登录态（搜索页弹登录框），改用本地 DOM 夹具（`spikes/verify_dom.py`）复刻结构验证规则。补齐方法：登录后跑 `spikes/verify_tm.py <搜索页或个人主页URL> --profile spikes/login-profile --headed`。
