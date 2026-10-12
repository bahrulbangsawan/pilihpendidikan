import { cn } from "@rulisme/ui/lib/utils";
import { ChevronRight, CornerDownRight, FileJson, Search } from "lucide-react";

/*
 * The DESIGN.md editor mock: the product drawn as a light-theme window in
 * HTML, never a screenshot. Traffic lights (the only circles besides status
 * dots), a title bar on pane-2, documents grouped by builder with one active
 * row and a pulsing dot, an agent thread on pane with a bordered prompt and
 * `○ Read …` tool lines, and a code pane on bg-2 with tabs, a breadcrumb,
 * counter line numbers, a current-line wash and one wavy red underline.
 * Syntax colours (`syn-1..4`) belong to code like this and nowhere else on
 * the page. Nothing in the window animates except the active document's
 * status dot.
 */

/* ── Code ──────────────────────────────────────────────────────────────── */

type TokenKind = "punct" | "key" | "string" | "number" | "keyword" | "typo";

// syn-1 types and keys, syn-2 strings, syn-3 numbers and errors, syn-4
// keywords. Punctuation stays foreground.
const TOKEN_CLASS: Record<TokenKind, string> = {
  punct: "text-foreground",
  key: "text-syn-1",
  string: "text-syn-2",
  number: "text-syn-3",
  keyword: "text-syn-4",
  typo: "text-syn-2 underline decoration-syn-3 decoration-wavy underline-offset-3",
};

type Token = readonly [TokenKind, string];

const p = (text: string): Token => ["punct", text];
const key = (name: string): Token => ["key", `"${name}"`];
const str = (text: string): Token => ["string", `"${text}"`];
const num = (value: string): Token => ["number", value];
const kw = (word: string): Token => ["keyword", word];

/** A `"key": value` line at the given indent, with a trailing comma. */
function entry(indent: number, name: string, value: Token, last = false) {
  return [
    p(" ".repeat(indent)),
    key(name),
    p(": "),
    value,
    ...(last ? [] : [p(",")]),
  ];
}

const CURRENT_LINE = 3;

// cv.json as the CV builder saves it. Line 3 holds the cursor and the typo
// the agent found ("Developr").
const SOURCE: readonly (readonly Token[])[] = [
  [p("{")],
  entry(2, "name", str("Rina Wulandari")),
  [
    p("  "),
    key("headline"),
    p(": "),
    ["string", '"Frontend '],
    ["typo", "Developr"],
    ["string", '"'],
    p(","),
  ],
  entry(2, "location", str("Malang, Jawa Timur")),
  entry(2, "email", str("rina.wulandari@ub.ac.id")),
  entry(2, "openToWork", kw("true")),
  [p("  "), key("education"), p(": [")],
  [p("    {")],
  entry(6, "school", str("Universitas Brawijaya")),
  entry(6, "degree", str("S.Kom. Informatika")),
  entry(6, "graduated", num("2025")),
  entry(6, "gpa", num("3.71"), true),
  [p("    }")],
  [p("  ],")],
  [p("  "), key("experience"), p(": [")],
  [p("    {")],
  entry(6, "role", str("Frontend Developer")),
  entry(6, "company", str("Tokopedia")),
  entry(6, "start", str("2025-08")),
  entry(6, "end", kw("null"), true),
  [p("    }")],
  [p("  ]")],
  [p("}")],
];

// Stable keys for the lines and their tokens (the source never reorders).
const LINES = SOURCE.map((tokens, lineIndex) => ({
  number: lineIndex + 1,
  tokens: tokens.map(([kind, text], tokenIndex) => ({
    id: `${lineIndex}:${tokenIndex}`,
    kind,
    text,
  })),
}));

