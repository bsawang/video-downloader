# 短视频下载器

抖音、B站、小红书、YouTube 视频**无水印下载**浏览器插件（无后端，页面内直接下载）。

覆盖抖音首页 / 频道栏目 / 搜索结果（多列 + 单列大视频流）/ 视频详情页 / **个人主页（作品/喜欢/收藏三 tab）**，**B站首页 / 热门 / 排行 / 搜索结果 / 视频详情页（含多分P与右侧推荐位）**，小红书发现页 / 笔记详情（含弹层），以及 **YouTube 播放页 / Shorts / 首页 / 搜索结果 / 相关推荐 / Shorts 货架**，全站统一"视频上 hover 出下载按钮 → 弹清晰度菜单 → 下载"（YouTube 卡片按钮常显，hover 预览播放时也可点）。

## 支持方式与平台

**方式**（产品形态）：

| 方式 | 状态 |
|---|---|
| **extension**（浏览器插件） | ✅ 可用（TM 用户脚本为主） |
| **web**（网页版，浏览器打开即用，无需装插件） | ⏳ 规划中 |

**平台**（内容网站）：

| 平台 | 状态 | 范围 |
|---|---|---|
| **抖音** | ✅ 支持 | 首页 / 搜索 / 详情 / 个人主页 / 作者作品列表 |
| **B站** | ✅ 支持 | 首页 / 热门 / 排行 / 搜索 / 详情页（含多分P、右侧推荐位） |
| **小红书** | ✅ 支持 | 发现页卡片 / 笔记详情（含播放弹层、`/red_video` 栏目） |
| **YouTube** | ✅ 支持 | 播放页 / Shorts / 首页 / 搜索结果 / 相关推荐 / Shorts 货架 |

**环境要求**（extension 版）：

| 项 | 说明 |
|---|---|
| 浏览器 | Chrome / Edge（Chromium 内核）**111+**；Firefox / Safari 未适配 |
| 系统 | Windows / macOS / Linux（跨平台） |
| 登录 | 建议已登录抖音；B站清晰度上限跟随账号（未登录常见 720P，登录/VIP 更高） |

## 下载安装

**方式一：安装包（推荐，给使用者）**

从 [Releases](./releases) 下载最新 `video-downloader-v*.crx`：

1. 打开 `chrome://extensions`（Edge 用 `edge://extensions`）
2. 右上角开启**开发者模式**
3. 把 **.crx 文件拖进浏览器窗口** → 提示安装 → 确认
4. 打开抖音（建议已登录）

> 也可用 `.zip`：解压 → chrome://extensions → **加载已解压的扩展程序** → 选解压目录。

**方式二：源码加载（给开发者）**

```bash
git clone https://github.com/bsawang/video-downloader.git
# chrome://extensions → 开启开发者模式 → 加载已解压 → 选 extension/ 目录
```

## Tampermonkey 版（阶段 0，重构中）

单文件 Tampermonkey 用户脚本（`@grant none`），行为与 extension 0.5.3 等价，现已覆盖抖音全站、B站卡片页/详情页、小红书发现页/笔记详情与 YouTube 播放页/Shorts/列表卡片。

