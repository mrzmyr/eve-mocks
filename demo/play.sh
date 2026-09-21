#!/usr/bin/env bash
# The recorded session. Every command is real: the only scripted part is the
# typing. Run it through demo/record.sh, which prepares the workspace.
set -u

WORKSPACE="${DEMO_WORKSPACE:?set by record.sh}"
NVIM_INIT="${DEMO_NVIM_INIT:?set by record.sh}"

cd "$WORKSPACE" || exit 1

DIM=$'\033[38;2;136;136;136m'
CYAN=$'\033[38;2;82;168;255m'
RESET=$'\033[0m'
PROMPT="${DIM}roadmap-agent${RESET} ${CYAN}❯${RESET} "

TYPE_DELAY=${DEMO_TYPE_DELAY:-0.035}

# Type one command at the prompt, the way a person would.
prompt_command() {
  local command="$1"

  printf '%s' "$PROMPT"

  for (( i = 0; i < ${#command}; i++ )); do
    printf '%s' "${command:i:1}"
    sleep "$TYPE_DELAY"
  done

  sleep 0.45
  printf '\n'
}

# Type a command, run it, and let its output stand for a moment.
run() {
  prompt_command "$1"
  eval "$1"
  sleep "${2:-1.6}"
  printf '\n'
}

# Start a chapter on an empty screen, so its output is all there is to read.
chapter() {
  clear
  sleep 0.6
}

# Send `keys` to the nvim listening on `socket`, one key every TYPE_DELAY, then
# hold the finished file on screen and quit. nvim is driven from here, not from
# inside itself: a client sends the keys the way a keyboard would.
typist() {
  local socket="$1" keys="$2" hold="$3"

  until [ -S "$socket" ]; do
    sleep 0.1
  done

  sleep 0.8

  python3 -c 'import re, sys; sys.stdout.write("\n".join(re.findall(r"<[A-Za-z-]+>|.", sys.argv[1])) + "\n")' "$keys" |
    while IFS= read -r key; do
      nvim --server "$socket" --remote-send "$key" >/dev/null 2>&1
      sleep "$TYPE_DELAY"
    done

  sleep "$hold"
  nvim --server "$socket" --remote-send '<Esc>:q<CR>' >/dev/null 2>&1
}

# Open a file in nvim, in the vercel.nvim colourscheme, and type an edit into it.
edit() {
  local file="$1" keys="$2" hold="${3:-3}"
  local socket="$WORKSPACE/.nvim.sock"

  prompt_command "nvim $file"
  rm -f "$socket"
  typist "$socket" "$keys" "$hold" &
  nvim --listen "$socket" -u "$NVIM_INIT" "$file"
  wait
  sleep 0.6
}

# The holds leave room for the voice-over of demo.mp4; see README.md.

# The agent: its package.json, and the prompt the security eval sends.
chapter
sleep 1.5
run "cat package.json" 2.5
run "grep -h 'security ' evals/security.eval.ts" 3.5

# init: the mocks folder, and the eval script wrapped in eve-mocks --.
chapter
run "bunx eve-mocks init" 5.0

# Every connection starts as a block.
chapter
run "bunx eve-mocks list" 6.0

# Mock Linear: scaffold, pull the real tools, pin the one the eval calls.
chapter
run "bunx eve-mocks add linear" 1.5
run "bunx eve-mocks pull linear" 2.5
edit "mocks/linear.ts" '7Gcc  results: {<CR>    list_issues: () => ({<CR>      issues: [<CR>        { identifier: "LIN-42", title: "Checkout fails on retry" },<CR>        { identifier: "LIN-43", title: "Roadmap page is stale" },<CR>      ],<CR>    }),<CR>  },<Esc>:w<CR>' 2.5

# Linear is answered in-process; Notion is still a block, which fails the run.
chapter
run "bun run eval --mocks" 7.0

# This eval reads the real Notion page, so allow that one upstream.
edit "mocks/notion.ts" 'iimport { allow } from "eve-mocks";<CR><CR>export default allow({ url: "https://api.notion.com/" });<Esc>:w<CR>' 2.5

# No block left.
chapter
run "bun run eval --mocks" 4.0
run "bunx eve-mocks list" 5.0
