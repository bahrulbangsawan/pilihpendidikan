import { cn } from "@rulisme/ui/lib/utils";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { Locale } from "@/i18n";
import { SUPPORTED_LOCALES, useTranslation } from "@/i18n";

// ── SVG Flag Icons ─────────────────────────────────────────

function FlagGB({ className }: { className?: string }) {
  return (
    <svg
      aria-label="English"
      className={className}
      role="img"
      viewBox="0 0 60 30"
      xmlns="http://www.w3.org/2000/svg"
    >
      <clipPath id="gb-clip">
        <rect height="30" width="60" />
      </clipPath>
      <g clipPath="url(#gb-clip)">
        <rect fill="#012169" height="30" width="60" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path
          clipPath="url(#gb-clip)"
          d="M0,0 L60,30 M60,0 L0,30"
          stroke="#C8102E"
          strokeWidth="4"
        />
        <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

function FlagID({ className }: { className?: string }) {
  return (
    <svg
      aria-label="Bahasa Indonesia"
      className={className}
      role="img"
      viewBox="0 0 60 30"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="#CE1126" height="15" width="60" />
      <rect fill="#fff" height="15" width="60" y="15" />
    </svg>
  );
}

const FLAG_COMPONENTS: Record<Locale, typeof FlagGB> = {
  en: FlagGB,
  id: FlagID,
};

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

  // A Zedative segmented control: paper at 60% with a grey lip, 32px like the
  // toolbar's small buttons; the current language sits on `pane-2` at the
  // heading weight.
  return (
    <fieldset
      aria-label={t("a11y.switchLanguage")}
      className="inset-shadow-lip flex h-8 items-stretch overflow-hidden rounded-md border border-border/60 bg-card/60"
    >
      {SUPPORTED_LOCALES.map((lang, i) => {
        const Flag = FLAG_COMPONENTS[lang.code];
        const isActive = locale === lang.code;
        return (
          <button
            aria-current={isActive ? "true" : undefined}
            aria-label={lang.nativeName}
            className={cn(
              "press flex items-center gap-1.5 px-2 outline-none transition-[background-color,color] duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:-outline-offset-2",
              i > 0 && "border-border/60 border-l",
              isActive
                ? "weight-semibold bg-pane-2 text-foreground"
                : "text-muted-foreground hover:bg-pane/70 hover:text-foreground"
            )}
            key={lang.code}
            onClick={() => handleSwitch(lang.code)}
            onFocus={() => preload(lang.code)}
            onPointerEnter={() => preload(lang.code)}
            type="button"
          >
            <Flag className="h-3 w-5 shrink-0 rounded-xs" />
            <span>{lang.code.toUpperCase()}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
