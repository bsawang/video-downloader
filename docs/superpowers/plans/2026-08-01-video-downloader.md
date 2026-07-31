# 短视频下载工具实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个自研解析的短视频下载工具：粘贴抖音分享链接 → 解析出无水印多路清晰度 → 选清晰度下载为完整 MP4，提供本地 Web 界面。

**Architecture:** Python 模块化单体。FastAPI 后端暴露统一 HTTP API（parse/download/task/files），平台适配器插件式注册（首发抖音），下载核心流式下载 + ffmpeg 按需合成，前端为纯 HTML/CSS/JS 单页，由 FastAPI 静态托管。

**Tech Stack:** Python 3.12 / FastAPI / httpx / pytest / 原生 JS（零构建）

## Global Constraints

- Python 3.11+（环境为 3.12.10）
- **全部自研解析，不依赖 yt-dlp 等外部下载引擎**
- ffmpeg 为可选依赖：仅 `is_muxed=False` 的音视频分离源需要，`-c copy` 合成
- 前端零构建步骤（纯 HTML/CSS/JS，不引框架/打包器）
- 统一错误语义 `kind`：`network` / `blocked` / `not_found` / `invalid_url`
- 下载文件名必须经 `sanitize_filename` 清洗非法字符
- Windows 平台，shell 为 Git Bash；Python 命令用 `.venv/Scripts/python`
- 每个平台适配器独立文件，平台挂掉不影响其他平台

---

### Task 1: 项目骨架与配置

**Files:**
- Create: `requirements.txt`
- Create: `.gitignore`
- Create: `pytest.ini`
- Create: `config.py`
- Create: `core/__init__.py`
- Create: `providers/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`
- Create: `downloads/.gitkeep`

**Interfaces:**
- Produces: `config.py` 提供 `BASE_DIR / DOWNLOAD_DIR / HOST / PORT / FFMPEG_PATH / DOWNLOAD_REFERER`，供后续所有任务引用。

- [ ] **Step 1: 创建虚拟环境并安装依赖**

```bash
cd "e:/work/ai/video-downloader"
python -m venv .venv
.venv/Scripts/python -m pip install -U pip
```

- [ ] **Step 2: 写 requirements.txt**

```text
fastapi>=0.110
uvicorn[standard]>=0.29
httpx>=0.27
pytest>=8.0
```

- [ ] **Step 3: 安装依赖**

Run: `.venv/Scripts/python -m pip install -r requirements.txt`
Expected: 安装成功，无报错。

- [ ] **Step 4: 写 .gitignore**

```gitignore
.venv/
__pycache__/
*.pyc
downloads/*
!downloads/.gitkeep
```

- [ ] **Step 5: 写 pytest.ini**

```ini
[pytest]
testpaths = tests
```

- [ ] **Step 6: 写 config.py**

```python
"""全局配置。"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DOWNLOAD_DIR = BASE_DIR / "downloads"

HOST = "127.0.0.1"
PORT = 8000

# ffmpeg 可执行文件路径；未安装时仅影响音视频分离源的合成
FFMPEG_PATH = os.environ.get("FFMPEG_PATH", "ffmpeg")

# 每个平台的下载 Referer 头（防盗链用）
DOWNLOAD_REFERER: dict[str, str] = {
    "douyin": "https://www.douyin.com/",
}
```

- [ ] **Step 7: 创建空包文件**

创建 `core/__init__.py`、`providers/__init__.py`、`tests/__init__.py`、`downloads/.gitkeep`（空文件即可）。

- [ ] **Step 8: 写 tests/conftest.py（让测试能 import 项目模块）**

```python
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
```

- [ ] **Step 9: 验证 import 可用**

Run: `.venv/Scripts/python -c "import config; print(config.DOWNLOAD_DIR)"`
Expected: 打印 `e:\work\ai\video-downloader\downloads`。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: 项目骨架与配置"
```

---

### Task 2: 基础类型 — 统一错误 + 数据模型

**Files:**
- Create: `core/errors.py`
- Create: `core/models.py`
- Test: `tests/test_models.py`

**Interfaces:**
- Produces: `core/errors.AppError(kind, message)`、`ProviderError`、`DownloadError`；`core/models.Stream(quality_label, url, is_muxed=True, audio_url=None)`、`VideoInfo(provider, video_id, title, author, cover_url, streams)`、`DownloadTask(...)`。后续所有任务引用这些类型。

- [ ] **Step 1: 写失败的测试 tests/test_models.py**

```python
from core.errors import ProviderError, DownloadError
from core.models import Stream, VideoInfo, DownloadTask


def test_provider_error_kind():
    e = ProviderError("blocked", "被风控")
    assert e.kind == "blocked"
    assert e.message == "被风控"


def test_download_error_default_kind():
    e = DownloadError("网络异常")
    assert e.kind == "network"


def test_stream_defaults():
    s = Stream(quality_label="高清", url="http://x/v.mp4")
    assert s.is_muxed is True
    assert s.audio_url is None


def test_video_info_holds_streams():
    v = VideoInfo(provider="douyin", video_id="1", title="t",
                  author="a", cover_url="", streams=[])
    assert v.provider == "douyin"
    assert v.streams == []


def test_download_task_defaults():
    s = Stream(quality_label="高清", url="http://x/v.mp4")
    t = DownloadTask(task_id="abc", video_id="1", provider="douyin",
                     title="t", author="a", stream=s)
    assert t.status == "pending"
    assert t.progress == 0.0
    assert t.file_name is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.venv/Scripts/python -m pytest tests/test_models.py -v`
Expected: FAIL（ModuleNotFoundError: core.errors / core.models）。

- [ ] **Step 3: 写 core/errors.py**

```python
"""统一错误类型：所有平台/下载错误都用 kind 分类。"""


class AppError(Exception):
    """业务错误基类。kind 用于前端分类提示。"""

    kind = "unknown"

    def __init__(self, message: str, kind: str | None = None):
        self.message = message
        if kind:
            self.kind = kind
        super().__init__(message)


class ProviderError(AppError):
    """解析器错误：network / blocked / not_found / invalid_url。"""


class DownloadError(AppError):
    """下载器错误：network / blocked / not_found。"""
```

- [ ] **Step 4: 写 core/models.py**

```python
"""统一数据结构。"""
from dataclasses import dataclass, field


@dataclass
class Stream:
    quality_label: str
    url: str
    is_muxed: bool = True          # True=单文件合成版；False=需 ffmpeg 合成
    audio_url: str | None = None


@dataclass
class VideoInfo:
    provider: str
    video_id: str
    title: str
    author: str
    cover_url: str
    streams: list[Stream] = field(default_factory=list)


