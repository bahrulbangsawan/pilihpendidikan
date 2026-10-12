import { Font } from "@react-pdf/renderer";
import { hyphenateForPrint } from "@rulisme/ui/print/pdf-fonts";
import type { ReactNode } from "react";
import { Fragment, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import sample from "@/data/sample-portfolio.json";
import { getT } from "@/i18n";
import styles from "../styles.css?raw";
import type { Portfolio, PortfolioOwner } from "./portfolio-data-model";
import { PortfolioDocument } from "./portfolio-pdf";
import { PortfolioPreview } from "./portfolio-preview";

// The deck as its two renderers draw it from the same portfolio: the
// @react-pdf document as the element tree react-pdf lays out (function
// components expanded, primitives such as "TEXT" and "VIEW" kept with their
// styles flattened), and the on-screen preview as server-rendered markup.
// How a browser lays the preview out is checked in a browser; the
// stylesheet's own rules are in deck-layout.test.ts and deck-palette.test.ts.

const t = getT("en");
const SAMPLE = sample as Portfolio;
const [LUMEN] = SAMPLE.projects;

function withOwner(owner: Partial<PortfolioOwner>): Portfolio {
  return { ...SAMPLE, owner: { ...SAMPLE.owner, ...owner } };
}

// Background takes two entries and Contact one.
const PROFESSIONAL = withOwner({
  affiliation: {
    kind: "professional",
    organization: "Kementerian Pendidikan, Kebudayaan, Riset, dan Teknologi",
    jobTitle: "Product Designer",
    yearsExperience: 7,
  },
  contact: { email: "ayu@kemdikbud.go.id", phone: "", socials: [] },
});

// Background takes one entry and Contact two, its link typed without a
// scheme.
const INDEPENDENT = withOwner({
  affiliation: { kind: "independent" },
  contact: {
    email: "",
    phone: "+62 812 3456 7890",
    socials: [{ label: "", url: "linkedin.com/in/ayu" }],
  },
});

// Two background lines that read the same.
const TWINS = withOwner({
  affiliation: {
    kind: "student",
    institution: "Universitas Example",
    program: "Universitas Example",
    semester: 6,
  },
});

const ARROW = "M4 12 L20 12 M13 5 L20 12 L13 19";
const PREVIEW_COLUMN = /<h4>(.*?)<\/h4><p>(.*?)<\/p>/g;
const PREVIEW_ENTRY =
  /<span class="pf-cover__line" style="-webkit-line-clamp:(\d+)">(.*?)<\/span>/g;
const TAG = /<[^>]+>/g;
const ENTITY = /&(amp|lt|gt|quot|#x27);/g;
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#x27": "'",
};
const PALETTE_ENTRY = /--pf-[a-z-]+: (#[0-9a-f]{6});/g;
const TAGS_PINNED = /\.pf-field--tech \{\s*margin-top: auto;/;

// ── The PDF as an element tree ────────────────────────────

interface PdfNode {
  type: string;
  key: string | null;
  props: Record<string, unknown>;
  style: Record<string, unknown>;
  children: PdfChild[];
}
type PdfChild = PdfNode | string;

function flatStyle(style: unknown): Record<string, unknown> {
  const parts = [style]
    .flat(Number.POSITIVE_INFINITY)
    .filter((part) => typeof part === "object" && part !== null);
  return Object.assign({}, ...parts);
}

function expand(node: ReactNode): PdfChild[] {
  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }
  if (Array.isArray(node)) {
    return node.flatMap(expand);
  }
  if (!isValidElement<Record<string, unknown>>(node)) {
    return [];
  }
  const { type, props, key } = node;
  if ((type as unknown) === Fragment) {
    return expand(props.children as ReactNode);
  }
  if (typeof type === "function") {
    return expand((type as (p: Record<string, unknown>) => ReactNode)(props));
  }
  const { children, style, ...rest } = props;
  return [
    {
      type: String(type),
      key,
      props: rest,
      style: flatStyle(style),
      children: expand(children as ReactNode),
    },
  ];
}

function descendants(node: PdfNode): PdfNode[] {
  return node.children.flatMap((child) =>
    typeof child === "string" ? [] : [child, ...descendants(child)]
  );
}

function textOf(node: PdfChild): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

function nodesOf(child: PdfChild | undefined): PdfNode[] {
  return child && typeof child !== "string" ? [child] : [];
}

function pdfPages(data: Portfolio): PdfNode[] {
  return expand(<PortfolioDocument data={data} t={t} />)
    .flatMap(nodesOf)
    .flatMap(descendants)
    .filter((node) => node.type === "PAGE");
}

function everyNode(data: Portfolio): PdfNode[] {
  return pdfPages(data).flatMap((page) => [page, ...descendants(page)]);
}

// The innermost node that reads `text`.
function find(nodes: PdfNode[], text: string): PdfNode {
  const node = [...nodes].reverse().find((n) => textOf(n) === text);
  if (!node) {
    throw new Error(`no node reads "${text}"`);
  }
  return node;
}

function parentOf(nodes: PdfNode[], child: PdfNode): PdfNode {
  const parent = nodes.find((node) => node.children.includes(child));
  if (!parent) {
    throw new Error("the node has no parent");
  }
  return parent;
}

// A rail field: the View its label heads.
function field(nodes: PdfNode[], label: string): PdfNode {
  return parentOf(nodes, find(nodes, label));
}

// ── The cover footer in both renderers ────────────────────

interface FootColumn {
  heading: string;
  entries: { text: string; lines: unknown }[];
}

// The cover ends in its footer row: four columns, each a heading Text and
// its entries' Texts.
function pdfFootColumns(data: Portfolio): PdfNode[][] {
  const [cover] = pdfPages(data);
  const row = nodesOf(cover?.children.at(-1))[0];
  return (row?.children ?? []).map((column) =>
    nodesOf(column).flatMap((c) => c.children.flatMap(nodesOf))
  );
}

function pdfColumns(data: Portfolio): FootColumn[] {
  return pdfFootColumns(data).map(([heading, ...entries]) => ({
    heading: heading ? textOf(heading) : "",
    entries: entries.map((entry) => ({
      text: textOf(entry),
      lines: entry.style.maxLines,
    })),
  }));
}

function plain(html: string): string {
  return html
    .replace(TAG, "")
    .replace(ENTITY, (_, name: string) => ENTITIES[name] ?? name);
}

function previewMarkup(data: Portfolio): string {
  return renderToStaticMarkup(<PortfolioPreview data={data} fit={false} />);
}

function previewColumns(data: Portfolio): FootColumn[] {
  return [...previewMarkup(data).matchAll(PREVIEW_COLUMN)].map(
    ([, heading = "", body = ""]) => ({
      heading: plain(heading),
      entries: [...body.matchAll(PREVIEW_ENTRY)].map(
        ([, lines, entry = ""]) => ({
          text: plain(entry),
          lines: Number(lines),
        })
      ),
    })
  );
}

const lineCounts = (columns: FootColumn[]) =>
  columns.map((column) => column.entries.map((entry) => entry.lines));

describe("portfolio cover footer", () => {
  it("gives a column's first entry the lines the later ones leave", () => {
    expect(lineCounts(pdfColumns(SAMPLE))).toEqual([
      [2, 1],
      [1, 1, 1],
      [1, 1, 1],
      [3],
    ]);
    expect(lineCounts(pdfColumns(PROFESSIONAL))).toEqual([
      [2, 1],
      [2, 1],
      [3],
      [3],
    ]);
    expect(lineCounts(pdfColumns(INDEPENDENT))).toEqual([
      [2, 1],
      [3],
      [2, 1],
      [3],
    ]);
  });

  it.each([
    ["the sample", SAMPLE],
    ["a professional", PROFESSIONAL],
    ["an independent", INDEPENDENT],
  ])("shows %s's entries alike on screen and on paper", (_, data) => {
    const columns = pdfColumns(data);
    expect(columns).toHaveLength(4);
    expect(previewColumns(data)).toEqual(columns);
  });

  it("ends every entry the PDF clamps in an ellipsis", () => {
    const entries = pdfFootColumns(SAMPLE).flatMap((column) => column.slice(1));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.style.textOverflow).toBe("ellipsis");
    }
  });

  it("keeps two background lines that read the same", () => {
    const background = pdfFootColumns(TWINS)[1] ?? [];
    const keys = background.slice(1).map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(background.map(textOf)).toEqual([
      "Background",
      "Universitas Example",
      "Student · Semester 6",
      "Universitas Example",
    ]);
  });
});

