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

打开：

```text
http://127.0.0.1:4318
```

## 目录

```text
ui/           前端页面
scripts/      搜索与筛选脚本
data/         搜索结果
output/       导出结果
server.js     本地 Web 服务
```
