import type { ReactNode } from "react";
import { createContext, use, useEffect, useMemo, useState } from "react";

export type Scheme = "light" | "dark";

const STORAGE_KEY = "zedative-theme";

interface ThemeValue {
  scheme: Scheme;
  setScheme: (scheme: Scheme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function storedScheme(): Scheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Light (canonical) or Night Desk for this client-only page. The builders use
 * next-themes, which injects a <script> React refuses to run outside SSR;
 * index.html applies the stored scheme before first paint instead.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<Scheme>(storedScheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", scheme === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, scheme);
    } catch {
      // Storage can be unavailable (private mode); the toggle still works.
    }
  }, [scheme]);

  const value = useMemo(() => ({ scheme, setScheme }), [scheme]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useScheme(): ThemeValue {
  const value = use(ThemeContext);
  if (!value) {
    throw new Error("useScheme must be used inside <ThemeProvider>");
  }
  return value;
}
