import { SectionList } from "@rulisme/ui/form/section-list";
import { FormField } from "@rulisme/ui/form/form-field";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@rulisme/ui/ui/accordion";
import { AspectRatio } from "@rulisme/ui/ui/aspect-ratio";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@rulisme/ui/ui/avatar";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@rulisme/ui/ui/card";
import type { CarouselApi } from "@rulisme/ui/ui/carousel";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@rulisme/ui/ui/carousel";
import type { ChartConfig } from "@rulisme/ui/ui/chart";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@rulisme/ui/ui/chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rulisme/ui/ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@rulisme/ui/ui/item";
import { Band, Diamond, Rail } from "@rulisme/ui/ui/rails";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@rulisme/ui/ui/resizable";
import { ScrollArea, ScrollBar } from "@rulisme/ui/ui/scroll-area";
import { Separator } from "@rulisme/ui/ui/separator";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import {
  ChevronsUpDown,
  Download,
  FileText,
  ImageIcon,
  Info,
  MoreHorizontal,
  Plus,
  Presentation,
  Receipt,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Block, BlockGrid, Example, Section } from "../layout";

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/* ── Card ──────────────────────────────────────────────────────────────── */

function CardBlock() {
  return (
    <Block
      description="Plan and feature cards: square, bordered, flat. A highlighted card adds the flat cobalt offset and graph paper; the footer sits under a hairline."
      title="Card"
      wide
    >
      <div className="grid items-start gap-8 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Rina Wulandari</CardTitle>
            <CardDescription>
              Frontend Developer CV · edited 2 hours ago
            </CardDescription>
            <CardAction>
              <Badge variant="secondary">Saved</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p>
              Two pages on the Harvard template, shared with three recruiters
              this week.
            </p>
          </CardContent>
        </Card>
        <Card className="graph-paper shadow-offset">
          <CardHeader>
            <CardTitle>Academy portfolio</CardTitle>
            <CardDescription>
              For the Apple Developer Academy application
            </CardDescription>
            <CardAction>
              <Badge variant="outline">New</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p>
              A landscape deck of your apps, one project per slide, with
              screenshots in a dashed frame.
            </p>
          </CardContent>
          <CardFooter>
            <Button className="w-full">Start a portfolio</Button>
          </CardFooter>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>INV-2026-014</CardTitle>
            <CardDescription>
              PT Sinar Digital Nusantara · due 25 October
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="type-title text-foreground tabular-nums">
              {rupiah.format(7_881_000)}
            </p>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="type-caption text-muted-foreground">
              Sent 11 October
            </span>
            <Button size="xs" variant="outline">
              Send reminder
            </Button>
          </CardFooter>
        </Card>
      </div>
    </Block>
  );
}

/* ── Table ─────────────────────────────────────────────────────────────── */

const LINE_ITEMS = [
  {
    id: "design",
    description: "UI design, landing page and two inner pages",
    quantity: "1 project",
    price: 2_500_000,
    amount: 2_500_000,
  },
  {
    id: "frontend",
    description: "Frontend development in React",
    quantity: "24 hours",
    price: 150_000,
    amount: 3_600_000,
  },
  {
    id: "hosting",
    description: "Cloudflare Workers setup and deploy",
    quantity: "1 project",
    price: 500_000,
    amount: 500_000,
  },
  {
    id: "revisions",
    description: "Revision rounds",
    quantity: "2 rounds",
    price: 250_000,
    amount: 500_000,
  },
] as const;

function LineItemsHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Description</TableHead>
        <TableHead>Quantity</TableHead>
        <TableHead className="text-right">Unit price</TableHead>
        <TableHead className="text-right">Amount</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function TableBlock() {
  return (
    <Block
      description="Invoice line items: caption-role headers on a pale pane, hairline rows with no zebra, body-role cells and tabular rupiah that line up on the right."
      title="Table"
      wide
    >
      <div className="border border-line">
        <Table>
          <TableCaption className="mb-3 px-3 text-left">
            Subtotal {rupiah.format(7_100_000)} plus PPN 11%{" "}
            {rupiah.format(781_000)}.
          </TableCaption>
          <LineItemsHeader />
          <TableBody>
            {LINE_ITEMS.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="text-foreground">
                  {item.description}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.quantity}
                </TableCell>
                <TableCell className="text-right">
                  {rupiah.format(item.price)}
                </TableCell>
                <TableCell className="text-right text-foreground">
                  {rupiah.format(item.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>Total due</TableCell>
              <TableCell className="text-right">
                {rupiah.format(7_881_000)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <div className="border border-line">
        <Table>
          <LineItemsHeader />
          <TableBody>
            <TableRow className="hover:bg-transparent">
              <TableCell className="whitespace-normal p-0" colSpan={4}>
                <Empty className="py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Receipt aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No line items yet</EmptyTitle>
                    <EmptyDescription>
                      Add the first item to start invoice INV-2026-015.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button size="sm" variant="outline">
                      <Plus aria-hidden="true" data-icon="inline-start" />
                      Add line item
                    </Button>
                  </EmptyContent>
                </Empty>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Block>
  );
}

/* ── Chart ─────────────────────────────────────────────────────────────── */

const EXPORTS = [
  { month: "May", pdf: 186, json: 42 },
  { month: "Jun", pdf: 305, json: 61 },
  { month: "Jul", pdf: 237, json: 58 },
  { month: "Aug", pdf: 273, json: 70 },
  { month: "Sep", pdf: 409, json: 88 },
  { month: "Oct", pdf: 514, json: 102 },
] as const;

// Emphasis: cobalt for PDF (the story), the lightest chart grey for JSON.
// Validated with the dataviz palette script against bg-2 in both schemes.
const SERIES_ORDER = ["pdf", "json"];

const EXPORT_CHART = {
  pdf: { label: "PDF", color: "var(--chart-1)" },
  json: { label: "JSON", color: "var(--chart-5)" },
} satisfies ChartConfig;

function ExportsChart() {
  return (
    <ChartContainer className="aspect-auto h-64 w-full" config={EXPORT_CHART}>
      <BarChart accessibilityLayer data={[...EXPORTS]}>
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="month"
          tickLine={false}
          tickMargin={8}
        />
        <YAxis axisLine={false} tickCount={4} tickLine={false} width={32} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <ChartLegend
          content={<ChartLegendContent />}
          itemSorter={(item) => SERIES_ORDER.indexOf(String(item.dataKey))}
        />
        <Bar
          dataKey="pdf"
          fill="var(--color-pdf)"
          maxBarSize={24}
          stackId="exports"
          stroke="var(--card)"
          strokeWidth={2}
        />
        <Bar
          dataKey="json"
          fill="var(--color-json)"
          maxBarSize={24}
          radius={[2, 2, 0, 0]}
          stackId="exports"
          stroke="var(--card)"
          strokeWidth={2}
        />
      </BarChart>
    </ChartContainer>
  );
}

function ExportsTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">PDF</TableHead>
          <TableHead className="text-right">JSON</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {EXPORTS.map((row) => (
          <TableRow key={row.month}>
            <TableCell>{row.month} 2026</TableCell>
            <TableCell className="text-right">{row.pdf}</TableCell>
            <TableCell className="text-right">{row.json}</TableCell>
            <TableCell className="text-right text-foreground">
              {row.pdf + row.json}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ChartBlock() {
  const [showNumbers, setShowNumbers] = useState(false);
  return (
    <Block
      description="CVs exported per month. Cobalt marks the series the story is about, a light grey the context; the grid is a hairline, the tooltip a window, and the numbers are one click away."
      title="Chart"
      wide
    >
      <Card>
        <CardHeader>
          <CardTitle>CVs exported per month</CardTitle>
          <CardDescription>
            May to October 2026 · PDF exports nearly tripled
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExportsChart />
        </CardContent>
        <CardFooter className="block p-0">
          <Collapsible onOpenChange={setShowNumbers} open={showNumbers}>
            <div className="px-(--card-spacing) py-3">
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="ghost">
                  <ChevronsUpDown aria-hidden="true" data-icon="inline-start" />
                  {showNumbers ? "Hide the numbers" : "Show the numbers"}
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="border-line border-t">
              <ExportsTable />
            </CollapsibleContent>
          </Collapsible>
        </CardFooter>
      </Card>
    </Block>
  );
}

/* ── Item ──────────────────────────────────────────────────────────────── */

const DOCUMENTS = [
  {
    id: "cv",
    icon: FileText,
    title: "Rina Wulandari, Frontend Developer",
    meta: "CV · Harvard · edited 2 hours ago",
  },
  {
    id: "invoice",
    icon: Receipt,
    title: "INV-2026-014 · PT Sinar Digital Nusantara",
    meta: `Invoice · ${rupiah.format(7_881_000)} · due 25 October`,
  },
  {
    id: "portfolio",
    icon: Presentation,
    title:
      "Sapa, a sign language companion for deaf students in Malang and Surabaya",
    meta: "Academy portfolio · draft · 6 slides",
  },
] as const;

function ItemBlock() {
  return (
    <Block
      description="Rows in a list: a framed media tile, a semibold title, a caption under it and actions at the end. Bare items stack as hairline rows; long titles clamp to one line."
      title="Item"
    >
      <Example label="typical · hairline rows" stack>
        <ItemGroup>
          {DOCUMENTS.map((doc) => (
            <Item key={doc.id}>
              <ItemMedia variant="icon">
                <doc.icon aria-hidden="true" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{doc.title}</ItemTitle>
                <ItemDescription>{doc.meta}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  aria-label={`More actions for ${doc.title}`}
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </Example>
      <Example
        label="outline · a link tile with the lip · muted · a note"
        stack
      >
        <Item asChild variant="outline">
          <a href="#data-display">
            <ItemContent>
              <ItemTitle>Harvard template</ItemTitle>
              <ItemDescription>
                The one-column layout recruiters expect · 2,418 CVs
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Download aria-hidden="true" className="size-3.5" />
            </ItemActions>
          </a>
        </Item>
        <Item variant="muted">
          <ItemMedia>
            <Info
              aria-hidden="true"
              className="size-3.5 text-muted-foreground"
            />
          </ItemMedia>
          <ItemContent>
            <ItemDescription>
              Your CV stays in this browser until you connect a personal token.
            </ItemDescription>
          </ItemContent>
        </Item>
      </Example>
      <Example label="sizes · xs, sm, default" stack>
        {(["xs", "sm", "default"] as const).map((size) => (
          <Item key={size} size={size} variant="outline">
            <ItemMedia>
              <Avatar size={size === "xs" ? "sm" : "default"}>
                <AvatarFallback>DP</AvatarFallback>
              </Avatar>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Dimas Pratama</ItemTitle>
              <ItemDescription>Institut Teknologi Bandung</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </Example>
    </Block>
  );
}

/* ── Avatar ────────────────────────────────────────────────────────────── */

// A neutral placeholder portrait (image content, not chrome).
const PORTRAIT = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2f343e"/><circle cx="32" cy="25" r="11" fill="#9aa1ad"/><path d="M11 64c2-13 10-20 21-20s19 7 21 20z" fill="#9aa1ad"/></svg>'
)}`;

const MENTORS = [
  { initials: "RW", name: "Rina Wulandari" },
  { initials: "DP", name: "Dimas Pratama" },
  { initials: "AS", name: "Ayu Saraswati" },
  { initials: "BH", name: "Bagus Hartono" },
] as const;

function AvatarBlock() {
  return (
    <Block
      description="Framed 2px squares. Initials on pane when there is no photo; a group overlaps on a paper ring and ends in a count."
      title="Avatar"
    >
      <Example label="sizes · sm, default, lg">
        <Avatar size="sm">
          <AvatarFallback>RW</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>RW</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarFallback>RW</AvatarFallback>
        </Avatar>
      </Example>
      <Example label="photo · missing photo falls back · status dot">
        <Avatar size="lg">
          <AvatarImage alt="Dimas Pratama" src={PORTRAIT} />
          <AvatarFallback>DP</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarImage alt="Ayu Saraswati" />
          <AvatarFallback>AS</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarFallback>BH</AvatarFallback>
          <AvatarBadge>
            <span className="sr-only">Online</span>
          </AvatarBadge>
        </Avatar>
      </Example>
      <Example label="group · many reviewers">
        <AvatarGroup>
          {MENTORS.map((mentor) => (
            <Avatar key={mentor.initials}>
              <AvatarFallback title={mentor.name}>
                {mentor.initials}
              </AvatarFallback>
            </Avatar>
          ))}
          <AvatarGroupCount>+12</AvatarGroupCount>
        </AvatarGroup>
        <span className="type-caption text-muted-foreground">
          16 mentors reviewed this portfolio
        </span>
      </Example>
    </Block>
  );
}

/* ── Accordion ─────────────────────────────────────────────────────────── */

const FAQ = [
  {
    id: "storage",
    question: "Where is my CV stored?",
    answer:
      "In this browser until you connect a personal token. After that, every save also goes to your private copy on api.pilihpendidikan.com.",
  },
  {
    id: "export",
    question: "Can I export to PDF and JSON?",
    answer:
      "Yes. The PDF matches the preview page for page; the JSON keeps every field so you can import it again later.",
  },
  {
    id: "deadline",
    question:
      "What happens to my Academy portfolio after the application window closes in December?",
    answer:
      "Nothing. It stays in your account, and the public link keeps working until you delete the portfolio.",
  },
] as const;

function AccordionBlock() {
  return (
    <Block
      description="Full-width rows ending in +, which turns into − when the row is open. Rows open instantly; long questions wrap."
      title="Accordion"
    >
      <Example stack>
        <Accordion collapsible defaultValue="storage" type="single">
          {FAQ.map((entry) => (
            <AccordionItem key={entry.id} value={entry.id}>
              <AccordionTrigger>{entry.question}</AccordionTrigger>
              <AccordionContent>
                <p className="max-w-prose">{entry.answer}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
          <AccordionItem disabled value="mentors">
            <AccordionTrigger>
              Can a mentor comment on my CV? (coming soon)
            </AccordionTrigger>
            <AccordionContent>
              <p>Not yet.</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Example>
    </Block>
  );
}

/* ── Collapsible ───────────────────────────────────────────────────────── */

const BANK_ROWS = [
  { label: "Bank", value: "Bank Central Asia" },
  { label: "Account number", value: "123 456 7890" },
  { label: "Account name", value: "Rina Wulandari" },
] as const;

function CollapsibleBlock() {
  const [open, setOpen] = useState(false);
  return (
    <Block
      description="Show or hide one region, instantly. The trigger says what it reveals."
      title="Collapsible"
    >
      <Example stack>
        <Collapsible
          className="flex w-full flex-col gap-3"
          onOpenChange={setOpen}
          open={open}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="type-body weight-semibold text-foreground">
              Payment details
            </span>
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="ghost">
                <ChevronsUpDown aria-hidden="true" data-icon="inline-start" />
                {open ? "Hide" : "Show"}
              </Button>
            </CollapsibleTrigger>
          </div>
          <span className="type-caption text-muted-foreground">
            Transfer to BCA before 25 October 2026.
          </span>
          <CollapsibleContent>
            <dl className="border border-line">
              {BANK_ROWS.map((row) => (
                <div
                  className="grid grid-cols-[8rem_1fr] items-baseline gap-3 border-line border-b px-3 py-2 last:border-b-0"
                  key={row.label}
                >
                  <dt className="type-caption text-muted-foreground">
                    {row.label}
                  </dt>
                  <dd className="type-body text-foreground tabular-nums">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      </Example>
    </Block>
  );
}

/* ── Carousel ──────────────────────────────────────────────────────────── */

const SLIDES = [
  { id: "cover", title: "Sapa", caption: "Cover · the app icon on shot" },
  { id: "problem", title: "The problem", caption: "Deaf students in class" },
  { id: "design", title: "Design", caption: "Three screens, one flow" },
  { id: "result", title: "Result", caption: "Tested with 40 students" },
] as const;

function ShotFrame({ children }: { children: ReactNode }) {
  return (
    <div className="outline-dashed outline-1 outline-line outline-offset-6">
      <AspectRatio className="bg-shot" ratio={16 / 9}>
        <div className="dark flex size-full flex-col items-center justify-center gap-1 p-3 text-center">
          {children}
        </div>
      </AspectRatio>
    </div>
  );
}

function CarouselBlock() {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(1);
  useEffect(() => {
    if (!api) {
      return;
    }
    const update = () => setCurrent(api.selectedScrollSnap() + 1);
    update();
    api.on("select", update);
    return () => {
      api.off("select", update);
    };
  }, [api]);
  return (
    <Block
      description="Swipe through portfolio slides. Embla's drag is the only motion; the controls are outline icon buttons with the lip."
      title="Carousel"
    >
      <Example stack>
        <Carousel className="w-full" setApi={setApi}>
          <CarouselContent>
            {SLIDES.map((slide) => (
              <CarouselItem className="p-2 pl-6" key={slide.id}>
                <ShotFrame>
                  <span className="type-title text-foreground">
                    {slide.title}
                  </span>
                  <span className="type-caption text-muted-foreground">
                    {slide.caption}
                  </span>
                </ShotFrame>
              </CarouselItem>
            ))}
          </CarouselContent>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="type-caption text-muted-foreground tabular-nums">
              Slide {current} of {SLIDES.length}
            </span>
            <div className="flex gap-2">
              <CarouselPrevious className="static my-0" />
              <CarouselNext className="static my-0" />
            </div>
          </div>
        </Carousel>
      </Example>
    </Block>
  );
}

/* ── Scroll area ───────────────────────────────────────────────────────── */

const UNIVERSITIES = [
  ["Universitas Brawijaya", "Malang"],
  ["Universitas Indonesia", "Depok"],
  ["Institut Teknologi Bandung", "Bandung"],
  ["Universitas Gadjah Mada", "Yogyakarta"],
  ["Institut Teknologi Sepuluh Nopember", "Surabaya"],
  ["Universitas Airlangga", "Surabaya"],
  ["Universitas Diponegoro", "Semarang"],
  ["Universitas Padjadjaran", "Bandung"],
  ["Institut Pertanian Bogor", "Bogor"],
  ["Universitas Hasanuddin", "Makassar"],
  ["Universitas Sumatera Utara", "Medan"],
  ["Universitas Udayana", "Denpasar"],
  ["Telkom University", "Bandung"],
  ["Universitas Bina Nusantara", "Jakarta"],
  ["Universitas Negeri Malang", "Malang"],
  ["Universitas Andalas", "Padang"],
] as const;

const TEMPLATE_NAMES = [
  "Harvard",
  "Standard",
  "Simple",
  "Basic",
  "Academy deck",
  "Invoice A4",
] as const;

function ScrollAreaBlock() {
  return (
    <Block
      description="A hairline-framed scroller with a thin square thumb in the rule colour, vertical or sideways."
      title="Scroll area"
    >
      <Example label="vertical · 16 universities" stack>
        <ScrollArea className="h-56 border border-line">
          <ul className="flex flex-col">
            {UNIVERSITIES.map(([name, city]) => (
              <li
                className="flex items-baseline justify-between gap-3 border-line border-b px-3 py-2 last:border-b-0"
                key={name}
              >
                <span className="type-body truncate text-foreground">
                  {name}
                </span>
                <span className="type-caption shrink-0 text-muted-foreground">
                  {city}
                </span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Example>
      <Example label="horizontal · templates" stack>
        <ScrollArea className="w-full whitespace-nowrap border border-line">
          <div className="flex w-max gap-3 p-3">
            {TEMPLATE_NAMES.map((name) => (
              <figure
                className="flex w-28 shrink-0 flex-col gap-1.5"
                key={name}
              >
                <div className="graph-paper aspect-3/4 border border-border bg-card" />
                <figcaption className="type-caption text-muted-foreground">
                  {name}
                </figcaption>
              </figure>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </Example>
    </Block>
  );
}

/* ── Resizable ─────────────────────────────────────────────────────────── */

function ResizableBlock() {
  return (
    <Block
      description="Split the editor between form and preview. The handle is a 1px rule like every pane divider, with a 9px diamond grip; drag it or focus it and use the arrow keys."
      title="Resizable"
      wide
    >
      <ResizablePanelGroup
        className="min-h-72 border border-line"
        orientation="horizontal"
      >
        <ResizablePanel defaultSize="38%" minSize="25%">
          <div className="flex h-full flex-col gap-1 p-4">
            <span className="type-caption text-muted-foreground">Form</span>
            <span className="type-body text-foreground">
              Work experience · 2 entries
            </span>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="62%" minSize="30%">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="70%" minSize="30%">
              <div className="graph-paper flex h-full flex-col gap-1 p-4">
                <span className="type-caption text-muted-foreground">
                  Preview
                </span>
                <span className="type-body text-foreground">
                  Page 1 of 2 · A4
                </span>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="30%" minSize="20%">
              <div className="flex h-full flex-col gap-1 p-4">
                <span className="type-caption text-muted-foreground">
                  Notes
                </span>
                <span className="type-body text-foreground">
                  Ask Pak Budi for a reference letter.
                </span>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </Block>
  );
}

/* ── Aspect ratio ──────────────────────────────────────────────────────── */

function AspectRatioBlock() {
  return (
    <Block
      description="Portfolio image slots keep 16:9: a dark shot placeholder inside a 1px dashed frame 6px out, until a screenshot fills it."
      title="Aspect ratio"
    >
      <Example label="16:9 screenshot slot" stack>
        <div className="p-2">
          <ShotFrame>
            <ImageIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <span className="type-caption text-muted-foreground">
              Drop a 1920 × 1080 screenshot
            </span>
          </ShotFrame>
        </div>
      </Example>
    </Block>
  );
}

/* ── Separator ─────────────────────────────────────────────────────────── */

function SeparatorBlock() {
  return (
    <Block
      description="A 1px hairline in the rule colour, across or between."
      title="Separator"
    >
      <Example stack>
        <div className="flex flex-col gap-1">
          <span className="type-subtitle weight-semibold text-foreground">
            Rina Wulandari
          </span>
          <span className="type-caption text-muted-foreground">
            Informatika, Universitas Brawijaya
          </span>
        </div>
        <Separator />
        <div className="type-body flex h-5 items-center gap-3 text-foreground">
          <span>CV</span>
          <Separator orientation="vertical" />
          <span>Invoice</span>
          <Separator orientation="vertical" />
          <span>Portfolio</span>
        </div>
      </Example>
    </Block>
  );
}

/* ── Rails ─────────────────────────────────────────────────────────────── */

function RailsBlock() {
  return (
    <Block
      description="The drafting frame: a Band is a full-bleed 1px rule, a Rail the ruled column with diamond nodes at its top corners, a Diamond one loose node where two rules cross."
      title="Rails"
    >
      <div className="graph-paper overflow-hidden border border-line">
        <Band className="h-4" />
        <Band>
          <Rail className="type-caption flex h-16 items-center justify-center bg-background text-muted-foreground">
            Rail · the ruled column
          </Rail>
        </Band>
        <Band>
          <Rail className="grid h-20 grid-cols-[2fr_3fr] bg-background">
            <div className="type-caption relative flex items-center justify-center border-line border-r text-muted-foreground">
              Toolbar
              <Diamond className="-top-1 -right-1" />
            </div>
            <div className="type-caption flex items-center justify-center text-muted-foreground">
              Pane
            </div>
          </Rail>
        </Band>
        <div className="h-4" />
      </div>
    </Block>
  );
}

/* ── Section list ──────────────────────────────────────────────────────── */

interface Experience {
  id: string;
  company: string;
  role: string;
}

const INITIAL_EXPERIENCE: Experience[] = [
  { id: "tokopedia", company: "Tokopedia", role: "Frontend Developer" },
  { id: "gojek", company: "Gojek", role: "Software Engineer Intern" },
  { id: "new", company: "", role: "Teaching Assistant" },
];

function SectionListBlock() {
  const [title, setTitle] = useState("Work experience");
  const [items, setItems] = useState(INITIAL_EXPERIENCE);
  const update = (id: string, patch: Partial<Experience>) =>
    setItems((list) =>
      list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
    );
  return (
    <Block
      description="The editor's entry list (@rulisme/ui/form/section-list): an inline-editable title, hairline rows with a drag grip, an error dot and a remove ×, then an outline add button."
      title="Section list"
    >
      <Example stack>
        <SectionList<Experience>
          addLabel="Add experience"
          hasError={(entry) => entry.company.trim() === ""}
          items={items}
          onAdd={() =>
            setItems((list) => [
              ...list,
              { id: crypto.randomUUID(), company: "", role: "" },
            ])
          }
          onRemove={(id) =>
            setItems((list) => list.filter((entry) => entry.id !== id))
          }
          onReorder={setItems}
          onTitleChange={setTitle}
          placeholder="Work experience"
          renderContent={(entry) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                error={
                  entry.company.trim() === ""
                    ? "Add the company name"
                    : undefined
                }
                label="Company"
                onChange={(company) => update(entry.id, { company })}
                placeholder="PT Sinar Digital Nusantara"
                value={entry.company}
              />
              <FormField
                label="Role"
                onChange={(role) => update(entry.id, { role })}
                placeholder="Frontend Developer"
                value={entry.role}
              />
            </div>
          )}
          summary={(entry) =>
            [entry.role, entry.company].filter(Boolean).join(" · ") ||
            "New entry"
          }
          title={title}
        />
      </Example>
    </Block>
  );
}

// Renders: Card, Table, Chart, Item, Avatar, Accordion, Collapsible, Carousel, ScrollArea, Resizable, AspectRatio, Separator, Rails.
export function DataDisplaySection() {
  return (
    <Section
      id="data-display"
      lead="Hairline cells and square cards. Depth comes from rules, not shadows."
      title="Data display"
    >
      <BlockGrid>
        <CardBlock />
        <TableBlock />
        <ChartBlock />
        <ItemBlock />
        <AvatarBlock />
        <AccordionBlock />
        <CollapsibleBlock />
        <CarouselBlock />
        <ScrollAreaBlock />
        <ResizableBlock />
        <AspectRatioBlock />
        <SeparatorBlock />
        <RailsBlock />
        <SectionListBlock />
      </BlockGrid>
    </Section>
  );
}
