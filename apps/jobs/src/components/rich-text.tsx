// Untrusted text, rendered inert (11 §4.1): scraped postings as plain text,
// notes as "Markdown-lite" (06 §5: bold, italic, links, lists — no HTML).
// Everything becomes React text nodes; links exist only for http(s) and
// mailto URLs and open with rel="noopener noreferrer". No HTML is ever parsed
// or injected.

import { cn } from "@rulisme/ui/lib/utils";
import type { ReactNode } from "react";
import { safeHref } from "@/lib/safe-url";

// **bold** | *italic* | _italic_ | [label](url) | bare http(s) URL
const INLINE_RE =
  /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(?<![\w])_([^_\n]+)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/;

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      className="text-primary underline-offset-4 hover:underline"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function linkOrText(label: string, raw: string, key: string): ReactNode {
  const href = safeHref(raw);
  if (!href) {
    // An unsafe target (javascript:, data:, relative): show the source as text.
    return <span key={key}>{`[${label}](${raw})`}</span>;
  }
  return (
    <ExternalLink href={href} key={key}>
      {label}
    </ExternalLink>
  );
}

function inlineNode(match: RegExpMatchArray, key: string): ReactNode {
  const [whole, bold, starItalic, underscoreItalic, label, url, bare] = match;
  if (bold !== undefined) {
    return <strong key={key}>{renderInline(bold, key)}</strong>;
  }
  const italic = starItalic ?? underscoreItalic;
  if (italic !== undefined) {
    return <em key={key}>{renderInline(italic, key)}</em>;
  }
  if (label !== undefined && url !== undefined) {
    return linkOrText(label, url, key);
  }
  if (bare !== undefined) {
    return linkOrText(bare, bare, key);
  }
  return whole;
}

/** Inline Markdown-lite → React nodes. */
export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const at = match.index ?? 0;
    if (at > last) {
      nodes.push(text.slice(last, at));
    }
    nodes.push(inlineNode(match, `${keyPrefix}-${at}`));
    last = at + match[0].length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

type Block =
  | { kind: "p"; lines: string[]; at: number }
  | { kind: "ul" | "ol"; items: { text: string; at: number }[]; at: number };

type LineKind =
  | { kind: "ul" | "ol"; text: string }
  | { kind: "blank" }
  | { kind: "text"; text: string };

function classifyLine(line: string): LineKind {
  const bullet = BULLET_RE.exec(line);
  if (bullet) {
    return { kind: "ul", text: bullet[1] ?? "" };
  }
  const numbered = NUMBERED_RE.exec(line);
  if (numbered) {
    return { kind: "ol", text: numbered[1] ?? "" };
  }
  return line.trim() === "" ? { kind: "blank" } : { kind: "text", text: line };
}

function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  // A blank line ends the current block.
  let open = false;
  for (const [at, line] of text.split("\n").entries()) {
    const last = open ? blocks.at(-1) : undefined;
    const classified = classifyLine(line);
    if (classified.kind === "blank") {
      open = false;
      continue;
    }
    open = true;
    if (classified.kind === "text") {
      if (last?.kind === "p") {
        last.lines.push(classified.text);
      } else {
        blocks.push({ kind: "p", lines: [classified.text], at });
      }
      continue;
    }
    const item = { text: classified.text, at };
    if (last && last.kind === classified.kind) {
      last.items.push(item);
    } else {
      blocks.push({ kind: classified.kind, items: [item], at });
    }
  }
  return blocks;
}

/** A note: paragraphs, lists, bold, italic and safe links. */
export function MarkdownLite({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 text-pretty", className)}>
      {blocksOf(text).map((block) => {
        const key = `b-${block.at}`;
        if (block.kind === "p") {
          return (
            <p className="whitespace-pre-line" key={key}>
              {renderInline(block.lines.join("\n"), key)}
            </p>
          );
        }
        const List = block.kind;
        return (
          <List
            className={cn(
              "flex flex-col gap-1 pl-5",
              List === "ul" ? "list-disc" : "list-decimal"
            )}
            key={key}
          >
            {block.items.map((item) => (
              <li key={`l-${item.at}`}>
                {renderInline(item.text, `l-${item.at}`)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** A scraped posting: plain text, line breaks kept, bare URLs linked. */
export function PlainText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const at = match.index ?? 0;
    if (at > last) {
      nodes.push(text.slice(last, at));
    }
    nodes.push(linkOrText(match[0], match[0], `u-${at}`));
    last = at + match[0].length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return (
    <div className={cn("whitespace-pre-line text-pretty", className)}>
      {nodes}
    </div>
  );
}
