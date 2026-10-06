import { useEffect, useState } from "react";

// Flipped on the client once the first page has shown its entrance. Never set
// during SSR (effects do not run on the server), so server markup and the
// hydrating client render always agree.
let entered = false;

/**
 * Returns `true` when this mount is the app's first paint, i.e. the moment to
 * apply the `motion-enter` utility (`@bahrul/config/motion.css`). Later
 * client-side navigations (e.g. switching locale remounts the page) return
 * `false`, so the page relies on the `route-view` cross-fade alone instead of
 * playing two entrances on top of each other.
 *
 * The answer is fixed for the lifetime of the mount, so re-renders (every
 * keystroke in an editor) never strip the class mid-animation. Pass
 * `ready = false` while a page shows a loading state; the entrance is then
 * spent only when the real content first renders.
 */
export function useFirstPaintEntrance(ready = true): boolean {
  const [animate] = useState(() => !entered);
  useEffect(() => {
    if (ready) {
      entered = true;
    }
  }, [ready]);
  return animate;
}