安装（推荐，装完自动更新）：

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)，Chrome 138+ 需在扩展页开启**允许用户脚本**
2. 浏览器打开 [releases/latest/download/douyin.user.js](https://github.com/bsawang/video-downloader/releases/latest/download/douyin.user.js) → TM 弹出安装页 → 安装
3. 打开抖音、B站、小红书或 YouTube 视频页，交互一致

脚本头带 `@updateURL`/`@downloadURL`（同指上面的固定链接），TM 会在后台按设置周期检查更新；也可在 TM 面板点「检查用户脚本更新」立即拉取。**通过本地文件安装或拖入安装的脚本没有更新源，需要改从上面的链接安装一次。**

开发者本地构建：

```bash
npm run build     # src/** → dist/douyin.user.js
npm test          # node --test，含 legacy oracle 等价用例
```

发版（让使用者的 TM 自动更新到新版本）：`npm run build` 后新建 release，把 `dist/douyin.user.js` 作为**同名资产**上传——脚本头的 URL 是 `releases/latest/download/douyin.user.js` 固定别名，不需要改动。

> 平台差异集中在 `src/platforms/<平台>/`（当前抖音、B站、小红书、YouTube），通用能力在 `src/kernel/`；设计见 [docs/spec.md](./docs/spec.md)。

## 使用

| 操作 | 说明 |
|---|---|
| 鼠标移到视频卡片 / 播放器 | 出现 **⬇** 图标（列表）或 **⬇ 下载**（播放器） |
| 点击图标 | 弹出清晰度菜单（档位来自平台，按清晰度降序） |
| 选择清晰度 | 无水印下载，文件名 `作者_标题_清晰度.mp4` |
| 底部 toast | 显示下载进度 / 完成 / 失败 |

### B站说明

- **档位跟随账号**：菜单里是当前账号在该视频上真实可下载的档位（未登录常见 720P 上限，登录/VIP 更高）。1080P 需要登录（非会员即可），1080P+ 需要大会员。
- **1080P 及以上**：现代视频的单文件接口只到 720P，更高档位 B站只提供分离流。脚本会把同一档位的画面与标准 AAC 音轨**无损合并成一个 MP4**（只搬箱、不转码），保存对话框只弹一次，菜单里也只有这一条、不再另列音频；没有音轨时退回单条「画面（无音轨）」。档位本身要登录才能拿到，但拿到后的直链是 CDN 签名地址，下载时不依赖 cookie（签名约 2 小时过期，所以点选时才现取）。
- **多分P**：切换分P后按钮菜单会自动跟随，文件名带 `P<n> <分P名>`。
- **卡片页（首页 / 热门 / 排行 / 搜索 / 详情页推荐位）**：卡片上 hover 出 ⬇，按钮让开右上角的「稍后再看」。首次悬停会预取该视频信息与档位，通常点开即出菜单；未预取就点是现取，需等 1s 左右（toast 提示「正在获取清晰度…」）。卡片页拿不到分P信息，**多分P视频默认只下 P1**；广告卡（无 BV 链接）不注入。
- **长视频保存**：点选清晰度后会先弹浏览器**保存对话框**（File System Access），文件边下边写盘；取消对话框即取消下载。合并档会先把画面/音轨写到 OPFS 临时文件，合并完成后自动清理。不支持该 API 的浏览器会回落到内存下载，超长视频可能失败。

### YouTube 说明

- **档位来源**：页面内联的播放器数据已只下发 SABR（没有逐档直链），菜单里的档位是打开页面后由脚本调用同源 `youtubei/v1/player` 现取的：`ANDROID_VR` 优先，被风控（提示「Sign in to confirm you're not a bot」）时自动换 `IOS` 重试。
- **档位形态**：单文件 `360p`（含音轨）来自 `ANDROID_VR`；`720p` 及以上的自适应画面流若同时有 MP4 画面与 AAC 音轨，会**无损合并成一个 MP4**后在菜单里只列一条（如 `1080p`），保存对话框只弹一次，不再另列音频；WebM/VP9 或没有 AAC 音轨时该档仍拆成「画面（无音轨）」，此时菜单才附一条「音频 <kbps>kbps」（AAC `.m4a`）供自行补齐。同分辨率优先 H.264。
- **版权限制**：部分音乐 / MV 类视频只对登录态客户端开放，脚本会提示「该视频需要登录或年龄验证」或「YouTube 要求人机验证，请先在浏览器打开该视频后再试」。
- **下载链路**：点选时按当前视频重取新直链（带 `Range: bytes=0-`，`googlevideo` 返回 206），并在直链自带的候选节点（`mn`）里探一个可达的再下载；个别 CDN 节点在部分网络下连不上时，重试一次通常会换到可用节点。
- **保存方式**：点选后先弹浏览器**保存对话框**（File System Access），边下边写盘；4K 单档可达数百 MB，不会整份驻留内存。合并档的画面/音轨先落 OPFS 临时文件，合并完成后自动清理。
- **卡片**：首页 / 搜索 / 相关推荐里带 `/watch?v=` 的卡片按钮**常显**（右上 8px）；频道、播放列表等非视频卡片不注入。卡片 hover 触发的预览是覆盖在缩略图上的全局层，按钮常显才能保持可点；卡片页不做 hover 预取，点开时先提示「正在获取清晰度…」再出菜单。
- **Shorts**：`/shorts/<id>` 播放页在竖屏播放器右上 12px 出「⬇ 下载」，档位与接口一致；首页 Shorts 货架的卡片按钮常显在缩略图右上 8px（该货架容器带 `transform`，按钮挂在页面级浮层上，预览播放时仍可点）；滑动切换 Short 后按钮跟随地址栏 id 更新。

详细说明见 [extension/README.md](extension/README.md)。

## 构建安装包

```bash
.venv/Scripts/python build.py   # 生成 dist/video-downloader-v*.crx 和 .zip
```

## 目录结构

```
extension/          插件本体（MV3，加载/打包用这个目录）
  content/main.v05.js      页面世界：通用视频提取 + 下载
  content/isolated.v055.js 隔离世界：多锚点匹配 + hover 按钮 + 清晰度菜单
build.py           打包脚本（生成 .crx / .zip 安装文件）
spikes/            开发/测试工具（登录、搜索、常驻浏览器会话式测试）
docs/WORKLOG.md    工作日志（技术发现、避坑、规划）
```

## 技术要点

- **通用视频提取**：hook 所有 fetch/XHR，`text()` 逐行解析（兼容流式帧），递归找 `aweme_id + video.bit_rate`
- **多锚点匹配**：`[data-aweme-id]` / `[id^="waterfall_item_"]` / `[class*="video_"]` / video 直链 `__vid` / 个人主页 `ul[data-e2e="scroll-list"] > li` 内 `a[href*="/video/{id}"]`，不依赖页面混淆 class
- **无水印下载**：页面内 `fetch(url, { credentials: "omit" })` → blob → `<a download>`（CDN 的 `ACAO:*` 与 include 不兼容，必须 omit）
