# 在线短视频下载工具 — 设计文档

日期：2026-08-01
状态：已确认设计，待实施

## 1. 背景与目标

做一个自研解析的短视频下载工具。用户粘贴平台分享链接，工具解析出无水印的多路清晰度源，用户选择清晰度后下载为完整 MP4。

**核心目标**：所有平台解析**全部自研**，不依赖 yt-dlp 等外部下载引擎；清晰度可选、无水印。

**发布定位**：第一步本地 Web 工具（自用），后续自用部署，远期可能加浏览器插件。无账号、无限流、无防滥用需求。

## 2. 需求画像

| 维度 | 结论 |
|------|------|
| 产品 | 在线短视频下载工具 |
| 目标平台 | 抖音（首发）→ 快手/小红书/B站/YouTube/TikTok（陆续接入） |
| 形态 | 本地 Web（第一版）→ 自用部署 → 浏览器插件（远期） |
| 解析 | 全部自研，零外部下载引擎依赖 |
| 技术栈 | Python 3.11+ / FastAPI / httpx / ffmpeg（按需）/ 原生 JS 前端 |
| 功能 | 清晰度选择 + 无水印 |
| 第一版流程 | 粘贴链接 → 解析 → 选清晰度 → 下载 |
| 首发平台 | 抖音 |
| 发布 | 自用部署，保持简单 |

## 3. 架构总览

**模块化单体**（方案 A）。一个 FastAPI 后端 + 多种前端壳（Web / 插件 / CLI），前端只调同一个 HTTP API。

```
┌─────────────────────────────────────────────────────────┐
│  后端（Python + FastAPI）★ 所有重活在这里                │
│  ┌────────────┐  ┌────────────┐  ┌───────────────────┐ │
│  │ providers/ │  │ core/      │  │ app.py            │ │
│  │ 平台解析层  │→ │ 下载/ffmpeg│  │ HTTP API 层       │ │
│  │ 抖音/B站…   │  │ 任务/模型  │  │ /api/parse        │ │
│  └────────────┘  └────────────┘  │ /api/download      │ │
│                                  └───────────────────┘ │
└─────────────────────────────────────────┬───────────────┘
                                          │ HTTP API（唯一的门）
                    ┌─────────────────────┼─────────────┐
                    ▼                     ▼             ▼
             Web 端（本地/部署）   插件端（远期）      CLI（远期）
```

解析逻辑必须在后端的理由：防盗链、签名、Cookie 需要服务端环境；浏览器/插件受跨域与 CSP 限制，无法抓取第三方页面。

## 4. 目录结构

```
video-downloader/
├── app.py                    # FastAPI 入口，启动 + 路由挂载
├── config.py                 # 配置（下载目录、端口、ffmpeg 路径等）
├── core/
│   ├── registry.py           # 平台 provider 注册表（URL 识别 → 路由到 provider）
│   ├── downloader.py         # 流式下载器：直链下载、进度上报、重试
│   ├── ffmpeg_tool.py        # ffmpeg 封装：音视频合成（-c copy，按需调用）
│   ├── task.py               # 任务状态机 + 内存任务存储
│   └── models.py             # 统一数据结构（VideoInfo, Stream, DownloadTask）
├── providers/
│   ├── base.py               # Provider 抽象基类 + 统一错误类型
│   ├── douyin.py             # 抖音解析器
│   ├── bilibili.py           # B站（占位，后续）
│   └── ...                   # 快手/小红书/YouTube（后续逐个加）
├── web/                      # 前端静态资源（HTML/CSS/JS）
├── downloads/                # 下载文件落盘目录（gitignore）
└── tests/
    ├── fixtures/             # 录制好的页面/接口样本（离线测试用）
    ├── test_douyin.py        # 抖音解析器单测
    ├── test_downloader.py    # 下载器测试
    ├── test_ffmpeg_tool.py   # ffmpeg 合成测试
    ├── test_api.py           # API 全链路测试
    └── test_registry.py      # 注册表路由测试
```

## 5. 核心接口约定（平台适配器标准插槽）

