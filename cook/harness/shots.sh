#!/usr/bin/env bash
# Regenerates the hub's feature screenshots from the running apps (dark).
set -u
export AGENT_BROWSER_SESSION=owner
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; T="$ROOT/cook/stills/wip/shots"; mkdir -p "$T"
agent-browser set media dark >/dev/null; agent-browser set viewport 1180 737 >/dev/null
agent-browser open "http://localhost:4007/?code=mock-sign-in-code" >/dev/null; agent-browser wait 3000 >/dev/null
for pair in cv:http://localhost:4003/ invoice:http://localhost:4004/ portfolio:http://localhost:4005/ jobs:http://localhost:4007/board; do
  id=${pair%%:*}; url=${pair#*:}
  agent-browser open "$url" >/dev/null; agent-browser wait 3000 >/dev/null
  agent-browser screenshot "$T/$id.png" >/dev/null
  python3 -c "from PIL import Image; Image.open('$T/$id.png').convert('RGB').save('$ROOT/apps/home/public/shots/$id.webp', quality=88)"
  echo "$id"
done
