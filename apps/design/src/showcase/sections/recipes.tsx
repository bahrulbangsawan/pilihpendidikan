import { cn } from "@rulisme/ui/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@rulisme/ui/ui/accordion";
import { AspectRatio } from "@rulisme/ui/ui/aspect-ratio";
import { Avatar, AvatarFallback } from "@rulisme/ui/ui/avatar";
import { Button } from "@rulisme/ui/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@rulisme/ui/ui/card";
import { Label } from "@rulisme/ui/ui/label";
import { Diamond } from "@rulisme/ui/ui/rails";
import { Switch } from "@rulisme/ui/ui/switch";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  Check,
  FileText,
  Play,
  Presentation,
  Receipt,
  Smile,
} from "lucide-react";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { EditorMock } from "../editor-mock";
import { Block, BlockGrid, Section } from "../layout";

/* ── Editor window ─────────────────────────────────────────────────────── */

/**
 * A band inside the column: the editor window rests on its bottom rule, the
 * "Watch demo" tab hangs from its top rule, and a diamond marks each place
 * the band's rules cross the column's side rules. The band clips the
 * window's shadow at its bottom rule; the diamonds sit outside the clip.
 * The negative margins undo the Section column's padding (px-5, sm:px-10 in
 * layout.tsx) so the band meets the side rules. Node offsets follow `--node`.
 */
function EditorStage() {
  const across = "-left-[calc(var(--node)/2_+_0.5px)]";
  const acrossEnd = "-right-[calc(var(--node)/2_+_0.5px)]";
  const top = "-top-[calc(var(--node)/2_-_0.5px)]";
  const bottom = "-bottom-[calc(var(--node)/2_-_0.5px)]";
  return (
    <div className="relative -mx-5 sm:-mx-10">
      <Diamond className={cn(top, across)} />
      <Diamond className={cn(top, acrossEnd)} />
      <Diamond className={cn(bottom, across)} />
      <Diamond className={cn(bottom, acrossEnd)} />
      <div className="relative overflow-hidden border-line border-y bg-wash px-5 pt-5 sm:px-10">
        <a
          className="type-caption absolute top-0 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-b-md border border-border border-t-0 bg-card px-3 text-foreground shadow-float transition-[background-color] hover:bg-pane"
          href="#example-screen"
        >
          <Play aria-hidden="true" className="size-3 fill-current" />
          Watch demo
        </a>
        <EditorMock />
      </div>
    </div>
  );
}

/* ── Feature cells ─────────────────────────────────────────────────────── */

/** A dark 16:9 screenshot placeholder in a 1px dashed frame 6px outside. */
function ShotFrame({ icon: Icon, url }: { icon: LucideIcon; url: string }) {
  return (
    <div className="outline-dashed outline-1 outline-line outline-offset-6">
      <AspectRatio className="bg-shot" ratio={16 / 9}>
        <div className="dark flex size-full flex-col items-center justify-center gap-1.5 p-3 text-center">
          <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="type-caption text-muted-foreground">{url}</span>
        </div>
      </AspectRatio>
    </div>
  );
}

const FEATURES = [
  {
    id: "cv",
    icon: FileText,
    url: "cv.pilihpendidikan.com",
    title: "A CV recruiters can read in six seconds",
    body: "Templates recruiters know, a live A4 preview beside the form, and a PDF that matches the preview line for line.",
  },
  {
    id: "invoice",
    icon: Receipt,
    url: "invoice.pilihpendidikan.com",
    title: "Invoices in rupiah, with PPN",
    body: "Totals with PPN 11%, every Indonesian province and your bank details, laid out so a client can pay from the PDF.",
  },
  {
    id: "portfolio",
    icon: Presentation,
    url: "portfolio.pilihpendidikan.com",
    title: "The Academy portfolio, one project per slide",
    body: "The A4 landscape deck the Apple Developer Academy asks for, with your screenshots in dashed frames.",
  },
] as const;

const FEATURE_QUESTIONS = [
  {
    id: "account",
    question: "Do I need an account?",
    answer:
      "No. Every builder saves in your browser first. Sign in with an email link only when you want a cloud copy or a share link.",
  },
  {
    id: "export",
    question: "Which files can I export?",
    answer:
      "PDF to apply with and JSON to keep. Import the JSON later, on any device, and carry on where you left off.",
  },
  {
    id: "language",
    question: "Can I write in Bahasa Indonesia?",
    answer:
      "Yes. Every template handles both languages, and the invoice builder knows rupiah, PPN and the provinces.",
  },
  {
    id: "assistant",
    question: "Can an AI assistant fill it in with me?",
    answer:
      "Connect one to the MCP server at api.pilihpendidikan.com with a personal token. It reads and edits the same documents you do.",
  },
] as const;

