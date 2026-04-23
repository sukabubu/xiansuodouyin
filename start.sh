#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMMENT_WORKDIR_DEFAULT="$HOME/.openclaw/workspace/tools/TikTokDownloader"
COMMENT_WORKDIR="${COMMENT_WORKDIR:-$COMMENT_WORKDIR_DEFAULT}"
COMMENT_PYTHON_DEFAULT="$COMMENT_WORKDIR/.venv/bin/python"
COMMENT_PYTHON="${COMMENT_PYTHON_BIN:-$COMMENT_PYTHON_DEFAULT}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "Missing required command: %s\n" "$1" >&2
    exit 1
  fi
}

require_cmd node

if [ ! -x "$COMMENT_PYTHON" ]; then
  printf "Comment service python not found: %s\n" "$COMMENT_PYTHON" >&2
  printf "Set COMMENT_PYTHON_BIN to the correct interpreter path.\n" >&2
  exit 1
fi

printf "==> Starting comment API service\n"
pkill -f "$COMMENT_WORKDIR/.venv/bin/python -c" >/dev/null 2>&1 || true
nohup env PYTHONPATH="$COMMENT_WORKDIR" "$COMMENT_PYTHON" -c "exec('import asyncio\nfrom src.application.TikTokDownloader import TikTokDownloader\nasync def main():\n    async with TikTokDownloader() as d:\n        d.check_config()\n        await d.check_settings(False)\n        await d.server()\nasyncio.run(main())')" > "$ROOT_DIR/comment-api.log" 2>&1 &

printf "==> Waiting for comment API\n"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:5555/token -H "token:" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS http://127.0.0.1:5555/token -H "token:" >/dev/null 2>&1; then
  printf "Comment API failed to start. Check %s/comment-api.log\n" "$ROOT_DIR" >&2
  exit 1
fi

printf "==> Starting web app\n"
node "$ROOT_DIR/server.js"