@dataclass
class DownloadTask:
    task_id: str
    video_id: str
    provider: str
    title: str
    author: str
    stream: Stream
    status: str = "pending"        # pending/downloading/done/error
    progress: float = 0.0          # 0-100
    file_name: str | None = None
    error: str | None = None
```

- [ ] **Step 5: 运行测试确认通过**

Run: `.venv/Scripts/python -m pytest tests/test_models.py -v`
Expected: PASS（6 passed）。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 统一错误类型与数据模型"
```

---

### Task 3: Provider 抽象基类

**Files:**
- Create: `providers/base.py`
- Test: `tests/test_base.py`

**Interfaces:**
- Produces: `providers.base.Provider` 抽象类，含 `host_match: tuple[str, ...]`、`name: str`、`parse(url) -> VideoInfo`、`resolve_streams(video_id) -> list[Stream]`。Task 4 注册表、Task 5 抖音适配器、Task 9 API 都依赖它。

- [ ] **Step 1: 写失败的测试 tests/test_base.py**

```python
import pytest
from providers.base import Provider


class DummyProvider(Provider):
    host_match = ("example.com",)
    name = "dummy"

    def parse(self, url):
        raise NotImplementedError

    def resolve_streams(self, video_id):
        raise NotImplementedError


def test_provider_is_abstract():
    with pytest.raises(TypeError):
        Provider()  # 抽象类不能实例化


def test_dummy_provider_registers():
    p = DummyProvider()
    assert p.host_match == ("example.com",)
    assert p.name == "dummy"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.venv/Scripts/python -m pytest tests/test_base.py -v`
Expected: FAIL（ModuleNotFoundError: providers.base）。

- [ ] **Step 3: 写 providers/base.py**

```python
"""平台适配器抽象基类。每个平台一个子类，实现 parse 与 resolve_streams。"""
from abc import ABC, abstractmethod

from core.models import Stream, VideoInfo


class Provider(ABC):
    """平台解析器基类。"""

    # 匹配的域名后缀，如 ("douyin.com", "iesdouyin.com")
    host_match: tuple[str, ...] = ()
    # 平台标识，如 "douyin"
    name: str = ""

    @abstractmethod
    def parse(self, url: str) -> VideoInfo:
        """解析分享链接，返回视频元信息与候选流。"""

    @abstractmethod
    def resolve_streams(self, video_id: str) -> list[Stream]:
        """重新获取指定视频的候选流（直链过期时兜底）。"""
```

- [ ] **Step 4: 运行测试确认通过**

Run: `.venv/Scripts/python -m pytest tests/test_base.py -v`
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Provider 抽象基类"
```

---

### Task 4: 平台注册表

**Files:**
- Create: `core/registry.py`
- Test: `tests/test_registry.py`

**Interfaces:**
- Consumes: `providers.base.Provider`、`core.errors.ProviderError`。
- Produces: `core.registry.Registry` 类，方法 `register(provider)`、`get_provider(name) -> Provider | None`、`get_provider_for_url(url) -> Provider`（不匹配抛 `ProviderError("invalid_url", ...)`）。Task 9 API 使用。

- [ ] **Step 1: 写失败的测试 tests/test_registry.py**

```python
import pytest
from core.errors import ProviderError
from core.registry import Registry
from providers.base import Provider


class DummyProvider(Provider):
    host_match = ("example.com", "example.org")
    name = "dummy"

    def parse(self, url):
        raise NotImplementedError

    def resolve_streams(self, video_id):
        raise NotImplementedError


def _registry():
    r = Registry()
    r.register(DummyProvider())
    return r


def test_match_host_suffix():
    r = _registry()
    assert r.get_provider_for_url("https://example.com/video/1").name == "dummy"
    assert r.get_provider_for_url("https://www.example.com/video/1").name == "dummy"
    assert r.get_provider_for_url("https://sub.example.org/x").name == "dummy"


def test_unknown_host():
    r = _registry()
    with pytest.raises(ProviderError) as ei:
        r.get_provider_for_url("https://unknown.com/video/1")
    assert ei.value.kind == "invalid_url"


def test_get_provider_by_name():
    r = _registry()
    assert r.get_provider("dummy") is not None
    assert r.get_provider("nope") is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.venv/Scripts/python -m pytest tests/test_registry.py -v`
Expected: FAIL（ModuleNotFoundError: core.registry）。

- [ ] **Step 3: 写 core/registry.py**

```python
"""平台注册表：URL → provider 的路由。"""
from urllib.parse import urlparse

from core.errors import ProviderError
from providers.base import Provider


class Registry:
    def __init__(self):
        self._providers: dict[str, Provider] = {}
        self._host_to_name: dict[str, str] = {}

    def register(self, provider: Provider) -> None:
        self._providers[provider.name] = provider
        for host in provider.host_match:
            self._host_to_name[host] = provider.name

    def get_provider(self, name: str) -> Provider | None:
        return self._providers.get(name)

    def get_provider_for_url(self, url: str) -> Provider:
        host = (urlparse(url).hostname or "").lower()
        for suffix, name in self._host_to_name.items():
            if host == suffix or host.endswith("." + suffix):
                return self._providers[name]
        raise ProviderError("invalid_url", "暂不支持该平台的链接")
```

- [ ] **Step 4: 运行测试确认通过**

Run: `.venv/Scripts/python -m pytest tests/test_registry.py -v`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 平台注册表"
```

---

### Task 5: 抖音解析器（核心交付物）

**Files:**
- Create: `providers/douyin.py`
- Create: `tests/fixtures/douyin_router_data.json`
- Test: `tests/test_douyin.py`

**Interfaces:**
- Consumes: `core.models.VideoInfo/Stream`、`core.errors.ProviderError`、`providers.base.Provider`。
- Produces: `providers.douyin.DouyinProvider`（`host_match=("douyin.com","iesdouyin.com")`, `name="douyin"`）。内部方法 `_resolve_video_id(url)`、`_fetch_router_data(video_id)`、`_extract_video_info(router_data)`、`_extract_streams(router_data)`、`_no_watermark(url)`，供测试直接调用。

- [ ] **Step 1: 写离线 fixture tests/fixtures/douyin_router_data.json**

基于抖音 web 端 `window._ROUTER_DATA` 的真实结构录制（字段路径以当前线上为准，spike 时若变化只改 fixture 与提取逻辑）：

```json
{
  "loaderData": {
    "video_(id)/page": {
      "videoInfoRes": {
        "item_list": [
          {
            "aweme_id": "7412345678901234567",
            "desc": "测试视频标题",
            "author": { "nickname": "测试作者" },
            "video": {
              "cover": { "url_list": ["https://p3.douyinpic.com/cover.jpg"] },
              "play_addr": { "url_list": ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=default"] },
              "bit_rate": [
                { "gear_name": "标清", "play_addr": { "url_list": ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=sd"] } },
                { "gear_name": "高清", "play_addr": { "url_list": ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=hd"] } },
                { "gear_name": "超清", "play_addr": { "url_list": ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=uhd"] } }
              ]
            }
          }
        ]
      }
    }
  }
}
```

