// An in-app link by path string. Screens of this leaf use the router's typed
// <Link>; the shell also links screens that arrive later (inbox, automation,
// sources, stats, cli), so it navigates by href and keeps a real <a> for
// new-tab clicks and crawl-free semantics.

import { useRouter } from "@tanstack/react-router";
import type { ComponentProps, MouseEvent } from "react";

export function AppLink({
  href,
  onClick,
  ...props
}: ComponentProps<"a"> & { href: string }) {
  const router = useRouter();
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    const modified =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.defaultPrevented || modified || event.button !== 0) {
      return;
    }
    event.preventDefault();
    router.navigate({ href });
  }
  return <a href={href} onClick={handleClick} {...props} />;
}

/** Navigate to an app path from code (shortcuts, the palette). */
export function useAppNavigate(): (href: string) => void {
  const router = useRouter();
  return (href) => {
    router.navigate({ href });
  };
}
