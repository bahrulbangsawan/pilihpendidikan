#!/usr/bin/env bash
# Regenerates the hub's feature screenshots from the running apps (dark).
set -u
export AGENT_BROWSER_SESSION=owner
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; T="$ROOT/cook/stills/wip/shots"; mkdir -p "$T"
agent-browser set media dark >/dev/null; agent-browser set viewport 800 612 >/dev/null
agent-browser open "http://localhost:4007/?code=mock-sign-in-code" >/dev/null; agent-browser wait 3000 >/dev/null
for pair in cv:http://localhost:4003/ invoice:http://localhost:4004/ portfolio:http://localhost:4005/ jobs:http://localhost:4007/board stats:http://localhost:4007/stats; do
  id=${pair%%:*}; url=${pair#*:}
  agent-browser open "$url" >/dev/null; agent-browser wait 3000 >/dev/null
  # fill each builder from a fictional sample (never the owner's own data)
  case $id in
    cv) f=sample-cv-fictional.json ;; invoice) f=sample-invoice-fictional.json ;; portfolio) f=sample-portfolio-fictional.json ;; *) f= ;;
  esac
  if [[ -n "$f" ]]; then
    for _ in 1 2 3; do agent-browser upload 'input[type=file][accept=".json"]' "$ROOT/cook/harness/data/$f" >/dev/null 2>&1 && break; sleep 2; done
    agent-browser wait 1200 >/dev/null
    # a builder with saved data asks before replacing it
    agent-browser eval "[...document.querySelectorAll('button')].find(b=>/^(Replace|Ganti)$/.test(b.textContent.trim()))?.click(); 1" >/dev/null 2>&1
    agent-browser wait 1500 >/dev/null
  fi
  # hide the dev-only TanStack devtools trigger
  agent-browser eval "document.querySelectorAll('agentation-toolbar,[class*=devtools],[id*=devtools]').forEach(e=>e.remove()); 1" >/dev/null 2>&1
  agent-browser screenshot "$T/$id.png" >/dev/null
  python3 -c "from PIL import Image; Image.open('$T/$id.png').convert('RGB').save('$ROOT/apps/home/public/shots/$id.webp', quality=88)"
  echo "$id"
done
