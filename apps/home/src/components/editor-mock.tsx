import { cn } from "@rulisme/ui/lib/utils";
import { FileBraces } from "lucide-react";
import { useTranslation } from "@/i18n";

// The product, shown as a light-theme editor window drawn in HTML (DESIGN.md
// § Components › Editor mock; § Do's: "real-looking code, not a screenshot or
// illustration"): traffic lights, a sidebar of documents with one active row,
// an agent thread, and a cv.json pane with counter line numbers, a
// current-line fill and a wavy underline on a typo. It is static and hidden
// from assistive tech behind a one-line caption. Only files named
// `*editor-mock*` may use the syn-1..4 syntax colours (TYPOGRAPHY.md).

type Tone = "key" | "string" | "keyword" | "punctuation";

interface Token {
  text: string;
  tone: Tone;
  typo?: boolean;
}

interface CodeLine {
  number: number;
  indent: number;
  tokens: Token[];
  added?: boolean;
  current?: boolean;
}

const TONE_CLASS: Record<Tone, string> = {
  key: "text-syn-1",
  string: "text-syn-2",
  keyword: "text-syn-4",
  punctuation: "text-muted-foreground",
};

// One step per JSON nesting level.
const INDENT_CLASS = ["pl-0", "pl-3", "pl-6", "pl-9"] as const;

// The pane is scrolled to the agent's edit, as an editor would be.
const FIRST_LINE = 12;

// The nine lines the agent inserted (the new experience entry).
const ADDED_COUNT = "+9";

const ACTIVE_DOCUMENT = "cv.json";
const DOCUMENTS = [ACTIVE_DOCUMENT, "invoice.json", "portfolio.json"] as const;
const TRAFFIC_LIGHTS = ["close", "minimize", "zoom"] as const;

function punct(text: string): Token {
  return { text, tone: "punctuation" };
}

function keyToken(name: string): Token {
  return { text: `"${name}"`, tone: "key" };
}

function stringToken(value: string): Token {
  return { text: `"${value}"`, tone: "string" };
}

function keywordToken(value: string): Token {
  return { text: value, tone: "keyword" };
}

/** `"name": value,` — the last property of an object drops the comma. */
function property(name: string, value: Token, last = false): Token[] {
  const tokens = [keyToken(name), punct(": "), value];
  return last ? tokens : [...tokens, punct(",")];
}

/** The visible slice of cv.json, keyed like the CV builder's own data. */
function cvLines(description: string): CodeLine[] {
  const lines: Omit<CodeLine, "number">[] = [
    { indent: 1, tokens: [keyToken("experience"), punct(": [")] },
    { indent: 2, tokens: [punct("{")], added: true },
    {
      indent: 3,
      tokens: property("company", stringToken("Gojek")),
      added: true,
      current: true,
    },
    {
      indent: 3,
      tokens: property("title", stringToken("iOS Engineering Intern")),
      added: true,
    },
    {
      indent: 3,
      tokens: property("workType", stringToken("internship")),
      added: true,
    },
    {
      indent: 3,
      tokens: property("startDate", stringToken("2025-07")),
      added: true,
    },
    {
      indent: 3,
      tokens: property("endDate", stringToken("2025-12")),
      added: true,
    },
    {
      indent: 3,
      tokens: property("current", keywordToken("false")),
      added: true,
    },
    {
      indent: 3,
      tokens: property("description", stringToken(description), true),
      added: true,
    },
    { indent: 2, tokens: [punct("}")], added: true },
    { indent: 1, tokens: [punct("],")] },
    { indent: 1, tokens: [keyToken("education"), punct(": [")] },
    { indent: 2, tokens: [punct("{")] },
    {
      indent: 3,
      tokens: [
        keyToken("institution"),
        punct(": "),
        { text: '"', tone: "string" },
        { text: "Univeristas", tone: "string", typo: true },
        { text: ' Brawijaya"', tone: "string" },
        punct(","),
      ],
    },
    { indent: 3, tokens: property("degree", stringToken("S1 Informatika")) },
    { indent: 3, tokens: property("current", keywordToken("true"), true) },
    { indent: 2, tokens: [punct("}")] },
    { indent: 1, tokens: [punct("],")] },
  ];
  return lines.map((line, index) => ({ ...line, number: FIRST_LINE + index }));
}

function TitleBar() {
  return (
    <div className="grid h-9 grid-cols-[1fr_auto_1fr] items-center gap-3 border-border border-b bg-pane-2 px-3">
      <div className="flex gap-1.5">
        {TRAFFIC_LIGHTS.map((light) => (
          <span
            className="size-2.5 rounded-full border border-offgray/30 bg-card"
            key={light}
          />
        ))}
      </div>
      <p className="type-caption-compact truncate text-muted-foreground">
        pilihpendidikan — {ACTIVE_DOCUMENT}
      </p>
    </div>
  );
}