- [ ] **Step 2: 写失败的测试 tests/test_douyin.py**

```python
import json
import pathlib

import pytest

from core.errors import ProviderError
from providers.douyin import DouyinProvider

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "douyin_router_data.json"


def _provider():
    return DouyinProvider()


def _load():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_extract_video_info():
    info = _provider()._extract_video_info(_load())
    assert info.video_id == "7412345678901234567"
    assert info.title == "测试视频标题"
    assert info.author == "测试作者"
    assert len(info.streams) == 3
    assert [s.quality_label for s in info.streams] == ["标清", "高清", "超清"]
    # 无水印：所有 url 不含 /playwm/
    assert all("/playwm/" not in s.url for s in info.streams)


def test_extract_empty_raises_not_found():
    with pytest.raises(ProviderError) as ei:
        _provider()._extract_video_info({"loaderData": {}})
    assert ei.value.kind == "not_found"


def test_no_watermark_trick():
    p = _provider()
    assert p._no_watermark("https://x.douyin.com/playwm/abc.mp4") == "https://x.douyin.com/play/abc.mp4"


def test_parse_with_mocked_network(monkeypatch):
    p = _provider()
    monkeypatch.setattr(p, "_resolve_video_id", lambda url: "7412345678901234567")
    monkeypatch.setattr(p, "_fetch_router_data", lambda vid: _load())
    info = p.parse("https://v.douyin.com/AbC123x/")
    assert info.provider == "douyin"
    assert info.title == "测试视频标题"
    assert len(info.streams) == 3


def test_resolve_streams_with_mocked_network(monkeypatch):
    p = _provider()
    monkeypatch.setattr(p, "_fetch_router_data", lambda vid: _load())
    streams = p.resolve_streams("7412345678901234567")
    assert [s.quality_label for s in streams] == ["标清", "高清", "超清"]
```

- [ ] **Step 3: 运行测试确认失败**

Run: `.venv/Scripts/python -m pytest tests/test_douyin.py -v`
Expected: FAIL（ModuleNotFoundError: providers.douyin）。

- [ ] **Step 4: 写 providers/douyin.py**

```python
"""抖音解析器：短链解析 → 视频页 _ROUTER_DATA → 多路无水印清晰度。"""
import json
import re

import httpx

from core.errors import ProviderError
from core.models import Stream, VideoInfo
from providers.base import Provider

# 统一浏览器 UA（防盗链三关之一）
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

VIDEO_URL = "https://www.douyin.com/video/{video_id}"


class DouyinProvider(Provider):
    host_match = ("douyin.com", "iesdouyin.com")
    name = "douyin"

    def __init__(self, client: httpx.Client | None = None):
        self._client = client

    def _get_client(self) -> httpx.Client:
        """解析+下载共用同一会话，自动复用 Cookie / 重定向 / 请求头。"""
        if self._client is None:
            self._client = httpx.Client(
                follow_redirects=True,
                headers={"User-Agent": UA},
                timeout=20.0,
            )
        return self._client

    def parse(self, url: str) -> VideoInfo:
        video_id = self._resolve_video_id(url)
        data = self._fetch_router_data(video_id)
        info = self._extract_video_info(data)
        if not info.video_id:
            info.video_id = video_id
        return info

    def resolve_streams(self, video_id: str) -> list[Stream]:
        data = self._fetch_router_data(video_id)
        return self._extract_streams(data)

    # ---- 网络部分 ----

    def _resolve_video_id(self, url: str) -> str:
        client = self._get_client()
        resp = client.get(url)
        final_url = str(resp.url)
        m = re.search(r"/video/(\d+)", final_url)
        if not m:
            raise ProviderError("invalid_url", "不是有效的单个视频链接")
        return m.group(1)

    def _fetch_router_data(self, video_id: str) -> dict:
        client = self._get_client()
        resp = client.get(VIDEO_URL.format(video_id=video_id))
        if resp.status_code == 403:
            raise ProviderError("blocked", "被风控，稍后再试")
        if resp.status_code != 200:
            raise ProviderError("network", f"获取视频页失败 HTTP {resp.status_code}")
        m = re.search(
            r"window\._ROUTER_DATA\s*=\s*(\{.*?\});?\s*</script>",
            resp.text,
            re.S,
        )
        if not m:
            raise ProviderError("blocked", "解析数据失败，可能被风控")
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            raise ProviderError("blocked", "解析数据失败，可能被风控")

    # ---- 纯提取逻辑（离线可测） ----

    def _extract_video_info(self, router_data: dict) -> VideoInfo:
        item = self._find_item(router_data)
        if not item:
            raise ProviderError("not_found", "视频不存在或已下架")
        video = item.get("video") or {}
        author = item.get("author") or {}
        cover = (video.get("cover") or {}).get("url_list") or [""]
        return VideoInfo(
            provider=self.name,
            video_id=str(item.get("aweme_id") or ""),
            title=item.get("desc") or "",
            author=author.get("nickname") or "",
            cover_url=cover[0],
            streams=self._extract_streams(router_data),
        )

    def _extract_streams(self, router_data: dict) -> list[Stream]:
        item = self._find_item(router_data)
        if not item:
            return []
        video = item.get("video") or {}
        streams: list[Stream] = []
        for br in video.get("bit_rate") or []:
            urls = ((br.get("play_addr") or {}).get("url_list")) or []
            if not urls:
                continue
            streams.append(Stream(
                quality_label=br.get("gear_name") or "未知",
                url=self._no_watermark(urls[0]),
                is_muxed=True,
            ))
        if not streams:
            urls = ((video.get("play_addr") or {}).get("url_list")) or []
            if urls:
                streams.append(Stream(
                    quality_label="默认",
                    url=self._no_watermark(urls[0]),
                    is_muxed=True,
                ))
        return streams

    def _find_item(self, node) -> dict | None:
        """递归搜索 item_list[0]，对 _ROUTER_DATA 键名变化有韧性。"""
        if isinstance(node, dict):
            item_list = node.get("item_list")
            if isinstance(item_list, list) and item_list and isinstance(item_list[0], dict):
                return item_list[0]
            for v in node.values():
                found = self._find_item(v)
                if found:
                    return found
        elif isinstance(node, list):
            for v in node:
                found = self._find_item(v)
                if found:
                    return found
        return None

    def _no_watermark(self, url: str) -> str:
        """playwm 路径 → play 路径，去水印兜底。"""
        return url.replace("/playwm/", "/play/")
```

- [ ] **Step 5: 运行测试确认通过**

