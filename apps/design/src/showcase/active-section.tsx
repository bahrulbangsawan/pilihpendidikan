import type { ReactNode } from "react";
import { createContext, use, useEffect, useState } from "react";
import { SECTION_IDS } from "./nav";

/** Below the 49px header, with a little room to spare. */
const READING_LINE = 120;

const ActiveSectionContext = createContext<string>(SECTION_IDS[0] ?? "");

function currentSection(): string {
  let active = SECTION_IDS[0] ?? "";
  for (const id of SECTION_IDS) {
    const element = document.getElementById(id);
    if (element && element.getBoundingClientRect().top <= READING_LINE) {
      active = id;
    }
  }
  // At the very bottom the last section may never reach the reading line.
  const atBottom =
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - 2;
  return atBottom ? (SECTION_IDS.at(-1) ?? active) : active;
}

/**
 * Tracks the section under the header so the left nav and the header tabs
 * can mark it, like the orange active item on cursor.com/docs.
 */
export function ActiveSectionProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(SECTION_IDS[0] ?? "");

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(currentSection()));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return <ActiveSectionContext value={active}>{children}</ActiveSectionContext>;
}

export function useActiveSection(): string {
  return use(ActiveSectionContext);
}