function FeatureCells() {
  return (
    <div className="border border-line bg-background">
      <div className="grid md:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            className="flex flex-col gap-5 border-line border-b p-6 md:border-r md:border-b-0 md:last:border-r-0"
            key={feature.id}
          >
            <ShotFrame icon={feature.icon} url={feature.url} />
            <div className="flex flex-col gap-1.5">
              <h4 className="type-subtitle weight-semibold">{feature.title}</h4>
              <p className="type-body">{feature.body}</p>
            </div>
          </div>
        ))}
      </div>
      <Accordion className="border-line border-t" collapsible type="single">
        {FEATURE_QUESTIONS.map((item) => (
          <AccordionItem className="px-6" key={item.id} value={item.id}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent>
              <p className="max-w-prose">{item.answer}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

/* ── Testimonials ──────────────────────────────────────────────────────── */

const TESTIMONIALS = [
  {
    id: "rina",
    initials: "RW",
    name: "Rina Wulandari",
    role: "Informatics student, Universitas Brawijaya",
    before:
      "I rewrote my CV the night before the career fair. The PDF looked exactly like the preview, and ",
    marked: "three recruiters asked where I made it",
    after: ".",
  },
  {
    id: "dimas",
    initials: "DP",
    name: "Dimas Pratama",
    role: "Academy applicant, Institut Teknologi Bandung",
    before: "The portfolio template showed me what the reviewers look for, so ",
    marked: "I spent my week on the projects, not the slides",
    after: ". I got the interview.",
  },
  {
    id: "ayu",
    initials: "AS",
    name: "Ayu Saraswati",
    role: "Freelance illustrator, Yogyakarta",
    before:
      "My first invoice to a Jakarta studio had the PPN, my BCA account and a due date on one page. ",
    marked: "They paid in two days",
    after: ".",
  },
] as const;

const RAISED_TESTIMONIAL = "dimas";

function Testimonials() {
  return (
    <div className="grid items-start gap-8 md:grid-cols-3">
      {TESTIMONIALS.map((testimonial) => {
        const raised = testimonial.id === RAISED_TESTIMONIAL;
        return (
          <figure
            className={cn(
              "flex flex-col gap-5 border border-border bg-card p-6",
              raised ? "graph-paper shadow-offset" : "md:mt-8"
            )}
            key={testimonial.id}
          >
            <blockquote className="type-subtitle text-foreground">
              {testimonial.before}
              <mark className="bg-highlight text-foreground">
                {testimonial.marked}
              </mark>
              {testimonial.after}
            </blockquote>
            <figcaption className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>{testimonial.initials}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="type-body weight-semibold text-foreground">
                  {testimonial.name}
                </span>
                <span className="type-caption text-muted-foreground">
                  {testimonial.role}
                </span>
              </div>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/* ── Stats band ────────────────────────────────────────────────────────── */

const CONTRIBUTORS = [
  "RW",
  "DP",
  "AS",
  "BH",
  "SL",
  "PA",
  "AN",
  "MW",
  "NA",
  "FN",
  "WS",
  "SR",
  "RM",
  "DA",
  "YH",
  "IP",
  "HG",
  "LP",
  "KA",
  "FH",
  "AG",
  "MK",
  "TS",
  "RS",
  "BF",
  "NS",
  "GR",
  "CL",
  "EP",
  "WD",
  "IK",
  "OS",
  "VA",
  "ZH",
  "UP",
  "JT",
  "QA",
  "XL",
  "HM",
  "TW",
  "LS",
  "KN",
  "YR",
  "DS",
  "MN",
  "AW",
  "RF",
  "PS",
] as const;

const STATS = [
  { id: "cvs", value: 48_210, label: "CVs exported" },
  { id: "invoices", value: 12_906, label: "Invoices sent" },
  { id: "portfolios", value: 1384, label: "Academy portfolios" },
  { id: "mcp", value: 96_450, label: "MCP tool calls" },
] as const;

const count = new Intl.NumberFormat("en-US");

function StatsBand() {
  return (
    <div className="border border-line bg-background">
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <h4 className="type-title text-primary">
          Made with students across Indonesia
        </h4>
        <p className="type-body max-w-md">
          Templates, translations and fixes come from people who were writing
          their own CV at the time.
        </p>
      </div>
      <div className="border-line border-y px-6 py-3">
        <p className="sr-only">
          {CONTRIBUTORS.length} people have contributed.
        </p>
        {/* One row only: the ribbon wraps into a clipped second row, so no
            avatar is ever cut in half. */}
        <div
          aria-hidden="true"
          className="flex h-5 flex-wrap justify-center gap-1 overflow-hidden"
        >
          {CONTRIBUTORS.map((initials) => (
            <Avatar className="size-5" key={initials}>
              <AvatarFallback className="type-micro-compact">
                {initials}
              </AvatarFallback>
            </Avatar>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 md:grid-cols-4">
        {STATS.map((stat) => (
          <div
            className="flex flex-col-reverse justify-end gap-1 border-line not-last:border-r p-4 max-md:nth-2:border-r-0 max-md:nth-[-n+2]:border-b sm:p-6"
            key={stat.id}
          >
            <dt className="type-caption text-muted-foreground">{stat.label}</dt>
            <dd className="type-display text-foreground tabular-nums">
              {count.format(stat.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── Template tiles ────────────────────────────────────────────────────── */

const BUILDER_URL = {
  cv: "https://cv.pilihpendidikan.com",
  invoice: "https://invoice.pilihpendidikan.com",
  portfolio: "https://portfolio.pilihpendidikan.com",
} as const;

const TEMPLATES = [
  {
    id: "harvard",
    builder: "cv",
    name: "Harvard",
    downloads: "12.4k",
    description: "One column, the classic order.",
    author: "pilihpendidikan",
  },
  {
    id: "standard",
    builder: "cv",
    name: "Standard",
    downloads: "9.8k",
    description: "Two columns with a skills sidebar.",
    author: "pilihpendidikan",
  },
  {
    id: "invoice-a4",
    builder: "invoice",
    name: "Invoice A4",
    downloads: "6.1k",
    description: "Rupiah totals with PPN 11%.",
    author: "pilihpendidikan",
  },
  {
    id: "academy",
    builder: "portfolio",
    name: "Academy deck",
    downloads: "3.9k",
    description: "The Academy's landscape deck.",
    author: "pilihpendidikan",
  },
  {
    id: "simple",
    builder: "cv",
    name: "Simple",
    downloads: "3.2k",
    description: "Plain text job portals can parse.",
    author: "Rina Wulandari",
  },
  {
    id: "internship",
    builder: "cv",
    name: "Internship",
    downloads: "2.7k",
    description: "Projects before experience.",
    author: "Dimas Pratama",
  },
  {
    id: "invoice-usd",
    builder: "invoice",
    name: "Invoice in dollars",
    downloads: "2.2k",
    description: "For clients abroad, with a SWIFT code.",
    author: "Ayu Saraswati",
  },
  {
    id: "case-study",
    builder: "portfolio",
    name: "Case study",
    downloads: "1.7k",
    description: "Problem, process, result.",
    author: "Bagus Hartono",
  },
  {
    id: "teaching",
    builder: "cv",
    name: "Teaching assistant",
    downloads: "1.2k",
    description: "Courses and labs up front.",
    author: "Sri Lestari",
  },
  {
    id: "kwitansi",
    builder: "invoice",
    name: "Kwitansi",
    downloads: "980",
    description: "A receipt with the amount in words.",
    author: "Andi Saputra",
  },
  {
    id: "basic",
    builder: "cv",
    name: "Basic",
    downloads: "760",
    description: "A first CV with education at the top.",
    author: "Putu Ardana",
  },
  {
    id: "night-deck",
    builder: "portfolio",
    name: "Night deck",
    downloads: "540",
    description: "The Academy deck on a dark cover.",
    author: "Made Wirawan",
  },
] as const;

const TILES_PER_ROW = 4;

// The second row fades to 55% and the third to 22%: more below, not more
// to click. Faded tiles are inert.
const ROW_FADE = ["", "opacity-55", "opacity-22"] as const;

function TemplateTiles() {
  return (
    <div className="flex flex-col items-center gap-4">
      <ul className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
        {TEMPLATES.map((template, index) => {
          const row = Math.floor(index / TILES_PER_ROW);
          const faded = row > 0;
          return (
            <li className={ROW_FADE[row]} inert={faded} key={template.id}>
              <a
                className="inset-shadow-lip flex h-full flex-col gap-1.5 rounded-sm border border-border/60 bg-card/60 p-3 transition-[background-color,box-shadow] hover:inset-shadow-none hover:bg-pane/70"
                href={BUILDER_URL[template.builder]}
                rel="noopener"
                target="_blank"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="type-body weight-semibold min-w-0 text-foreground">
                    {template.name}
                  </span>
                  <span className="type-caption flex shrink-0 items-center gap-0.5 text-muted-foreground tabular-nums">
                    <ArrowDown aria-hidden="true" className="size-3" />
                    <span className="sr-only">Downloads:</span>
                    {template.downloads}
                  </span>
                </span>
                <span className="type-caption truncate text-muted-foreground">
                  {template.description}
                </span>
                <span className="type-caption flex items-center gap-1 text-muted-foreground">
                  <Smile aria-hidden="true" className="size-3" />
                  <span className="sr-only">By</span>
                  {template.author}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <Button asChild variant="link">
        <a href={BUILDER_URL.cv} rel="noopener" target="_blank">
          Browse every template
        </a>
      </Button>
    </div>
  );
}

/* ── Plans ─────────────────────────────────────────────────────────────── */

function PlanFeatures({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li className="type-body flex gap-2" key={item}>
          <Check
            aria-hidden="true"
            className="mt-0.75 size-3.5 shrink-0 text-primary"
          />
          {item}
        </li>
      ))}
    </ul>
  );
}

function PlanPrice({ note }: { note: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="type-display weight-semibold text-primary tabular-nums">
        Rp 0
      </span>
      <span className="type-caption text-muted-foreground">{note}</span>
    </p>
  );
}

function PlanCard({
  label,
  highlighted = false,
  children,
  action,
}: {
  label: string;
  highlighted?: boolean;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <Card className={cn(highlighted && "graph-paper shadow-offset")}>
      <CardHeader className="gap-2">
        <p
          className={cn(
            "type-caption",
            highlighted ? "text-primary" : "text-muted-foreground"
          )}
        >
          {label}
        </p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        {children}
      </CardContent>
      <CardFooter>{action}</CardFooter>
    </Card>
  );
}

const STUDENT_FEATURES = [
  "The CV, invoice and portfolio builders",
  "PDF and JSON export, as often as you like",
  "Saved in your browser, no account needed",
] as const;

const CAMPUS_FEATURES = [
  "Everything students get",
  "One link to share a template with a cohort",
  "Read-only links for career advisers",
] as const;

const API_FEATURES = [
  "The MCP server at api.pilihpendidikan.com/mcp",
  "Read or write personal tokens from /connect",
  "Sign-in and new tokens are rate-limited",
] as const;

function Plans() {
  const trialId = useId();
  const [trial, setTrial] = useState(true);
  const campusFeatures = trial
    ? [
        ...CAMPUS_FEATURES,
        "Bulk export of every student's CV, free for 30 days",
      ]
    : CAMPUS_FEATURES;

  return (
    <div className="grid gap-8 md:grid-cols-3">
      <PlanCard
        action={
          <Button asChild className="w-full" variant="outline">
            <a href={BUILDER_URL.cv} rel="noopener" target="_blank">
              Start a CV
            </a>
          </Button>
        }
        label="Student"
      >
        <PlanPrice note="for good" />
        <PlanFeatures items={STUDENT_FEATURES} />
      </PlanCard>

      <PlanCard
        action={
          <Button
            className="w-full"
            onClick={() =>
              toast.success(
                trial ? "Campus trial selected" : "Campus plan selected",
                {
                  description: trial
                    ? "Bulk export is free for 30 days, then it switches off."
                    : "Builders and share links, without bulk export.",
                }
              )
            }
          >
            {trial ? "Start the free trial" : "Choose the campus plan"}
          </Button>
        }
        highlighted
        label="Campus career centre"
      >
        <PlanPrice
          note={trial ? "with a free trial of bulk export" : "a month"}
        />
        <div className="flex items-center gap-2">
          <Switch checked={trial} id={trialId} onCheckedChange={setTrial} />
          <Label htmlFor={trialId}>Free trial</Label>
        </div>
        <PlanFeatures items={campusFeatures} />
      </PlanCard>

      <PlanCard
        action={
          <Button
            asChild
            className="w-full bg-wash text-primary hover:bg-highlight"
            variant="secondary"
          >
            <a
              href="https://api.pilihpendidikan.com/connect"
              rel="noopener"
              target="_blank"
            >
              Get a personal token
            </a>
          </Button>
        }
        label="API"
      >
        <PlanPrice note="rate-limited" />
        <PlanFeatures items={API_FEATURES} />
      </PlanCard>
    </div>
  );
}

/* ── The letter ────────────────────────────────────────────────────────── */

/** The wordmark diamond pressed into a round cobalt seal. */
function Seal({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-12 place-items-center rounded-full bg-primary shadow-primary",
        className
      )}
    >
      <span className="grid size-9 place-items-center rounded-full border border-primary-foreground/40">
        <span className="size-3 rotate-45 border border-primary-foreground" />
      </span>
    </span>
  );
}

function Letter() {
  return (
    <div className="graph-paper relative mx-auto w-full max-w-2xl border border-border bg-pane px-4 pt-16 pb-4 shadow-offset [--grid:12px] sm:px-10 sm:pb-10">
      {/* The flap: two hairlines from the envelope's top corners to the seal. */}
      <svg
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-12 w-full text-line"
        preserveAspectRatio="none"
        viewBox="0 0 100 48"
      >
        <path
          d="M0 0 L50 48 L100 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <Seal className="absolute top-6 left-1/2 z-10 -translate-x-1/2" />
      <article className="relative border border-border bg-[radial-gradient(circle,transparent_3px,var(--gridline)_3px,var(--gridline)_4px,transparent_4px)] bg-card bg-size-[14px_14px] px-6 py-8 sm:px-10">
        <p className="type-caption text-muted-foreground">A letter</p>
        <h4 className="type-title mt-2">To everyone writing their first CV</h4>
        <div className="type-body mt-4 flex flex-col gap-3">
          <p>
            The blank page is the hardest part of applying, so we made the first
            draft quick. Start with what you have done, even if it feels small:
            a lab assistant job, a competition, a project nobody graded. It all
            counts.
          </p>
          <p>
            Everything stays in your browser until you choose otherwise, and
            every export is free. When the interview call comes, we hope you
            pick up feeling ready.
          </p>
        </div>
        <hr className="my-6 border-line" />
        <p className="type-subtitle text-foreground italic">
          Tim pilihpendidikan
        </p>
        <p className="type-caption text-muted-foreground">October 2026</p>
      </article>
    </div>
  );
}

/* ── Section ───────────────────────────────────────────────────────────── */

// Renders: the DESIGN.md recipes (editor window, feature cells, testimonials,
// stats band, template tiles, plans, the letter).
export function RecipesSection() {
  return (
    <Section
      id="recipes"
      lead="The DESIGN.md's named pieces rebuilt from tokens and components, in the builders' own words."
      title="Recipes"
    >
      <BlockGrid>
        <Block
          description="The product shown, not described: a light-theme window drawn in HTML. Documents grouped by builder, an agent thread and cv.json with a typo underlined. Below md only the code pane stays."
          title="Editor window"
          wide
        >
          <EditorStage />
        </Block>
        <Block
          description="Three butted cells, each with a dashed-frame screenshot, a semibold subtitle and body text; full-width rows ending in + below them."
          title="Feature cells"
          wide
        >
          <FeatureCells />
        </Block>
        <Block
          description="Quotes in black at the subtitle role, one phrase marked; the middle card is raised on graph paper with the flat cobalt offset."
          title="Testimonials"
          wide
        >
          <Testimonials />
        </Block>
        <Block
          description="A cobalt title, a ribbon of 20px avatars between hairlines, then four stat cells with display-size tabular numbers."
          title="Stats band"
          wide
        >
          <StatsBand />
        </Block>
        <Block
          description="2px tiles with the lip, a download count, one line of description and the author. The last rows fade to 55% and 22%."
          title="Template tiles"
          wide
        >
          <TemplateTiles />
        </Block>
        <Block
          description="Square cards 32px apart: a caption label, a display-size cobalt price, cobalt ticks and a full-width button pinned to the bottom. The middle card is on graph paper with the primary action."
          title="Plans"
          wide
        >
          <Plans />
        </Block>
        <Block
          description="A bordered envelope with graph paper and the flat offset, holding a sheet with a ring pattern under a round seal."
          title="The letter"
          wide
        >
          <Letter />
        </Block>
      </BlockGrid>
    </Section>
  );
}