Run: `.venv/Scripts/python -m pytest tests/test_douyin.py -v`
Expected: PASS（5 passed）。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 抖音解析器（短链+ROUTER_DATA+无水印多路清晰度）"
```

**★ Spike 记录（Task 5 完成后、Task 9 联调前必做）**：用真实抖音链接跑一次
`.venv/Scripts/python -m pytest tests/test_douyin.py -m network`（网络冒烟），现场确认：
1. `_ROUTER_DATA` 字段路径与 fixture 是否一致；不一致则更新 fixture 与提取逻辑。
2. 各清晰度是否单文件合成（决定 is_muxed 取值）。
3. 哪些直链必须带 Cookie（决定会话复用严格程度）。
若冒烟测试未建，先用临时脚本抓一个真实页面验证。

---

### Task 6: 下载器

**Files:**
- Create: `core/downloader.py`
- Test: `tests/test_downloader.py`

**Interfaces:**
- Consumes: `core.models.Stream`、`core.errors.DownloadError`、`core.ffmpeg_tool.mux_video_audio`（Task 7 提供，本任务先实现函数、测试暂时只测直接下载路径；若 ffmpeg_tool 未建，用 `from core.ffmpeg_tool import mux_video_audio` 会失败——因此**先做 Task 7 的 ffmpeg_tool 空实现再测 Task 6**，或本任务 Step 引入 import 前先创建空 `core/ffmpeg_tool.py`）。
- Produces: `core.downloader.sanitize_filename(name) -> str`、`download_stream(stream, dest_path, referer=None, progress_cb=None, client=None, max_retries=3, backoff_base=1.0) -> str`、`download_video(stream, dest_path, referer=None, progress_cb=None, client=None) -> str`。

- [ ] **Step 1: 先建 core/ffmpeg_tool.py 空实现（仅 mux_video_audio 签名，Task 7 补全）**

```python
"""ffmpeg 封装：音视频合成（Task 7 补全实现）。"""
from core.errors import DownloadError


def mux_video_audio(video_path: str, audio_path: str, out_path: str) -> str:
    raise DownloadError("network", "未找到 ffmpeg，无法合成音视频")
```

- [ ] **Step 2: 写失败的测试 tests/test_downloader.py**

```python
import time

import httpx
import pytest

from core.downloader import download_stream, download_video, sanitize_filename
from core.errors import DownloadError
from core.models import Stream


def test_sanitize_filename():
    assert sanitize_filename('a/b\\c:d*e?f"g<h>i|j') == "a_b_c_d_e_f_g_h_i_j"


def test_download_stream_success(tmp_path):
    content = b"x" * 10000

    def handler(request):
        assert request.headers.get("referer") == "https://www.douyin.com/"
        return httpx.Response(200, content=content)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    dest = tmp_path / "out.mp4"
    progress = []

    result = download_stream(
        Stream("高清", "https://example.com/v.mp4"),
        str(dest),
        referer="https://www.douyin.com/",
        client=client,
        progress_cb=lambda d, t: progress.append((d, t)),
    )
    assert result == str(dest)
    assert dest.read_bytes() == content
    assert not (tmp_path / "out.mp4.part").exists()
    assert progress[-1][0] == len(content)


def test_download_stream_403_raises_blocked(tmp_path):
    def handler(request):
        return httpx.Response(403)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(DownloadError) as ei:
        download_stream(Stream("高清", "https://example.com/v.mp4"),
                        str(tmp_path / "o.mp4"), client=client)
    assert ei.value.kind == "blocked"


def test_download_stream_retries_then_succeeds(tmp_path):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectError("boom", request=request)
        return httpx.Response(200, content=b"ok")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    dest = download_stream(Stream("高清", "https://example.com/v.mp4"),
                           str(tmp_path / "o.mp4"), client=client,
                           max_retries=3, backoff_base=0.0)
    assert calls["n"] == 3
    assert (tmp_path / "o.mp4").read_bytes() == b"ok"


def test_download_video_muxed_no_ffmpeg(tmp_path):
    # is_muxed=True：直接下载，不触发 ffmpeg
    def handler(request):
        return httpx.Response(200, content=b"data")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    dest = download_video(Stream("高清", "https://example.com/v.mp4", is_muxed=True),
                          str(tmp_path / "o.mp4"), client=client)
    assert (tmp_path / "o.mp4").read_bytes() == b"data"
```

- [ ] **Step 3: 运行测试确认失败**

Run: `.venv/Scripts/python -m pytest tests/test_downloader.py -v`
Expected: FAIL（ModuleNotFoundError: core.downloader）。

- [ ] **Step 4: 写 core/downloader.py**

```python
"""流式下载器：直链下载、进度上报、重试、音视频合成编排。"""
import os
import re
import time

import httpx

from core.errors import DownloadError
from core.ffmpeg_tool import mux_video_audio
from core.models import Stream


def sanitize_filename(name: str) -> str:
    """清洗文件名中的非法字符。"""
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()


def _download_once(stream: Stream, part_path: str, headers: dict,
                   progress_cb, client: httpx.Client | None) -> None:
    own = client is None
    c = client or httpx.Client(headers=headers, timeout=30.0, follow_redirects=True)
    try:
        with c.stream("GET", stream.url, headers=headers) as resp:
            if resp.status_code == 403:
                raise DownloadError("blocked", "下载被拦截（可能被风控）")
            if resp.status_code in (404, 410):
                raise DownloadError("not_found", "下载地址已失效")
            if resp.status_code != 200:
                raise DownloadError("network", f"下载失败 HTTP {resp.status_code}")
            total = int(resp.headers.get("content-length") or 0)
            downloaded = 0
            with open(part_path, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=262144):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if progress_cb:
                        progress_cb(downloaded, total)
    finally:
        if own:
            c.close()


def download_stream(stream: Stream, dest_path: str, referer: str | None = None,
                    progress_cb=None, client: httpx.Client | None = None,
                    max_retries: int = 3, backoff_base: float = 1.0) -> str:
    """流式下载到 dest_path（先写 .part，成功后改名）。"""
    headers = {}
    if referer:
        headers["Referer"] = referer
    part_path = dest_path + ".part"
    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            _download_once(stream, part_path, headers, progress_cb, client)
            os.replace(part_path, dest_path)
            return dest_path
        except DownloadError:
            raise
        except (httpx.HTTPError, OSError) as e:
            last_err = e
            if attempt < max_retries - 1:
                time.sleep(backoff_base * (2 ** attempt))
    raise DownloadError("network", f"网络异常：{last_err}")


