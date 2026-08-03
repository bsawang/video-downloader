# 短视频下载器

抖音视频**无水印下载**浏览器插件（无后端，页面内直接下载）。

覆盖首页 / 频道栏目 / 搜索结果（多列 + 单列大视频流）/ 视频详情页 / **个人主页（作品/喜欢/收藏三 tab）**，全站统一"视频上 hover 出下载按钮 → 弹清晰度菜单 → 下载"。

## 支持方式与平台

**方式**（产品形态）：

| 方式 | 状态 |
|---|---|
| **extension**（浏览器插件） | ✅ 可用（当前版本） |
| **web**（网页版，浏览器打开即用，无需装插件） | ⏳ 规划中 |

**平台**（内容网站）：

| 平台 | 状态 |
|---|---|
| **抖音** | ✅ 支持 |
| 小红书 | ⏳ 规划 |
| B站 | ⏳ 规划 |
| YouTube | ⏳ 规划 |

**环境要求**（extension 版）：

| 项 | 说明 |
|---|---|
| 浏览器 | Chrome / Edge（Chromium 内核）**111+**；Firefox / Safari 未适配 |
| 系统 | Windows / macOS / Linux（跨平台） |
| 登录 | 建议已登录抖音（未登录部分页面无数据可下载） |

## 下载安装

**方式一：安装包（推荐，给使用者）**

从 [Releases](../../releases) 下载最新 `video-downloader-v*.crx`：

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

## 使用

| 操作 | 说明 |
|---|---|
| 鼠标移到视频卡片 / 播放器 | 出现 **⬇** 图标（列表）或 **⬇ 下载**（播放器） |
| 点击图标 | 弹出清晰度菜单（1440p / 1080p / 720p / 540p） |
| 选择清晰度 | 无水印下载，文件名 `作者_标题_清晰度.mp4` |
| 底部 toast | 显示下载进度 / 完成 / 失败 |

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