describe("portfolio deck links", () => {
  const bare: Portfolio = {
    ...INDEPENDENT,
    projects: [{ ...LUMEN, publicationUrl: "apps.apple.com/app/lumen" }],
  };

  it("opens an address typed without a scheme as a site, on paper", () => {
    const links = everyNode(bare)
      .filter((node) => node.type === "LINK")
      .map((node) => node.props.src);
    expect(links).toContain("https://linkedin.com/in/ayu");
    expect(links).toContain("https://apps.apple.com/app/lumen");
  });

  it("opens it the same way on screen and in the browser's print", () => {
    const markup = previewMarkup(bare);
    expect(markup).toContain('href="https://linkedin.com/in/ayu"');
    expect(markup).toContain('href="https://apps.apple.com/app/lumen"');
    expect(markup).not.toContain('href="linkedin.com');
    expect(markup).not.toContain('href="apps.apple.com');
  });
});

describe("portfolio deck clamps", () => {
  const [cover, page] = pdfPages({ ...SAMPLE, projects: [LUMEN] });
  const coverNodes = cover ? descendants(cover) : [];
  const nodes = page ? descendants(page) : [];

  it("clamps every one-line slot of the PDF with an ellipsis", () => {
    // A fixed height alone is no clamp: react-pdf keeps no line of a box
    // that overflows when the box is exactly one line tall.
    const { owner } = SAMPLE;
    const footer = nodesOf(page?.children.at(-1))[0];
    const slots = [
      find(coverNodes, t("preview.kicker", { year: SAMPLE.cohortYear ?? "" })),
      find(coverNodes, `${owner.fullName} · ${owner.headline}`),
      ...pdfFootColumns(SAMPLE).map(([heading]) => heading),
      find(nodes, LUMEN.role),
      ...(LUMEN.scopeOfWork ?? []).map((item) => find(nodes, item)),
      ...nodes.filter((node) => node.type === "LINK"),
      ...(footer ? descendants(footer) : []).filter(
        (node) => node.type === "TEXT" && node.style.maxLines !== undefined
      ),
    ];
    // The kicker, subtitle, four headings, role, the items, the link and
    // the footer's two texts.
    expect(slots).toHaveLength(
      2 + 4 + 1 + (LUMEN.scopeOfWork ?? []).length + 1 + 2
    );
    for (const slot of slots) {
      expect(slot?.style.maxLines).toBe(1);
      expect(slot?.style.textOverflow).toBe("ellipsis");
    }
  });

  it("lets Scope of Work give way when the rail is full", () => {
    const sow = field(nodes, "Scope of work");
    expect(sow.style.flexShrink).toBeGreaterThan(1);
    expect(sow.style.minHeight).toBe(0);
    const [list] = nodesOf(sow.children.at(-1));
    expect(list?.style.flexWrap).toBe("wrap");
    expect(list?.style.overflow).toBe("hidden");
  });

  it("pins the tags to the foot of the rail, as the preview does", () => {
    const tags = field(nodes, "Technologies");
    expect(parentOf(nodes, tags).children.at(-1)).toBe(tags);
    expect(tags.style.marginTop).toBe("auto");
    expect(styles).toMatch(TAGS_PINNED);
  });

  it("titles and notes the empty image slot in both renderers", () => {
    const title = find(nodes, t("preview.artworkTitle"));
    const note = find(nodes, t("preview.artworkNote"));
    expect(parentOf(nodes, note)).toBe(parentOf(nodes, title));
    expect(note.style.maxLines).toBe(2);
    expect(previewMarkup(SAMPLE)).toContain(
      `<div class="pf-ph-note">${t("preview.artworkNote")}</div>`
    );
  });

  it("keeps a 16:9 image inside its hairline frame", () => {
    const withImage = everyNode({
      ...SAMPLE,
      projects: [
        {
          ...LUMEN,
          media: [
            {
              type: "image",
              url: "data:image/png;base64,iVBORw0KGgo=",
              alt: "",
              width: 1920,
              height: 1080,
            },
          ],
        },
      ],
    });
    const image = withImage.find((node) => node.type === "IMAGE");
    if (!image) {
      throw new Error("the project shows its image");
    }
    const frame = parentOf(withImage, image).style;
    const width = Number(frame.width);
    const height = Number(frame.height);
    const border = Number(frame.borderWidth);
    expect(width / height).toBeCloseTo(16 / 9, 2);
    expect(image.style.width).toBe(width - 2 * border);
    expect(image.style.height).toBe(height - 2 * border);
  });
});

