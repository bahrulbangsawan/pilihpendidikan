#!/usr/bin/env bash
# Captures the four CV template sheets (sample data) for the hub's template row.
set -u
export AGENT_BROWSER_SESSION=owner
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; T="$ROOT/cook/stills/wip/templates"; mkdir -p "$T" "$ROOT/apps/home/public/templates"
ab() { for _ in 1 2 3 4 5; do agent-browser "$@" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }
ab set media dark; ab set viewport 1440 1200
ab open http://localhost:4003/; ab wait 3000
# import a fictional sample (never the owner's own CV) through the JSON import
ab upload 'input[type=file][accept=".json"]' "$ROOT/cook/harness/data/sample-cv-fictional.json"; ab wait 2000
for name in Basic Harvard Simple Standard; do
  ab eval "[...document.querySelectorAll('[data-slot=segmented-control-item]')].find(b=>b.textContent.trim()==='$name')?.click(); 1"; ab wait 1500
  id=$(echo "$name" | tr '[:upper:]' '[:lower:]')
  ab screenshot .cv-page "$T/$id.png"
  python3 -c "
from PIL import Image
im=Image.open('$T/$id.png').convert('RGB'); w,h=im.size; cw=int(w*0.66)
x0=0
c=im.crop((x0,0,x0+cw,int(cw*0.95)))
c.resize((480,int(480*c.height/c.width))).save('$ROOT/apps/home/public/templates/$id.webp',quality=90)
print('$id',c.size)"
done