def download_video(stream: Stream, dest_path: str, referer: str | None = None,
                   progress_cb=None, client: httpx.Client | None = None) -> str:
    """编排下载：单文件直下；音视频分离则分别下载后 ffmpeg 合成。"""
    if stream.is_muxed or not stream.audio_url:
        return download_stream(stream, dest_path, referer=referer,
                               progress_cb=progress_cb, client=client)
    video_path = dest_path + ".video"
    audio_path = dest_path + ".audio"
    try:
        download_stream(Stream("video", stream.url, True), video_path,
                        referer=referer, progress_cb=progress_cb, client=client)
        download_stream(Stream("audio", stream.audio_url, True), audio_path,
                        referer=referer, client=client)
        mux_video_audio(video_path, audio_path, dest_path)
    finally:
        for p in (video_path, audio_path):
            if os.path.exists(p):
                os.remove(p)
    return dest_path
```

- [ ] **Step 5: 运行测试确认通过**

Run: `.venv/Scripts/python -m pytest tests/test_downloader.py -v`
Expected: PASS（4 passed）。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 流式下载器（重试+进度+.part临时文件）"
```

---

### Task 7: ffmpeg 合成工具

**Files:**
- Modify: `core/ffmpeg_tool.py`（替换 Task 6 的空实现）
- Test: `tests/test_ffmpeg_tool.py`

**Interfaces:**
- Consumes: `config.FFMPEG_PATH`、`core.errors.DownloadError`。
- Produces: `core.ffmpeg_tool.mux_video_audio(video_path, audio_path, out_path) -> str`，用 `-c copy` 合成（不转码）。

- [ ] **Step 1: 写失败的测试 tests/test_ffmpeg_tool.py**

```python
import pathlib
import subprocess

from core import ffmpeg_tool


def test_mux_builds_copy_command(tmp_path, monkeypatch):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        pathlib.Path(cmd[-1]).write_bytes(b"muxed")
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(subprocess, "run", fake_run)
    v = tmp_path / "v.mp4"
    a = tmp_path / "a.m4a"
    v.write_bytes(b"v")
    a.write_bytes(b"a")

    out = ffmpeg_tool.mux_video_audio(str(v), str(a), str(tmp_path / "out.mp4"))
    assert pathlib.Path(out).exists()
    assert pathlib.Path(out).read_bytes() == b"muxed"
    assert "-c" in captured["cmd"]
    assert "copy" in captured["cmd"]


def test_mux_missing_ffmpeg_raises(tmp_path, monkeypatch):
    import config

    monkeypatch.setattr(config, "FFMPEG_PATH", "nonexistent-ffmpeg")
    v = tmp_path / "v.mp4"
    a = tmp_path / "a.m4a"
    v.write_bytes(b"v")
    a.write_bytes(b"a")
    try:
        ffmpeg_tool.mux_video_audio(str(v), str(a), str(tmp_path / "out.mp4"))
        raise AssertionError("应抛出 DownloadError")
    except Exception as e:
        assert e.__class__.__name__ == "DownloadError"
        assert "ffmpeg" in str(e)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.venv/Scripts/python -m pytest tests/test_ffmpeg_tool.py -v`
Expected: FAIL（当前空实现直接抛错，test_mux_builds_copy_command 失败）。

- [ ] **Step 3: 替换 core/ffmpeg_tool.py 完整实现**

```python
"""ffmpeg 封装：音视频合成（-c copy 直接拼接，不转码）。"""
import subprocess

import config
from core.errors import DownloadError


def mux_video_audio(video_path: str, audio_path: str, out_path: str) -> str:
    """把视频轨和音频轨合成进一个 MP4。"""
    cmd = [config.FFMPEG_PATH, "-y", "-i", video_path, "-i", audio_path,
           "-c", "copy", out_path]
    try:
        subprocess.run(cmd, capture_output=True, timeout=300, check=True)
    except FileNotFoundError:
        raise DownloadError("network", "未找到 ffmpeg，无法合成音视频")
    except subprocess.TimeoutExpired:
        raise DownloadError("network", "ffmpeg 合成超时")
    except subprocess.CalledProcessError:
        raise DownloadError("network", "ffmpeg 合成失败")
    return out_path
```

- [ ] **Step 4: 运行测试确认通过**

Run: `.venv/Scripts/python -m pytest tests/test_ffmpeg_tool.py -v`
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: ffmpeg 音视频合成（-c copy）"
```

---

### Task 8: 任务管理与流缓存

**Files:**
- Create: `core/task.py`
- Create: `core/stream_cache.py`
- Test: `tests/test_task.py`

**Interfaces:**
- Consumes: `core.models.DownloadTask/Stream`。
- Produces: `core.task.TaskManager(max_concurrent=2)`，方法 `create(video_id, provider, title, author, stream) -> DownloadTask`、`get(task_id) -> DownloadTask | None`、`submit(task, worker)`（后台线程执行，信号量限并发）。`core.stream_cache.StreamCache(ttl=600)`，方法 `get(key)`、`set(key, value)`。Task 9 API 使用。

- [ ] **Step 1: 写失败的测试 tests/test_task.py**

```python
import time

from core.models import Stream
from core.stream_cache import StreamCache
from core.task import TaskManager


def _stream():
    return Stream(quality_label="高清", url="http://x/v.mp4")


def test_create_and_get():
    tm = TaskManager()
    task = tm.create("1", "douyin", "t", "a", _stream())
    assert tm.get(task.task_id) is task
    assert task.status == "pending"
    assert tm.get("nope") is None


def test_submit_runs_worker():
    tm = TaskManager(max_concurrent=1)
    task = tm.create("1", "douyin", "t", "a", _stream())
    tm.submit(task, lambda t: setattr(t, "status", "done"))
    for _ in range(200):
        if task.status == "done":
            break
        time.sleep(0.01)
    assert task.status == "done"


def test_cache_set_get():
    c = StreamCache(ttl=600)
    c.set("k", {"a": 1})
    assert c.get("k") == {"a": 1}


def test_cache_expired():
    c = StreamCache(ttl=0.05)
    c.set("k", "v")
    time.sleep(0.08)
    assert c.get("k") is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.venv/Scripts/python -m pytest tests/test_task.py -v`
Expected: FAIL（ModuleNotFoundError: core.task / core.stream_cache）。

- [ ] **Step 3: 写 core/task.py**

```python
"""下载任务管理：内存存储 + 后台线程执行 + 信号量限并发。"""
import threading
import uuid

from core.models import DownloadTask, Stream


class TaskManager:
    def __init__(self, max_concurrent: int = 2):
        self._tasks: dict[str, DownloadTask] = {}
        self._lock = threading.Lock()
        self._sem = threading.Semaphore(max_concurrent)

    def create(self, video_id: str, provider: str, title: str, author: str,
               stream: Stream) -> DownloadTask:
        task = DownloadTask(
            task_id=uuid.uuid4().hex[:12],
            video_id=video_id,
            provider=provider,
            title=title,
            author=author,
            stream=stream,
        )
        with self._lock:
            self._tasks[task.task_id] = task
        return task

    def get(self, task_id: str) -> DownloadTask | None:
        with self._lock:
            return self._tasks.get(task_id)

    def submit(self, task: DownloadTask, worker) -> None:
        """后台线程执行 worker(task)。worker 负责更新 task.status。"""

        def run():
            with self._sem:
                try:
                    worker(task)
                except Exception:
                    with self._lock:
                        task.status = "error"
                        task.error = "任务执行异常"

        threading.Thread(target=run, daemon=True).start()
