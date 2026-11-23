#!/usr/bin/env bash
# usage: [ONLY="S02 S04"] cook/harness/stills.sh rNN   — renders shots into cook/stills/rNN/
set -u
export AGENT_BROWSER_SESSION=owner
R=${1:?round}; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; OUT="$ROOT/cook/stills/$R"; mkdir -p "$OUT"
ab() { # agent-browser with retries (the daemon answers EAGAIN when busy)
  for _ in 1 2 3 4 5; do agent-browser "$@" >/dev/null 2>&1 && return 0; sleep 2; done; return 1
}
shot() { # name media w h url [full]
  if [[ -n "${ONLY:-}" && " $ONLY " != *" $1 "* ]]; then return; fi
  for attempt in 1 2 3; do
    ab set media "$2"; ab set viewport "$3" "$4"; ab open "$5"; ab wait 2500
    # load lazy images: walk the page, then return to the top
    ab eval "(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){scrollTo(0,y);await new Promise(r=>setTimeout(r,60))}scrollTo(0,0);return 1})()"
    ab wait 800
    ab eval "document.querySelectorAll('agentation-toolbar').forEach(e=>e.remove()); 1"
    if [[ "${6:-}" == full ]]; then ab screenshot --full "$OUT/$1.png"; else ab screenshot "$OUT/$1.png"; fi
    w=$(python3 -c "from PIL import Image; print(Image.open('$OUT/$1.png').size[0])" 2>/dev/null)
    [[ "$w" == "$3" ]] && { echo "$1 done"; return; }
  done
  echo "$1 FAILED"
}
# jobs: sign in to the mock api once
ab open "http://localhost:4007/?code=mock-sign-in-code"; ab wait 3000
# dark only (user, 2026-11-24)
shot S01 dark 1440 900 http://localhost:4002/
shot S02 dark 1440 900 http://localhost:4002/ full
shot S04 dark 390 844 http://localhost:4002/ full
shot S05a dark 1440 900 http://localhost:4007/board
shot S05b dark 1440 900 http://localhost:4007/settings
shot S10 dark 1440 900 "http://localhost:4007/board?view=list"
shot S11 dark 1440 900 "http://localhost:4007/board?view=table"
shot S13 dark 1440 900 http://localhost:4007/profile
shot S14 dark 1440 900 http://localhost:4007/stats
shot S15 dark 390 844 http://localhost:4007/board
shot S06 dark 1440 900 http://localhost:4003/
shot S07 dark 1440 900 http://localhost:4006/ full
shot S09a dark 1440 900 http://localhost:4004/
shot S09b dark 1440 900 http://localhost:4005/
