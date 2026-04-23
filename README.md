# xiansuodouyin

一个可部署到服务器上的抖音评论线索筛选网站。

功能：

- 多关键词搜索抖音视频板块
- 只保留最近 N 天视频
- 抓评论区用户主页链接
- 过滤同行、服务商、货代、IP 商、培训招商账号
- 导出 CSV
- 提供本地 Web UI 给普通用户操作

## 运行前提

需要：

- Node.js 18+
- Python 3.12+
- 可用的抖音 Cookie
- 一套可调用评论接口的 Python 环境

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

```bash
DOUYIN_COOKIE=你的完整抖音Cookie
PYTHON_BIN=/path/to/python
PORT=4318
```

## 安装

```bash
npm install
npx playwright install chromium
```

## 一键部署准备

```bash
bash deploy.sh
```

这个脚本会：

- 检查 Node / npm / python3
- 安装 npm 依赖
- 安装 Playwright Chromium
- 生成 `.env`（如果还不存在）
- 创建 `data/` 和 `output/` 目录

跑完后你只需要补 `.env` 里的 `DOUYIN_COOKIE`，然后执行：

```bash
npm start
```

## 启动

```bash
npm start
```

## 生产启动

如果你要在本机或服务器上同时拉起：

- Web UI 服务
- 评论抓取 API 服务

优先使用：

```bash
bash start.sh
```

这个脚本会：

- 启动本地评论 API 服务
- 检查 `127.0.0.1:5555` 是否就绪
- 再启动 Web 服务

默认评论服务路径是：

```text
$HOME/.openclaw/workspace/tools/TikTokDownloader
```

如果你的评论服务在别的目录，可以这样：

```bash
COMMENT_WORKDIR=/your/path/to/TikTokDownloader \
COMMENT_PYTHON_BIN=/your/path/to/python \
bash start.sh
```

## 评论服务依赖

筛选脚本默认请求：

```text
http://127.0.0.1:5555
```

也可以通过环境变量覆盖：

```bash
COMMENT_API_BASE=http://127.0.0.1:5555
```

打开：

```text
http://127.0.0.1:4318
```

## Job API

除了本地 Web UI，这个服务现在也可以作为上游系统的执行器使用，支持按任务 ID 查询结果。

### 创建任务

```bash
POST /api/jobs
Content-Type: application/json
```

请求体示例：

```json
{
  "keywords": ["跨境电商", "tiktok跨境"],
  "days": 1,
  "target": 100,
  "pages": 2,
  "count": 50,
  "scrollLoops": 28,
  "extraNameExcludes": ["服务商"],
  "extraCommentExcludes": ["陪跑"]
}
```

### 查询任务状态

```bash
GET /api/jobs/:id
```

返回结果示例：

```json
{
  "job": {
    "id": "job_1776846399174_aoyu0i",
    "status": "running",
    "error": null,
    "createdAt": "2026-04-22T08:26:39.174Z",
    "startedAt": "2026-04-22T08:26:39.177Z",
    "finishedAt": null,
    "log": ["2026-04-22T08:26:39.177Z START search"],
    "result": null
  }
}
```

### 获取任务结果

```bash
GET /api/jobs/:id/result
GET /api/jobs/:id/download
```

旧接口 `POST /api/run`、`GET /api/status`、`GET /api/result`、`GET /api/download` 仍然保留，用于兼容原来的本地 UI。

## 目录

```text
ui/           前端页面
scripts/      搜索与筛选脚本
data/         搜索结果
output/       导出结果
server.js     本地 Web 服务
```
