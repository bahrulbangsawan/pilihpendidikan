import { FlagIcon } from "@rulisme/ui/ui/flag-icon";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@rulisme/ui/ui/segmented-control";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { Locale } from "@/i18n";
import { SUPPORTED_LOCALES, useTranslation } from "@/i18n";

// ── Component ──────────────────────────────────────────────

export function LanguageSwitcher() {
  const { locale, t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();

  const pathForLocale = (code: Locale): "/" | "/id" =>
    code === "en" ? "/" : `/${code}`;

  function handleSwitch(code: Locale) {
    if (code === locale) {
      return;
    }
    navigate({ to: pathForLocale(code) });
  }

  // Warm the other locale's route chunk on hover/focus so the switch starts
  // without waiting on the network. No loaders, so cheap.
  function preload(code: Locale) {
    if (code === locale) {
      return;
    }
    router.preloadRoute({ to: pathForLocale(code) }).catch(() => undefined);
  }

  // The shared segmented control (cursor.com's pricing toggle): a `pane`
  // track with the current locale on a `card` pill, each led by its flag.
  return (
    <SegmentedControl
      aria-label={t("a11y.switchLanguage")}
      onValueChange={(code) => handleSwitch(code as Locale)}
      size="sm"
      value={locale}
    >
      {SUPPORTED_LOCALES.map((lang) => {
        return (
          <SegmentedControlItem
            aria-label={lang.nativeName}
            key={lang.code}
            onFocus={() => preload(lang.code)}
            onPointerEnter={() => preload(lang.code)}
            value={lang.code}
          >
            <FlagIcon code={lang.code === "en" ? "gb" : "id"} />
            <span>{lang.code.toUpperCase()}</span>
          </SegmentedControlItem>
        );
      })}
    </SegmentedControl>
  );
}
