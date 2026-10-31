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
