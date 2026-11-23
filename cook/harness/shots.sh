#!/usr/bin/env bash
# Regenerates the hub's feature screenshots from the running apps (dark).
set -u
export AGENT_BROWSER_SESSION=owner
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; T="$ROOT/cook/stills/wip/shots"; mkdir -p "$T"
agent-browser set media dark >/dev/null; agent-browser set viewport 1000 620 >/dev/null
agent-browser open "http://localhost:4007/?code=mock-sign-in-code" >/dev/null; agent-browser wait 3000 >/dev/null
for pair in cv:http://localhost:4003/ invoice:http://localhost:4004/ portfolio:http://localhost:4005/ jobs:http://localhost:4007/board; do
  id=${pair%%:*}; url=${pair#*:}
  agent-browser open "$url" >/dev/null; agent-browser wait 3000 >/dev/null
  if [[ $id == invoice ]]; then agent-browser find label "Load Sample Invoice" click >/dev/null 2>&1; agent-browser wait 1200 >/dev/null; fi
  if [[ $id == portfolio ]]; then agent-browser find label "$(python3 -c "import json;print(json.load(open('$ROOT/apps/portfolio/src/i18n/locales/en.json'))['toolbar']['prefill'])")" click >/dev/null 2>&1; agent-browser wait 1200 >/dev/null; fi
  if [[ $id == cv ]]; then
    agent-browser find label "Full Name" fill "Rina Putri" >/dev/null 2>&1
    agent-browser find label "Job Title" fill "iOS developer" >/dev/null 2>&1
    agent-browser find label "Email" fill "rina@example.com" >/dev/null 2>&1
    agent-browser find label "Location" fill "Makassar, Indonesia" >/dev/null 2>&1
    agent-browser find placeholder "Write a brief professional summary..." fill "iOS developer who ships calm, accessible apps in SwiftUI. Interned at Gojek on the trip receipt screen." >/dev/null 2>&1
    agent-browser wait 1200 >/dev/null
  fi
  # hide the dev-only TanStack devtools trigger
  agent-browser eval "document.querySelectorAll('agentation-toolbar,[class*=devtools],[id*=devtools]').forEach(e=>e.remove()); 1" >/dev/null 2>&1
  agent-browser screenshot "$T/$id.png" >/dev/null
  python3 -c "from PIL import Image; Image.open('$T/$id.png').convert('RGB').save('$ROOT/apps/home/public/shots/$id.webp', quality=88)"
  echo "$id"
done