```

- [ ] **Step 4: 写 core/stream_cache.py**

```python
"""解析结果短时缓存（直链有时效，10 分钟默认）。"""
import threading
import time


class StreamCache:
    def __init__(self, ttl: float = 600.0):
        self._ttl = ttl
        self._data: dict[str, tuple[float, object]] = {}
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            item = self._data.get(key)
            if item and time.time() - item[0] < self._ttl:
                return item[1]
            return None

    def set(self, key: str, value) -> None:
        with self._lock:
            self._data[key] = (time.time(), value)
```

- [ ] **Step 5: 运行测试确认通过**

Run: `.venv/Scripts/python -m pytest tests/test_task.py -v`
Expected: PASS（4 passed）。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 任务管理 + 流缓存"
```

---

### Task 9: API 层

**Files:**
- Create: `app.py`
- Modify: `core/ffmpeg_tool.py`（无需改，仅引用）
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `config`、`core.registry.Registry`、`core.task.TaskManager`、`core.stream_cache.StreamCache`、`core.downloader.sanitize_filename/download_video`、`providers.base.ProviderError`、`providers.douyin.DouyinProvider`、`core.errors.DownloadError`。
- Produces: `app.create_app(registry=None, task_mgr=None, stream_cache=None) -> FastAPI`，含 `/api/parse`、`/api/download`、`/api/task/{id}`、`/api/files`、`/api/files/{name}`、`/api/cover`、`/`（静态）。模块级 `app = create_app()` 供 uvicorn 启动。

- [ ] **Step 1: 写失败的测试 tests/test_api.py**

```python
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as app_module
import config
from core.models import Stream, VideoInfo
from core.registry import Registry
from providers.base import Provider


class FakeProvider(Provider):
    host_match = ("fake.example",)
    name = "fake"

    def parse(self, url):
        return VideoInfo(
            provider="fake", video_id="123", title="标题", author="作者",
            cover_url="", streams=[Stream("高清", "https://fake.example/v.mp4")],
        )

    def resolve_streams(self, video_id):
        return self.parse("").streams


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DOWNLOAD_DIR", tmp_path)
    reg = Registry()
    reg.register(FakeProvider())
    return TestClient(app_module.create_app(registry=reg))


def test_parse_ok(client):
    r = client.post("/api/parse", json={"url": "https://fake.example/v/123"})
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "标题"
    assert data["author"] == "作者"
    assert data["streams"][0]["quality_label"] == "高清"


def test_parse_invalid_url(client):
    r = client.post("/api/parse", json={"url": "https://unknown.com/x"})
    assert r.status_code == 400
    assert r.json()["detail"]["kind"] == "invalid_url"


def test_download_then_poll_and_list(client, monkeypatch, tmp_path):
    def fake_download(stream, dest, **kw):
        Path(dest).write_bytes(b"fakevideo")

    monkeypatch.setattr(app_module, "download_video", fake_download)

    r = client.post("/api/download", json={"video_id": "123", "stream_index": 0})
    assert r.status_code == 200
    task_id = r.json()["task_id"]

    status = ""
    for _ in range(200):
        t = client.get(f"/api/task/{task_id}").json()
        status = t["status"]
        if status in ("done", "error"):
            break
        time.sleep(0.01)
    assert status == "done"
    assert t["file_name"].endswith(".mp4")
    assert t["progress"] == 0.0  # fake_download 不更新进度，保持初值

    files = client.get("/api/files").json()["files"]
    assert t["file_name"] in files

    dl = client.get(f"/api/files/{t['file_name']}")
    assert dl.status_code == 200
    assert dl.content == b"fakevideo"


def test_download_bad_stream_index(client):
    r = client.post("/api/download", json={"video_id": "123", "stream_index": 99})
    assert r.status_code == 400


def test_task_not_found(client):
    assert client.get("/api/task/nope").status_code == 404
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.venv/Scripts/python -m pytest tests/test_api.py -v`
Expected: FAIL（ModuleNotFoundError: app）。

- [ ] **Step 3: 写 app.py**

