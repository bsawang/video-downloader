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