function CodeLines() {
  return (
    <div className="no-scrollbar overflow-x-auto py-2">
      {/* Line numbers come from a CSS counter, so copying the code never
          picks them up. */}
      <div className="type-body-compact min-w-max whitespace-pre text-foreground [counter-reset:line]">
        {LINES.map((line) => (
          <div
            className={cn(
              "flex h-4.5 pr-4 before:w-10 before:shrink-0 before:pr-4 before:text-right before:text-muted-foreground before:tabular-nums before:content-[counter(line)] before:[counter-increment:line]",
              line.number === CURRENT_LINE && "bg-wash before:text-foreground"
            )}
            key={line.number}
          >
            {line.tokens.map((token) => (
              <span className={TOKEN_CLASS[token.kind]} key={token.id}>
                {token.text}
              </span>
            ))}
            {line.number === CURRENT_LINE ? (
              <span className="ml-px w-px self-stretch bg-foreground" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Chrome ────────────────────────────────────────────────────────────── */

/** Close, minimise, zoom: muted syntax red, their olive mix, syntax green. */
function TrafficLights({ className }: { className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <span className="size-2.5 rounded-full bg-syn-3" />
      <span className="size-2.5 rounded-full bg-[color-mix(in_srgb,var(--syn-3),var(--syn-2))]" />
      <span className="size-2.5 rounded-full bg-syn-2" />
    </span>
  );
}

const TABS = ["cv.json", "inv-2026-014.json", "sapa.md"] as const;

function CodePane() {
  return (
    <div className="flex min-w-0 flex-col bg-card">
      <div className="flex h-9 shrink-0 items-stretch border-line border-b bg-pane-2">
        <TrafficLights className="px-3 md:hidden" />
        {TABS.map((tab, index) => (
          <span
            className={cn(
              "type-caption-compact flex items-center gap-1.5 border-line border-r px-3",
              index === 0
                ? "-mb-px bg-card text-foreground"
                : "hidden text-muted-foreground sm:flex"
            )}
            key={tab}
          >
            {index === 0 ? (
              <FileJson className="size-3 text-muted-foreground" />
            ) : null}
            {tab}
          </span>
        ))}
      </div>
      <div className="type-caption-compact flex h-7 shrink-0 items-center gap-1 border-line border-b px-3 text-muted-foreground">
        <span>data</span>
        <ChevronRight className="size-3" />
        <span>cv.json</span>
        <ChevronRight className="size-3" />
        <span className="text-foreground">headline</span>
      </div>
      <CodeLines />
    </div>
  );
}

const DOCUMENTS = [
  {
    builder: "CV",
    rows: [
      {
        id: "tokopedia",
        title: "Tokopedia · Frontend",
        detail: "cv.json · 2m",
      },
      { id: "gojek", title: "Gojek · internship" },
    ],
  },
  {
    builder: "Invoices",
    rows: [
      { id: "inv-014", title: "INV-2026-014 · Sinar Digital" },
      { id: "inv-015", title: "INV-2026-015 · draft" },
    ],
  },
  {
    builder: "Portfolio",
    rows: [{ id: "sapa", title: "Sapa · Academy 2027" }],
  },
] as const;

const ACTIVE_DOCUMENT = "tokopedia";

function DocumentSidebar() {
  return (
    <div className="hidden min-w-0 flex-col border-line border-r bg-pane md:flex">
      <div className="flex h-9 shrink-0 items-center gap-3 border-line border-b bg-pane-2 px-3">
        <TrafficLights />
        <span className="type-caption-compact flex items-center gap-1 text-muted-foreground">
          <Search className="size-3" />
          Search…
        </span>
      </div>
      <div className="flex flex-col gap-3 py-2">
        {DOCUMENTS.map((group) => (
          <div className="flex flex-col" key={group.builder}>
            <span className="type-caption-compact px-3 py-1 text-muted-foreground">
              {group.builder}
            </span>
            {group.rows.map((row) => {
              const active = row.id === ACTIVE_DOCUMENT;
              return (
                <div
                  className={cn(
                    "flex flex-col px-3 py-1",
                    active && "bg-pane-2"
                  )}
                  key={row.id}
                >
                  <span
                    className={cn(
                      "type-body-compact flex items-center gap-2 text-foreground",
                      active && "weight-semibold"
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        active && "pulse-dot bg-syn-1"
                      )}
                    />
                    <span className="truncate">{row.title}</span>
                  </span>
                  {"detail" in row ? (
                    <span className="type-caption-compact flex items-center gap-1 pl-3.5 text-muted-foreground">
                      <CornerDownRight className="size-3" />
                      {row.detail}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const TOOL_LINES = [
  "Read cv.json",
  "Read tokopedia-frontend.md",
  "Search cv.json for “React”",
] as const;

function AgentThread() {
  return (
    <div className="hidden min-w-0 flex-col border-line border-r bg-pane lg:flex">
      <div className="type-caption-compact flex h-9 shrink-0 items-center gap-1 border-line border-b bg-pane-2 px-3 text-foreground">
        <span className="weight-semibold">rina-wulandari</span>
        <CornerDownRight className="size-3 text-muted-foreground" />
        <span className="truncate text-muted-foreground">cv / tokopedia</span>
      </div>
      <div className="type-body-compact flex h-7 shrink-0 items-center border-line border-b px-3 text-foreground">
        <span className="truncate">Tailor my CV for the Tokopedia role</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <p className="type-body-compact rounded-sm border border-border bg-card px-2.5 py-2 text-foreground">
          Before I send it: does my CV fit the Tokopedia frontend posting? Fix
          anything that's off.
        </p>
        <ul className="type-caption-compact flex flex-col gap-1 text-muted-foreground">
          {TOOL_LINES.map((line) => (
            <li className="flex gap-1.5" key={line}>
              <span>○</span>
              {line}
            </li>
          ))}
        </ul>
        <p className="type-body-compact">
          It fits: React, TypeScript and your Gojek internship all match the
          posting. One typo in your headline, “Developr”. I underlined it so you
          can fix it before you export the PDF.
        </p>
        <span className="type-body-compact mt-auto rounded-md border border-input bg-card/60 px-2.5 py-1.5 text-muted-foreground">
          Ask about this CV…
        </span>
      </div>
    </div>
  );
}

/**
 * The light-theme editor window: 6px top corners, a hairline frame and the
 * float shadow. It rests on the band's bottom rule (no bottom border). Below
 * `md` it is the code pane alone; the documents join at `md` and the agent
 * thread at `lg` (256px / 1fr / 1.25fr).
 */
export function EditorMock({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <figcaption className="sr-only">
        The CV builder as an editor: Rina Wulandari's documents grouped by
        builder, an agent thread checking her CV against a Tokopedia job
        posting, and cv.json with a typo underlined in the headline.
      </figcaption>
      <div
        aria-hidden="true"
        className="grid overflow-hidden rounded-t-lg border border-border border-b-0 bg-pane shadow-float md:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1.25fr)]"
      >
        <DocumentSidebar />
        <AgentThread />
        <CodePane />
      </div>
    </figure>
  );
}