```python
"""FastAPI 入口与 API 层。"""
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
from core.downloader import download_video, sanitize_filename
from core.errors import DownloadError, ProviderError
from core.registry import Registry
from core.stream_cache import StreamCache
from core.task import TaskManager
from providers.douyin import DouyinProvider

# 与解析器保持一致的浏览器 UA（封面代理也需要）
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


class ParseRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    video_id: str
    stream_index: int
    provider: str = "douyin"


def create_app(registry: Registry | None = None,
               task_mgr: TaskManager | None = None,
               stream_cache: StreamCache | None = None) -> FastAPI:
    app = FastAPI(title="短视频下载器")
    reg = registry or Registry()
    tm = task_mgr or TaskManager()
    cache = stream_cache or StreamCache()

    def _err(e: ProviderError | DownloadError):
        raise HTTPException(status_code=400, detail={"kind": e.kind, "message": e.message})

    @app.post("/api/parse")
    def api_parse(req: ParseRequest):
        try:
            provider = reg.get_provider_for_url(req.url)
            info = provider.parse(req.url)
        except ProviderError as e:
            _err(e)
        cache.set(info.video_id, info)
        return {
            "provider": info.provider,
            "video_id": info.video_id,
            "title": info.title,
            "author": info.author,
            "cover_url": info.cover_url,
            "streams": [s.__dict__ for s in info.streams],
        }

    @app.post("/api/download")
    def api_download(req: DownloadRequest):
        provider = reg.get_provider(req.provider)
        if provider is None:
            _err(ProviderError("invalid_url", "未知平台"))
        video = cache.get(req.video_id)
        if video is None:
            try:
                video = provider.parse(f"https://www.douyin.com/video/{req.video_id}")
            except ProviderError as e:
                _err(e)
            cache.set(req.video_id, video)
        if not (0 <= req.stream_index < len(video.streams)):
            _err(ProviderError("invalid_url", "清晰度不存在"))
        stream = video.streams[req.stream_index]
        task = tm.create(video_id=video.video_id, provider=video.provider,
                         title=video.title, author=video.author, stream=stream)

        def worker(t):
            safe = sanitize_filename(f"{t.author}_{t.title}_{stream.quality_label}")
            final = str(config.DOWNLOAD_DIR / (safe + ".mp4"))

            def cb(done, total):
                t.progress = round(done / total * 100, 1) if total else 0.0
                t.status = "downloading"

            try:
                download_video(stream, final,
                               referer=config.DOWNLOAD_REFERER.get(video.provider),
                               progress_cb=cb)
                t.status = "done"
                t.file_name = os.path.basename(final)
            except DownloadError as e:
                t.status = "error"
                t.error = f"{e.kind}: {e.message}"
            except Exception as e:
                t.status = "error"
                t.error = str(e)

        tm.submit(task, worker)
        return {"task_id": task.task_id}

    @app.get("/api/task/{task_id}")
    def api_task(task_id: str):
        task = tm.get(task_id)
        if task is None:
            raise HTTPException(status_code=404,
                                detail={"kind": "not_found", "message": "任务不存在"})
        return {
            "task_id": task.task_id,
            "status": task.status,
            "progress": task.progress,
            "file_name": task.file_name,
            "error": task.error,
        }

    @app.get("/api/files")
    def api_files():
        config.DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        files = [f for f in os.listdir(config.DOWNLOAD_DIR) if f.endswith(".mp4")]
        return {"files": sorted(files)}

    @app.get("/api/files/{file_name}")
    def api_file(file_name: str):
        path = config.DOWNLOAD_DIR / os.path.basename(file_name)
        if not path.exists():
            raise HTTPException(status_code=404,
                                detail={"kind": "not_found", "message": "文件不存在"})
        return Response(content=path.read_bytes(), media_type="video/mp4",
                        headers={"Content-Disposition":
                                 f"attachment; filename*=UTF-8''{file_name}"})

    @app.get("/api/cover")
    def api_cover(url: str):
        """代理封面图：解决 CDN 防盗链导致浏览器 <img> 403 的问题。"""
        headers = {"User-Agent": UA, "Referer": "https://www.douyin.com/"}
        try:
            resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=10)
        except httpx.HTTPError:
            raise HTTPException(status_code=404, detail="封面获取失败")
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="封面获取失败")
        return Response(content=resp.content,
                        media_type=resp.headers.get("content-type", "image/jpeg"))

    # 静态资源挂载在最后，API 路由优先
    web_dir = Path(__file__).resolve().parent / "web"
    if web_dir.exists():
        app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")

    return app


app = create_app()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `.venv/Scripts/python -m pytest tests/test_api.py -v`
Expected: PASS（6 passed）。若 `web/` 目录不存在，`create_app` 静默跳过静态挂载，不影响测试。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: HTTP API 层（parse/download/task/files/cover）"
```

---

### Task 10: 前端单页

**Files:**
- Create: `web/index.html`
- Create: `web/style.css`
- Create: `web/app.js`

**Interfaces:**
- Consumes: `/api/parse`、`/api/download`、`/api/task/{id}`、`/api/files`、`/api/files/{name}`、`/api/cover?url=`。由 Task 9 的静态挂载提供。

- [ ] **Step 1: 写 web/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>短视频下载器</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>📥 短视频下载器</h1>
      <button id="themeToggle" class="ghost">深色</button>
    </header>

    <section class="input-row">
      <input id="urlInput" type="text" placeholder="粘贴抖音分享链接，如 https://v.douyin.com/xxx/">
      <button id="parseBtn">解析</button>
    </section>

    <p id="status" class="status"></p>
    <p id="error" class="error hidden"></p>

    <section id="card" class="card hidden">
      <img id="cover" class="cover" alt="封面">
      <div class="info">
        <div id="title" class="title"></div>
        <div id="author" class="author"></div>
        <div class="controls">
          <select id="qualitySelect"></select>
          <button id="downloadBtn">⬇ 下载</button>
        </div>
        <div id="progressWrap" class="progress-wrap hidden">
          <div id="progressBar" class="progress-bar"></div>
          <span id="progressText">0%</span>
        </div>
        <a id="openBtn" class="open-btn hidden" href="#" download>打开文件</a>
      </div>
    </section>

    <section class="files">
      <h2>已下载</h2>
      <ul id="fileList" class="file-list"></ul>
    </section>
  </div>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 web/style.css**

```css
:root {
  --bg: #f5f6f8;
  --card: #ffffff;
  --text: #1f2329;
  --muted: #6b7280;
  --accent: #2f6bff;
  --border: #e5e7eb;
}
[data-theme="dark"] {
  --bg: #111827;
  --card: #1f2937;
  --text: #f3f4f6;
  --muted: #9ca3af;
  --accent: #60a5fa;
  --border: #374151;
}
* { box-sizing: border-box; }
body {
  margin: 0; font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg); color: var(--text);
}
.container { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
header { display: flex; justify-content: space-between; align-items: center; }
h1 { font-size: 22px; }
.ghost {
  background: none; border: 1px solid var(--border); color: var(--text);
  border-radius: 6px; padding: 4px 10px; cursor: pointer;
}
.input-row { display: flex; gap: 8px; margin: 16px 0; }
#urlInput {
  flex: 1; padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--card); color: var(--text);
}
button#parseBtn, button#downloadBtn {
  background: var(--accent); color: #fff; border: none;
  border-radius: 8px; padding: 10px 18px; cursor: pointer; font-size: 14px;
}
.status { color: var(--muted); min-height: 20px; }
.error { color: #ef4444; }
.hidden { display: none; }
.card {
  display: flex; gap: 16px; background: var(--card);
  border: 1px solid var(--border); border-radius: 12px; padding: 16px;
}
.cover { width: 120px; height: 160px; object-fit: cover; border-radius: 8px; background: var(--border); }
.info { flex: 1; }
.title { font-weight: 600; margin-bottom: 4px; }
.author { color: var(--muted); font-size: 13px; margin-bottom: 12px; }
.controls { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
#qualitySelect {
  padding: 8px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--card); color: var(--text);
}
.progress-wrap { position: relative; height: 18px; background: var(--border); border-radius: 6px; overflow: hidden; }
.progress-bar { width: 0%; height: 100%; background: var(--accent); transition: width .2s; }
#progressText { position: absolute; right: 6px; top: 1px; font-size: 12px; }
.open-btn { display: inline-block; margin-top: 10px; color: var(--accent); }
.file-list { list-style: none; padding: 0; }
.file-list li {
  display: flex; justify-content: space-between; align-items: center;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 8px;
}
.file-list a { color: var(--accent); text-decoration: none; }
```

- [ ] **Step 3: 写 web/app.js**

