#!/usr/bin/env bash
# usage: cook/harness/stills.sh rNN   — renders every shot into cook/stills/rNN/
set -u
export AGENT_BROWSER_SESSION=owner
R=${1:?round}; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; OUT="$ROOT/cook/stills/$R"; mkdir -p "$OUT"
shot() { # name media w h url [full]
  agent-browser set media "$2" >/dev/null; agent-browser set viewport "$3" "$4" >/dev/null
  agent-browser open "$5" >/dev/null; agent-browser wait 2500 >/dev/null
  # load lazy images: walk the page, then return to the top
  agent-browser eval "(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){scrollTo(0,y);await new Promise(r=>setTimeout(r,60))}scrollTo(0,0);return 1})()" >/dev/null
  agent-browser wait 800 >/dev/null
  agent-browser eval "document.querySelectorAll('agentation-toolbar').forEach(e=>e.remove()); 1" >/dev/null 2>&1
  if [[ "${6:-}" == full ]]; then agent-browser screenshot --full "$OUT/$1.png" >/dev/null; else agent-browser screenshot "$OUT/$1.png" >/dev/null; fi
  echo "$1 done"
}
# jobs: sign in to the mock api once
agent-browser open "http://localhost:4007/?code=mock-sign-in-code" >/dev/null; agent-browser wait 3000 >/dev/null
# dark only (user, 2026-11-24)
shot S01 dark 1440 900 http://localhost:4002/
shot S02 dark 1440 900 http://localhost:4002/ full
shot S04 dark 390 844 http://localhost:4002/ full
shot S05a dark 1440 900 http://localhost:4007/board
shot S05b dark 1440 900 http://localhost:4007/settings
shot S06 dark 1440 900 http://localhost:4003/
shot S07 dark 1440 900 http://localhost:4006/ full
shot S09a dark 1440 900 http://localhost:4004/
shot S09b dark 1440 900 http://localhost:4005/
