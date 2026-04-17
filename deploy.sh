#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "Missing required command: %s\n" "$1" >&2
    exit 1
  fi
}

printf "==> Checking runtime dependencies\n"
require_cmd node
require_cmd npm
require_cmd python3

printf "Node version: %s\n" "$(node --version)"
printf "NPM version: %s\n" "$(npm --version)"
printf "Python version: %s\n" "$(python3 --version)"

printf "==> Installing Node dependencies\n"
npm install --yes

printf "==> Installing Playwright Chromium\n"
npx playwright install chromium

if [ ! -f "$ENV_FILE" ]; then
  printf "==> Creating .env from template\n"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
else
  printf "==> .env already exists, keeping current file\n"
fi

printf "==> Ensuring data/output directories exist\n"
mkdir -p "$ROOT_DIR/data" "$ROOT_DIR/output"

printf "\nDeployment preparation complete.\n"
printf "\nNext steps:\n"
printf "1. Edit %s and fill DOUYIN_COOKIE\n" "$ENV_FILE"
printf "2. If needed, set PYTHON_BIN and PORT in %s\n" "$ENV_FILE"
printf "3. Start the app with: npm start\n"
printf "\nDefault URL after startup: http://127.0.0.1:4318\n"