```python
# core/models.py
class VideoInfo:
    provider: str              # "douyin"
    video_id: str
    title: str
    author: str
    cover_url: str
    streams: list[Stream]

class Stream:
    quality_label: str         # "标清/高清/超清/原画" 或 "360/720/1080"
    url: str                   # 无水印直链
    is_muxed: bool             # True=单文件合成版；False=需 ffmpeg 合成
    audio_url: str | None

# providers/base.py
class Provider(ABC):
    host_match: tuple[str, ...]     # 匹配域名，如 ("douyin.com", "iesdouyin.com")
    def parse(self, url: str) -> VideoInfo: ...        # 解析链接 → 元信息+流
    def resolve_streams(self, video_id: str) -> list[Stream]: ...  # 重取直链（URL 过期兜底）

# 统一错误类型
class ProviderError(Exception):
    kind: str   # "network" | "blocked" | "not_found" | "invalid_url"
    message: str
```

**每平台适配器必须输出统一错误语义**，前端据此给准确提示：

| 场景 | kind | 前端提示 |
|---|---|---|
| 网络抖动/超时 | network | "网络异常，可重试" |
| 403 风控 | blocked | "被风控，稍后再试" |
| 视频删除/私密 | not_found | "视频不存在或已下架" |
| 非单个视频链接 | invalid_url | "不是有效的单个视频链接" |

## 6. 抖音解析器设计（providers/douyin.py）

### 解析链路

```
① 用户粘贴短链  https://v.douyin.com/AbC123x/
   → httpx.Client 跟随 302 重定向，path 取 aweme_id
② 抓视频页 HTML（浏览器 UA），Client 自动捕获页面 Cookie
③ 从 HTML 提取 window._ROUTER_DATA JSON
   → loaderData → item_list[0]（完整视频对象）
④ 提取：desc / author.nickname / video.cover.url_list
        / video.bit_rate[]（gear_name + play_addr.url_list）
        / video.play_addr（默认无水印源）
⑤ 返回 VideoInfo + streams[]
```

### 防盗链对抗（下载直链时）

| 关卡 | 平台校验 | 对策 |
|---|---|---|
| Referer | CDN 要求 `Referer: https://www.douyin.com/` | 下载时固定带 |
| User-Agent | 非浏览器 UA 拒绝 | 全程统一浏览器 UA |
| Cookie | 部分直链要求页面 Cookie | 同会话复用（httpx.Client 自动管理） |

关键：**解析 + 下载共用同一个 httpx.Client 会话**（自动 Cookie/重定向/头管理），不每次新建。

### 无水印

- 优先取 `play_addr` 源（播放源本身无水印）。
- 遇 `/playwm/` 带水印路径，替换 `/playwm/` → `/play/` 兜底（小样本实测确认）。

### 是否需 ffmpeg

- 抖音 web 端多数清晰度为**单文件合成 MP4**，直接下载即可。
- 保留 `is_muxed=False` 合成通道兜底音视频分离的源。
- **实现时用真实视频验证哪些清晰度是分离的**。

### Spike 验证点（Phase 1 开始前）

1. `_ROUTER_DATA` 在当前抖音 web 端的字段路径是否仍成立（平台改版频繁）。
2. 各清晰度是否单文件合成（决定 ffmpeg 是否成强依赖）。
3. 哪些直链必须带 Cookie（决定会话复用严格程度）。

## 7. 下载器与任务管理

### 下载器（core/downloader.py）

| 设计点 | 做法 |
|---|---|
| 流式下载 | httpx 按 chunk 写入，不整块读内存 |
| 临时文件 | 先写 `xxx.mp4.part`，完成改名（避免半成品伪装成品） |
| 重试 | 网络抖动自动重试 2~3 次（指数退避）；403 不重试 |
| 断点续传 | 第一版不做，预留 Range header 支持位 |
| ffmpeg | `is_muxed=False` 时走 `ffmpeg -c copy` 合成后落盘 |
| 命名 | `{作者}_{标题}_{清晰度}.mp4`，清洗 `\ / : * ? " < > |` 等非法字符 |

### 任务状态机（core/task.py）

```
pending → downloading → done ──→ 文件可在 /api/files/ 获取
                 │
                 └── error（含错误分类）
```

- 存储：内存 dict（自用重启丢失可接受），已完成文件在磁盘持久。
- 并发：线程池最多 1~2 个并发下载任务，其余排队。
- URL 过期：解析结果内存缓存 10 分钟（按 video_id），过期则下载时重取直链。
- 进度：下载线程写回字节数，前端轮询 `/api/task/{id}`。