function Sidebar() {
  const { t } = useTranslation();
  return (
    <div className="hidden min-w-0 flex-col border-border border-r py-2 lg:flex">
      <p className="type-caption-compact px-3 pt-1 pb-2 text-muted-foreground">
        {t("editor.documents")}
      </p>
      <ul className="flex flex-col">
        {DOCUMENTS.map((name) => {
          const active = name === ACTIVE_DOCUMENT;
          return (
            <li
              className={cn(
                "type-body-compact flex items-center gap-2 px-3 py-1",
                active
                  ? "weight-semibold bg-pane-2 text-foreground"
                  : "text-ink"
              )}
              key={name}
            >
              <FileBraces className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {active ? (
                <>
                  <span className="type-micro-compact text-syn-2 tabular-nums">
                    {ADDED_COUNT}
                  </span>
                  <span className="pulse-dot size-1.5 shrink-0 rounded-full bg-syn-2" />
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Thread() {
  const { t } = useTranslation();
  return (
    <div className="hidden min-w-0 flex-col gap-3 border-border border-r p-3 md:flex">
      <p className="type-body-compact border border-border bg-card px-3 py-2 text-foreground">
        {t("editor.prompt")}
      </p>
      <ul className="type-caption-compact flex flex-col gap-1 text-muted-foreground">
        <li>
          ○ {t("editor.read")}{" "}
          <span className="text-foreground">{ACTIVE_DOCUMENT}</span>
        </li>
        <li>
          ○ {t("editor.edit")}{" "}
          <span className="text-foreground">{ACTIVE_DOCUMENT}</span>{" "}
          <span className="text-syn-2 tabular-nums">{ADDED_COUNT}</span>
        </li>
      </ul>
      <p className="type-body-compact">{t("editor.answer")}</p>
    </div>
  );
}

function CodeRow({ line }: { line: CodeLine }) {
  return (
    <div className={cn("flex", line.current && "bg-wash")}>
      <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground tabular-nums">
        {line.number}
      </span>
      <span className={cn("w-0.5 shrink-0", line.added && "bg-syn-2")} />
      <span className={cn("ml-3 whitespace-pre", INDENT_CLASS[line.indent])}>
        {line.tokens.map((token) => (
          <span
            className={cn(
              TONE_CLASS[token.tone],
              token.typo && "underline decoration-syn-3 decoration-wavy"
            )}
            key={token.text}
          >
            {token.text}
          </span>
        ))}
      </span>
    </div>
  );
}

function CodePane({ lines }: { lines: CodeLine[] }) {
  return (
    <div className="flex min-w-0 flex-col bg-card">
      <div className="flex h-8 shrink-0 border-border border-b bg-pane">
        <span className="type-caption-compact -mb-px flex items-center gap-1.5 border-border border-r bg-card px-3 text-foreground">
          <FileBraces className="size-3.5 text-muted-foreground" />
          {ACTIVE_DOCUMENT}
        </span>
        <span className="type-caption-compact flex items-center gap-1.5 border-border border-r px-3 text-muted-foreground">
          <FileBraces className="size-3.5" />
          invoice.json
        </span>
      </div>
      <p className="type-caption-compact truncate px-4 pt-2 pb-1 text-muted-foreground">
        {ACTIVE_DOCUMENT} › experience › 0 › company
      </p>
      <div className="type-body-compact md:type-body overflow-hidden pb-6">
        {lines.map((line) => (
          <CodeRow key={line.number} line={line} />
        ))}
      </div>
    </div>
  );
}

export function EditorMock({ className }: { className?: string }) {
  const { t } = useTranslation();
  const lines = cvLines(t("editor.description"));

  return (
    <figure className={cn("w-full min-w-0", className)}>
      <figcaption className="sr-only">{t("editor.label")}</figcaption>
      {/* The window stands on the band's bottom rule: 6px top corners, no
          bottom border, and its float shadow clipped at the rule. */}
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-t-lg border border-border border-b-0 bg-pane shadow-float [clip-path:inset(-3rem_-3rem_0_-3rem)]"
      >
        <TitleBar />
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:grid-cols-[13rem_minmax(0,1fr)_minmax(0,1.25fr)]">
          <Sidebar />
          <Thread />
          <CodePane lines={lines} />
        </div>
      </div>
    </figure>
  );
}
