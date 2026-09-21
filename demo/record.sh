#!/usr/bin/env bash
# Record demo/demo.cast: the README's first mock, run for real in a throwaway
# copy of demo/app. Needs asciinema, nvim, and bun.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WORKSPACE="${DEMO_WORKSPACE:-/tmp/eve-mocks-demo/roadmap-agent}"
THEME_DIR="$HERE/.cache/vercel.nvim"
CAST="${1:-$HERE/demo.cast}"

for tool in asciinema nvim bun; do
  command -v "$tool" >/dev/null || { echo "demo: $tool is not installed" >&2; exit 1; }
done

# The colourscheme the editor part is shown in.
if [ ! -d "$THEME_DIR" ]; then
  mkdir -p "$HERE/.cache"
  git clone --depth 1 https://github.com/tiesen243/vercel.nvim "$THEME_DIR"
fi

# A fresh copy every run: the session creates mocks/ and edits files.
rm -rf "$WORKSPACE"
mkdir -p "$WORKSPACE"
cp -R "$HERE/app/." "$WORKSPACE/"

(cd "$ROOT" && bun run build >/dev/null)
(cd "$WORKSPACE" && bun install --silent >/dev/null)

# Resolve `eve-mocks` to this checkout instead of the published package.
mkdir -p "$WORKSPACE/node_modules/.bin"
ln -sfn "$ROOT" "$WORKSPACE/node_modules/eve-mocks"
ln -sfn "../eve-mocks/dist/cli.js" "$WORKSPACE/node_modules/.bin/eve-mocks"

rm -f "$CAST"
DEMO_WORKSPACE="$WORKSPACE" DEMO_NVIM_INIT="$HERE/nvim/init.lua" DEMO_THEME_DIR="$THEME_DIR" \
  TERM=xterm-256color COLORTERM=truecolor \
  asciinema rec --cols 106 --rows 30 --quiet --idle-time-limit 2 \
    --title "eve-mocks: a security eval with Linear mocked and Notion allowed" \
    --command "bash $HERE/play.sh" \
    "$CAST"

echo "demo: wrote $CAST"
