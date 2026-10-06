import type { RefCallback } from "react";

/**
 * Ref callback that fades an `<img>` in once it has loaded. Pair it with the
 * `image-fade` utility from `@bahrul/config/motion.css`:
 *
 *   <img className="image-fade" decoding="async" ref={fadeInOnLoad} … />
 *
 * `data-image-state="loading"` is set only when the image has not finished
 * loading at mount, and cleared on `load`/`error`. Images that are already
 * complete (cached files, data-URL previews of a just-picked upload) and SSR
 * markup never carry the attribute, so an image never hides waiting on
 * JavaScript. Keep `width`/`height` (or an aspect ratio) on the element so the
 * fade causes no layout shift.
 */
export const fadeInOnLoad: RefCallback<HTMLImageElement> = (img) => {
  if (!img || img.complete) {
    return;
  }
  img.dataset.imageState = "loading";
  const reveal = () => {
    delete img.dataset.imageState;
  };
  img.addEventListener("load", reveal, { once: true });
  img.addEventListener("error", reveal, { once: true });
  return () => {
    img.removeEventListener("load", reveal);
    img.removeEventListener("error", reveal);
  };
};