```javascript
const $ = (id) => document.getElementById(id);

let currentVideo = null;

const showError = (msg) => {
  const el = $("error");
  el.textContent = msg;
  el.classList.remove("hidden");
};
const clearError = () => $("error").classList.add("hidden");

// 深色模式
$("themeToggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  $("themeToggle").textContent = dark ? "深色" : "浅色";
});

// 解析
$("parseBtn").addEventListener("click", async () => {
  const url = $("urlInput").value.trim();
  if (!url) return;
  clearError();
  $("status").textContent = "解析中…";
  $("card").classList.add("hidden");
  try {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.detail.message); $("status").textContent = ""; return; }
    renderCard(data);
    $("status").textContent = "解析成功，选择清晰度后下载";
  } catch (e) {
    showError("网络请求失败");
    $("status").textContent = "";
  }
});

function renderCard(info) {
  currentVideo = info;
  $("cover").src = info.cover_url ? "/api/cover?url=" + encodeURIComponent(info.cover_url) : "";
  $("title").textContent = info.title || "（无标题）";
  $("author").textContent = "@" + (info.author || "未知");
  const sel = $("qualitySelect");
  sel.innerHTML = "";
  info.streams.forEach((s, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = s.quality_label;
    sel.appendChild(opt);
  });
  $("progressBar").style.width = "0%";
  $("progressText").textContent = "0%";
  $("progressWrap").classList.add("hidden");
  $("openBtn").classList.add("hidden");
  $("card").classList.remove("hidden");
}

// 下载
$("downloadBtn").addEventListener("click", async () => {
  if (!currentVideo) return;
  clearError();
  $("progressWrap").classList.remove("hidden");
  $("openBtn").classList.add("hidden");
  $("status").textContent = "下载中…";
  try {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_id: currentVideo.video_id,
        provider: currentVideo.provider,
        stream_index: parseInt($("qualitySelect").value, 10),
      }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.detail.message); $("status").textContent = ""; return; }
    pollTask(data.task_id);
  } catch (e) {
    showError("网络请求失败");
    $("status").textContent = "";
  }
});

function pollTask(taskId) {
  const iv = setInterval(async () => {
    try {
      const res = await fetch(`/api/task/${taskId}`);
      const t = await res.json();
      if (!res.ok) { clearInterval(iv); showError(t.detail.message); return; }
      $("progressBar").style.width = t.progress + "%";
      $("progressText").textContent = Math.round(t.progress) + "%";
      if (t.status === "done") {
        clearInterval(iv);
        $("status").textContent = "完成！";
        $("openBtn").href = "/api/files/" + encodeURIComponent(t.file_name);
        $("openBtn").classList.remove("hidden");
        loadFiles();
      } else if (t.status === "error") {
        clearInterval(iv);
        $("status").textContent = "";
        showError(t.error);
      }
    } catch (e) {
      clearInterval(iv);
      showError("轮询任务状态失败");
    }
  }, 1000);
}

// 已下载列表
async function loadFiles() {
  try {
    const res = await fetch("/api/files");
    const data = await res.json();
    const ul = $("fileList");
    ul.innerHTML = "";
    data.files.forEach((name) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = name;
      const a = document.createElement("a");
      a.href = "/api/files/" + encodeURIComponent(name);
      a.textContent = "下载";
      li.appendChild(span);
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch (e) {
    // 列表加载失败静默
  }
}

loadFiles();
```

- [ ] **Step 4: 手动验证页面可打开**

Run: `.venv/Scripts/python -c "import uvicorn; from app import app"`（确认无 import 错误），然后启动：
```bash
.venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8000
```
打开浏览器访问 `http://127.0.0.1:8000/`，确认：页面正常渲染、深色开关生效、解析按钮点击后（链接无效会显示红色错误提示）交互正常。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 前端单页（解析/选清晰度/进度/已下载列表）"
```

---

### Task 11: 一键启动与收尾

**Files:**
- Create: `run.py`
- Create: `README.md`

**Interfaces:**
- Consumes: `app.app`（`uvicorn.run("app:app")`）。

- [ ] **Step 1: 写 run.py**

```python
"""一键启动：.venv/Scripts/python run.py"""
import uvicorn

import app  # noqa: F401 确保路由注册
import config

if __name__ == "__main__":
    uvicorn.run("app:app", host=config.HOST, port=config.PORT, reload=False)
```

- [ ] **Step 2: 写 README.md**

```markdown
# 短视频下载器

自研解析的短视频下载工具：粘贴抖音分享链接，解析出无水印多路清晰度，选择后下载为完整 MP4。

## 快速开始

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python run.py
```

浏览器打开 http://127.0.0.1:8000/

## 使用

1. 复制抖音分享链接（如 `https://v.douyin.com/xxx/`）
2. 粘贴到输入框，点「解析」
3. 选择清晰度，点「下载」，等待进度条完成
4. 点击「打开文件」保存到本地

## 架构

- `providers/` — 平台适配器（当前：douyin），插件式注册，新增平台只需加一个文件
- `core/` — 下载器、任务管理、流缓存、ffmpeg 合成
- `app.py` — FastAPI，暴露 /api/parse、/api/download、/api/task、/api/files
- `web/` — 原生 HTML/CSS/JS 单页，零构建

## 测试

```bash
.venv/Scripts/python -m pytest -v
```

## 依赖说明

- ffmpeg 仅对音视频分离的高清源必需（`-c copy` 合成）；未安装时单文件源仍可下载。
```

- [ ] **Step 3: 全量跑通所有测试**

Run: `.venv/Scripts/python -m pytest -v`
Expected: 全部 PASS。

- [ ] **Step 4: 端到端验收（真实流程）**

```bash
.venv/Scripts/python run.py
```
浏览器打开 `http://127.0.0.1:8000/`，用**真实抖音链接**跑通：粘贴 → 解析 → 选超清 → 下载 → 进度 100% → 打开文件，确认：
1. 视频无水印、声音正常。
2. downloads/ 目录下生成 `{作者}_{标题}_{清晰度}.mp4`。
3. 无效链接显示"不是有效的单个视频链接"。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 一键启动脚本与 README"
```

---

## Self-Review 记录

**Spec 覆盖检查**：
- 第 5 节接口约定 → Task 2（错误+模型）、Task 3（Provider 基类）
- 第 6 节抖音解析器 → Task 5（含 spike 验证点）
- 第 7 节下载器与任务 → Task 6、7、8
- 第 8 节 API → Task 9（含封面代理 /api/cover，理由：CDN 防盗链导致浏览器 <img> 403）
- 第 9 节前端 → Task 10
- 第 12 节路线图 Phase 0-4 → Task 1-11
- 第 10 节插件远期 → 不实现，前端组件化已留（app.js 按函数拆分）

**占位符检查**：无 TBD/TODO；每个改动步骤均含完整代码。
**类型一致性**：`Stream/VideoInfo/DownloadTask`、`Provider.parse/resolve_streams`、`Registry.register/get_provider/get_provider_for_url`、`download_stream/download_video/sanitize_filename`、`TaskManager.create/get/submit`、`StreamCache.get/set`、`create_app` 在所有任务间签名一致。
