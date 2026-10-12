import { Button } from "@rulisme/ui/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@rulisme/ui/ui/tooltip";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n";

// Icon-only switch between Zedative light and Night Desk, its derived dark
// scheme. Byte-identical to the same component in apps/invoice. Defaults to
// light (next-themes, `defaultTheme="light"`, no system theme); once toggled
// the choice persists in localStorage. The `mounted` guard avoids a hydration
// mismatch because the stored theme is only known on the client.
export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  const label = isDark ? t("theme.toLight") : t("theme.toDark");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          onClick={() => setTheme(isDark ? "light" : "dark")}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
