import { Button } from "@rulisme/ui/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@rulisme/ui/ui/tooltip"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { useTranslation } from "@/i18n"

// Icon-only light/dark switch. Byte-identical to the same component in
// apps/cv-bahrul. Defaults to the system theme (next-themes); once toggled the
// choice persists in localStorage. The `mounted` guard avoids a hydration
// mismatch because the resolved theme is only known on the client.
export function ThemeToggle() {
  const { t } = useTranslation()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted && resolvedTheme === "dark"
  const label = isDark ? t("theme.toLight") : t("theme.toDark")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          onClick={() => setTheme(isDark ? "light" : "dark")}
          size="icon"
          type="button"
          variant="ghost"
        >
          {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