describe("portfolio PDF text", () => {
  it("sets no newline inside any text", () => {
    // react-pdf sets a character Inter lacks in its built-in, unembedded
    // Helvetica.
    const strings = everyNode({
      ...withOwner({ headline: "iOS\nand product" }),
      projects: [
        {
          ...LUMEN,
          summary: "First line\nsecond line",
          impact: "Shipped\r\nto 40 users",
        },
      ],
    }).flatMap((node) =>
      node.children.filter((child) => typeof child === "string")
    );
    expect(strings.length).toBeGreaterThan(0);
    expect(strings.filter((text) => text.includes("\n"))).toEqual([]);
  });

  it("draws the cover arrow instead of typing it, in both renderers", () => {
    // Inter's latin cut has no rightwards arrow (U+2192).
    const nodes = everyNode(SAMPLE);
    expect(nodes.some((node) => node.props.d === ARROW)).toBe(true);
    expect(nodes.some((node) => textOf(node).includes("→"))).toBe(false);
    const markup = previewMarkup(SAMPLE);
    expect(markup).toContain(`d="${ARROW}"`);
    expect(markup).not.toContain("→");
  });
});

describe("portfolio PDF type and colour", () => {
  const nodes = everyNode(SAMPLE);
  const values = (property: string) =>
    nodes
      .map((node) => node.style[property])
      .filter((value) => value !== undefined);

  it("registers Inter and the shared line-break policy", () => {
    expect(Font.getRegisteredFontFamilies()).toContain("Inter");
    expect(Font.getHyphenationCallback()).toBe(hyphenateForPrint);
  });

  it("sets Inter on every page and no other family", () => {
    const pages = nodes.filter((node) => node.type === "PAGE");
    expect(pages).toHaveLength(SAMPLE.projects.length + 1);
    expect(pages.every((page) => page.style.fontFamily === "Inter")).toBe(true);
    expect(new Set(values("fontFamily"))).toEqual(new Set(["Inter"]));
  });

  it("uses only the 400, 600 and 700 cuts", () => {
    expect(new Set(values("fontWeight"))).toEqual(new Set([400, 600, 700]));
  });

  it("sets no case transform and no letter-spacing", () => {
    expect(values("textTransform")).toEqual([]);
    expect(values("letterSpacing")).toEqual([]);
  });

  it("paints with exactly the palette of the preview's paper", () => {
    // The `.pf-deck` rule's custom properties: the paper's literal colours.
    const deck = styles.slice(styles.indexOf(".pf-deck {"));
    const palette = [
      ...deck.slice(0, deck.indexOf("}")).matchAll(PALETTE_ENTRY),
    ].map(([, hex]) => hex);
    const painted = nodes.flatMap((node) => [
      ...Object.entries(node.style)
        .filter(([property]) => property.toLowerCase().endsWith("color"))
        .map(([, value]) => value),
      ...(node.type === "PATH" ? [node.props.stroke] : []),
    ]);
    expect(palette.length).toBeGreaterThan(0);
    expect(new Set(painted)).toEqual(new Set(palette));
  });

  it("gives chips and the image tile 2px corners", () => {
    // 8 rounds the cover arrow's 16pt ring into a circle.
    expect(new Set(values("borderRadius"))).toEqual(new Set([2, 8]));
  });
});