## 8. API 定义（第一版全量，全平台通用）

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/api/parse` `{url}` | 解析 → 返回标题/作者/封面/清晰度列表 |
| POST | `/api/download` `{video_id, stream_index}` | 创建下载任务 → 返回 `task_id` |
| GET | `/api/task/{task_id}` | 轮询状态 + 进度百分比 |
| GET | `/api/files` | downloads/ 目录文件清单 |
| GET | `/api/files/{file_name}` | 下载成品 |
| GET | `/` | 前端页面 |

插件端/CLI 端原样复用上述 API。

## 9. 前端设计（第一版）

**技术**：纯 HTML + CSS + JS，FastAPI 静态托管，零构建步骤，不引框架。

**单页布局**：输入框+解析按钮 → 视频卡片（封面/标题/作者/清晰度下拉/下载按钮/进度条）→ 已下载列表。

**交互**：
```
粘贴链接 → [解析] → POST /api/parse → 渲染卡片
选清晰度 → [下载] → POST /api/download → 1s 轮询 /api/task/{id} → 进度条
进度100% → [下载]按钮 → /api/files/{name} 保存到本地
```

**要点**：
- 进度轮询（1s），不做 WebSocket/SSE。
- 已下载列表：GET /api/files 展示 downloads/ 内容。
- 错误提示：卡片位置红色提示条显示后端错误文案。
- 支持深色模式（CSS 变量）。
- **前端核心逻辑（卡片渲染/清晰度选择/进度条）封装为独立 JS 组件**，为插件端复用预留。

## 10. 浏览器插件（远期路线）

插件端是第三种前端壳，复用同一后端 API。第一版不实现，但前端按可复用标准组织。

- 形态：内容脚本注入页面浮层（视频页原位"下载"按钮）+ 点击弹出 Shadow DOM 隔离面板（清晰度下拉/进度条）。
- 通信：content script → chrome.runtime.sendMessage → background service worker → fetch 后端 API。
- 隔离：面板用 Shadow DOM 防止被宿主页面 CSS 污染。
- 复用：面板 UI = Web 前端组件 + 新壳。

## 11. 测试策略

核心思想：**不依赖线上网络也能测**；平台改版时快速定位问题 provider。

| 测试对象 | 方法 |
|---|---|
| 抖音解析器 | 真实页面 `_ROUTER_DATA` 存为离线 fixture，单测喂 fixture；`@pytest.mark.network` 线上冒烟默认跳过 |
| 下载器 | mock httpx：流式写入、.part 改名、403 不重试/超时重试 |
| ffmpeg 合成 | 迷你音视频样例验证 `-c copy` |
| API 层 | FastAPI TestClient + mock provider 全链路 |
| 注册表 | 不同平台 URL 路由正确 provider |

平台改版应对：抓新页面 → 更新 fixture → 看测试红哪里 → 修适配器。

## 12. 实施路线图

```
Phase 0  骨架搭建   目录/config/registry/base.py/models.py + FastAPI 空壳
Phase 1  抖音解析器 短链解析 → _ROUTER_DATA → streams 多路清晰度
                   ★ spike：真实视频验证字段路径 + 音视频分离情况
Phase 2  下载核心   下载器 + ffmpeg 通道 + 任务管理 + 5 个 API（见第 8 节）
Phase 3  前端联调   单页 + 静态托管 + 解析→下载→完成 全流程
Phase 4  收尾测试   fixture 单测补全 + 一键启动脚本 + README
```

**验收标准（第一版完成 = ）**：
1. 粘贴抖音短链 → 卡片显示标题/作者/封面/清晰度
2. 选超清 → 下载 → 进度条 → 得到无水印、声音正常的 MP4
3. 错误场景有准确提示（无效链接/视频下架/风控）
4. 新增平台只需加 provider 文件 + 注册，不动其余代码

## 13. 明确不做（YAGNI）

- 多视频排队界面 / 批量导入
- 历史任务持久化（刷新即清）
- 登录/账号/限流/防滥用
- 直播下载
- 格式转换（仅合成，不转码）
- 断点续传（第一版）
- 插件端（远期再实现，但前端预留组件化）

## 14. 风险与对策

| 风险 | 对策 |
|---|---|
| 抖音平台改版导致解析失效 | 适配器隔离 + fixture 测试锁定行为，快速定位 |
| 全部自研维护成本高 | 平台逐个接入，按需扩展；共享核心只写一次 |
| CDN 直链带时效 | 解析后立即下载 + 10 分钟缓存 + 过期重取 |
| 高清源音视频分离 | ffmpeg `-c copy` 按需合成，成本极低 |
